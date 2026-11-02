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

async function appendMessage(id, message, options) {
  options = options || {};
  const existing = (await getChat(id)) || emptyChat(id, options.name);
  if (options.name) existing.name = options.name;
  if (options.geo) Object.assign(existing, options.geo);
  existing.messages = existing.messages || [];
  existing.messages.push({
    from: message.from,
    text: message.text,
    at: message.at || Date.now()
  });
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
  } else if (message.from === "bot") {
    /* FAQ bot replies do not alert admin */
  } else if (message.from === "system") {
    existing.unreadCustomer = (existing.unreadCustomer || 0) + 1;
  }
  return saveChat(existing);
}

async function markCustomerRead(id) {
  const chat = await getChat(id);
  if (!chat) return null;
  chat.unreadCustomer = 0;
  chat.customerUnread = 0;
  return saveChat(chat);
}

async function markAdminRead(id) {
  const chat = await getChat(id);
  if (!chat) return null;
  chat.unread = 0;
  return saveChat(chat);
}

async function patchChatMeta(id, patch) {
  patch = patch || {};
  let chat = await getChat(id);
  if (!chat) chat = emptyChat(id, patch.name);
  if (patch.name) chat.name = String(patch.name).trim() || chat.name;
  ["ip", "city", "country", "countryCode", "geoLabel"].forEach((key) => {
    if (patch[key] != null) chat[key] = String(patch[key] || "");
  });
  if (patch.awaitingAgent != null) chat.awaitingAgent = !!patch.awaitingAgent;
  if (patch.agentConnected != null) chat.agentConnected = !!patch.agentConnected;
  chat.updatedAt = Date.now();
  return saveChat(chat);
}

async function markAgentConnected(id) {
  const chat = await getChat(id);
  if (!chat) return null;
  if (chat.status === "ended") return chat;
  chat.agentConnected = true;
  chat.agentConnectedAt = chat.agentConnectedAt || Date.now();
  chat.awaitingAgent = false;
  chat.unread = 0;
  chat.updatedAt = Date.now();
  return saveChat(chat);
}

async function setTyping(id, typing) {
  const chat = await getChat(id);
  if (!chat || chat.status === "ended") return chat;
  chat.typingAgentAt = typing ? Date.now() : null;
  chat.updatedAt = Date.now();
  return saveChat(chat);
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
