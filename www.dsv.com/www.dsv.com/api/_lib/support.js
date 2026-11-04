const { getSupabase } = require("./supabase");

const TYPING_TTL_MS = 6000;

function emptyChat(id, name) {
  return {
    id: String(id),
    name: name || "Website Visitor",
    unread: 0,
    unreadCustomer: 0,
    customerUnread: 0,
    messages: [],
    status: "open",
    awaitingAgent: false,
    agentConnected: false,
    typingAgentAt: null,
    ip: "",
    city: "",
    country: "",
    countryCode: "",
    geoLabel: "",
    lastSeenAt: null,
    browsing: false,
    updatedAt: Date.now(),
    createdAt: new Date().toISOString()
  };
}

function normalizeChat(chat) {
  if (!chat) return null;
  const unreadCustomer = Number(chat.unreadCustomer != null ? chat.unreadCustomer : chat.customerUnread || 0);
  const typingAt = chat.typingAgentAt != null ? Number(chat.typingAgentAt) : null;
  const typingFresh = typingAt && Date.now() - typingAt < TYPING_TTL_MS;
  return {
    id: String(chat.id),
    name: chat.name || "Website Visitor",
    unread: Number(chat.unread || 0),
    unreadCustomer,
    customerUnread: unreadCustomer,
    messages: Array.isArray(chat.messages) ? chat.messages : [],
    status: chat.status === "ended" ? "ended" : "open",
    awaitingAgent: !!chat.awaitingAgent,
    agentConnected: !!chat.agentConnected,
    typingAgentAt: typingFresh ? typingAt : null,
    typing: !!typingFresh,
    ip: chat.ip || "",
    city: chat.city || "",
    country: chat.country || "",
    countryCode: chat.countryCode || "",
    geoLabel: chat.geoLabel || "",
    lastSeenAt: chat.lastSeenAt != null ? Number(chat.lastSeenAt) : null,
    browsing: !!chat.browsing,
    online:
      chat.lastSeenAt != null &&
      Date.now() - Number(chat.lastSeenAt) < 45000 &&
      chat.status !== "ended",
    updatedAt: Number(chat.updatedAt || Date.now()),
    createdAt: chat.createdAt || null,
    endedAt: chat.endedAt || null,
    agentConnectedAt: chat.agentConnectedAt || null
  };
}

function rowToChat(row) {
  if (!row) return null;
  const meta = row.meta && typeof row.meta === "object" ? row.meta : {};
  return normalizeChat({
    id: row.id,
    name: row.name || "Website Visitor",
    unread: Number(row.unread_admin || 0),
    unreadCustomer: Number(row.unread_customer || 0),
    messages: row.messages || [],
    status: row.status || meta.status || "open",
    awaitingAgent: meta.awaitingAgent === true,
    agentConnected: meta.agentConnected === true,
    typingAgentAt: meta.typingAgentAt || null,
    ip: meta.ip || "",
    city: meta.city || "",
    country: meta.country || "",
    countryCode: meta.countryCode || "",
    geoLabel: meta.geoLabel || "",
    lastSeenAt: meta.lastSeenAt != null ? Number(meta.lastSeenAt) : null,
    browsing: meta.browsing === true,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
    createdAt: row.created_at || null,
    endedAt: meta.endedAt || null,
    agentConnectedAt: meta.agentConnectedAt || null
  });
}

function chatToRow(chat) {
  const n = normalizeChat(chat);
  return {
    id: n.id,
    name: n.name,
    unread_admin: Number(n.unread || 0),
    unread_customer: Number(n.unreadCustomer || 0),
    messages: n.messages || [],
    status: n.status || "open",
    meta: {
      awaitingAgent: !!n.awaitingAgent,
      agentConnected: !!n.agentConnected,
      typingAgentAt: n.typingAgentAt || null,
      ip: n.ip || "",
      city: n.city || "",
      country: n.country || "",
      countryCode: n.countryCode || "",
      geoLabel: n.geoLabel || "",
      lastSeenAt: n.lastSeenAt != null ? Number(n.lastSeenAt) : null,
      browsing: !!n.browsing,
      endedAt: n.endedAt || null,
      agentConnectedAt: n.agentConnectedAt || null,
      status: n.status || "open"
    },
    updated_at: new Date(n.updatedAt || Date.now()).toISOString()
  };
}

async function listChats() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("support_chats")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(rowToChat).filter(Boolean);
}

async function getChat(id) {
  const key = String(id || "");
  if (!key) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase.from("support_chats").select("*").eq("id", key).maybeSingle();
  if (error) throw error;
  return data ? rowToChat(data) : null;
}

async function saveChat(chat) {
  const normalized = normalizeChat(chat);
  const payload = chatToRow(normalized);
  const supabase = getSupabase();
  const { error } = await supabase.from("support_chats").upsert(payload);
  if (error) throw error;
  return normalized;
}

function messageKey(m) {
  return `${m && m.from}|${m && m.at}|${m && m.text}`;
}

async function patchMetaOnly(id, metaPatch) {
  const key = String(id || "");
  if (!key) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("support_chats")
    .select("meta, status")
    .eq("id", key)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (data.status === "ended") return getChat(key);
  const meta = Object.assign(
    {},
    data.meta && typeof data.meta === "object" ? data.meta : {},
    metaPatch || {}
  );
  const { error: upErr } = await supabase.from("support_chats").update({ meta }).eq("id", key);
  if (upErr) throw upErr;
  return getChat(key);
}

async function appendMessage(id, message, options) {
  options = options || {};
  const at = message.at || Date.now();
  const incoming = { from: message.from, text: message.text, at };
  let last = null;

  // Retry: concurrent typing/read upserts used to clobber the messages array.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const existing = (await getChat(id)) || emptyChat(id, options.name);
    if (options.name) existing.name = options.name;
    if (options.geo) Object.assign(existing, options.geo);
    existing.messages = Array.isArray(existing.messages) ? existing.messages.slice() : [];

    if (existing.messages.some((m) => messageKey(m) === messageKey(incoming))) {
      return existing;
    }

    existing.messages.push(incoming);
    existing.updatedAt = Date.now();
    existing.typingAgentAt = null;
    if (existing.status !== "ended") existing.status = "open";

    if (message.from === "customer") {
      existing.unread = (existing.unread || 0) + 1;
      if (options.awaitingAgent !== false) existing.awaitingAgent = true;
    } else if (message.from === "agent") {
      existing.unreadCustomer = (existing.unreadCustomer || 0) + 1;
      existing.unread = 0;
      existing.awaitingAgent = false;
      existing.agentConnected = true;
    } else if (message.from === "system") {
      existing.unreadCustomer = (existing.unreadCustomer || 0) + 1;
    }

    await saveChat(existing);
    const verify = await getChat(id);
    last = verify;
    if (verify && (verify.messages || []).some((m) => messageKey(m) === messageKey(incoming))) {
      return verify;
    }
    await new Promise((resolve) => setTimeout(resolve, 35 + attempt * 45));
  }
  return last || getChat(id);
}

async function markCustomerRead(id) {
  const key = String(id || "");
  if (!key) return null;
  const supabase = getSupabase();
  const { error } = await supabase.from("support_chats").update({ unread_customer: 0 }).eq("id", key);
  if (error) throw error;
  return getChat(key);
}

async function markAdminRead(id) {
  const key = String(id || "");
  if (!key) return null;
  const supabase = getSupabase();
  const { error } = await supabase.from("support_chats").update({ unread_admin: 0 }).eq("id", key);
  if (error) throw error;
  return getChat(key);
}

async function patchChatMeta(id, patch) {
  patch = patch || {};
  const key = String(id || "");
  if (!key) return null;
  let chat = await getChat(key);
  if (!chat) {
    chat = emptyChat(key, patch.name);
    if (patch.name) chat.name = String(patch.name).trim() || chat.name;
    ["ip", "city", "country", "countryCode", "geoLabel"].forEach((field) => {
      if (patch[field] != null) chat[field] = String(patch[field] || "");
    });
    if (patch.awaitingAgent != null) chat.awaitingAgent = !!patch.awaitingAgent;
    if (patch.agentConnected != null) chat.agentConnected = !!patch.agentConnected;
    if (patch.lastSeenAt != null) chat.lastSeenAt = Number(patch.lastSeenAt) || Date.now();
    else chat.lastSeenAt = Date.now();
    if (patch.browsing != null) chat.browsing = !!patch.browsing;
    else chat.browsing = true;
    chat.updatedAt = Date.now();
    return saveChat(chat);
  }

  const supabase = getSupabase();
  const rowPatch = {};
  if (patch.name) rowPatch.name = String(patch.name).trim() || chat.name;

  const metaPatch = {};
  ["ip", "city", "country", "countryCode", "geoLabel"].forEach((field) => {
    if (patch[field] != null) metaPatch[field] = String(patch[field] || "");
  });
  if (patch.awaitingAgent != null) metaPatch.awaitingAgent = !!patch.awaitingAgent;
  if (patch.agentConnected != null) metaPatch.agentConnected = !!patch.agentConnected;
  if (patch.lastSeenAt != null) metaPatch.lastSeenAt = Number(patch.lastSeenAt) || Date.now();
  if (patch.browsing != null) metaPatch.browsing = !!patch.browsing;

  if (Object.keys(metaPatch).length) {
    const { data, error } = await supabase.from("support_chats").select("meta").eq("id", key).maybeSingle();
    if (error) throw error;
    rowPatch.meta = Object.assign({}, data && data.meta && typeof data.meta === "object" ? data.meta : {}, metaPatch);
  }

  if (!Object.keys(rowPatch).length) return chat;

  const presenceOnly =
    !patch.name &&
    patch.awaitingAgent == null &&
    patch.agentConnected == null &&
    Object.keys(metaPatch).every(function (k) {
      return k === "lastSeenAt" || k === "browsing" || k === "ip" || k === "city" || k === "country" || k === "countryCode" || k === "geoLabel";
    }) &&
    (metaPatch.lastSeenAt != null || metaPatch.browsing != null);

  // Presence heartbeats update meta only — don't reshuffle inbox order.
  if (!presenceOnly) rowPatch.updated_at = new Date().toISOString();

  const { error: upErr } = await supabase.from("support_chats").update(rowPatch).eq("id", key);
  if (upErr) throw upErr;
  return getChat(key);
}

async function markAgentConnected(id) {
  const key = String(id || "");
  if (!key) return null;
  const chat = await getChat(key);
  if (!chat) return null;
  if (chat.status === "ended") return chat;
  const supabase = getSupabase();
  const { data, error } = await supabase.from("support_chats").select("meta").eq("id", key).maybeSingle();
  if (error) throw error;
  const meta = Object.assign({}, data && data.meta && typeof data.meta === "object" ? data.meta : {}, {
    agentConnected: true,
    awaitingAgent: false,
    agentConnectedAt: chat.agentConnectedAt || Date.now()
  });
  const { error: upErr } = await supabase
    .from("support_chats")
    .update({
      meta,
      unread_admin: 0,
      updated_at: new Date().toISOString()
    })
    .eq("id", key);
  if (upErr) throw upErr;
  return getChat(key);
}

async function setTyping(id, typing) {
  // Meta-only — never rewrite messages (that race made agent replies vanish).
  return patchMetaOnly(id, { typingAgentAt: typing ? Date.now() : null });
}

async function endChat(id) {
  const chat = await getChat(id);
  if (!chat) return null;
  if (chat.status === "ended") return chat;
  chat.status = "ended";
  chat.endedAt = Date.now();
  chat.updatedAt = Date.now();
  chat.unread = 0;
  chat.awaitingAgent = false;
  chat.typingAgentAt = null;
  chat.unreadCustomer = (chat.unreadCustomer || 0) + 1;
  chat.messages = chat.messages || [];
  chat.messages.push({
    from: "system",
    text: "Conversation ended by support. You can start a new chat anytime.",
    at: Date.now()
  });
  return saveChat(chat);
}

async function clearAllChats() {
  const supabase = getSupabase();
  const { error } = await supabase.from("support_chats").delete().neq("id", "");
  if (error) throw error;
  return [];
}

module.exports = {
  listChats,
  getChat,
  saveChat,
  appendMessage,
  markCustomerRead,
  markAdminRead,
  patchChatMeta,
  markAgentConnected,
  setTyping,
  endChat,
  clearAllChats,
  emptyChat,
  normalizeChat,
  TYPING_TTL_MS
};
