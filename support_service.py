"""Server-backed support chat store (Supabase; same shape as Node api/_lib/support.js)."""

from __future__ import annotations

import threading
import time
from datetime import datetime, timezone
from typing import Any

import shipment_service

TYPING_TTL_MS = 6000

_lock = threading.Lock()


def _now_ms() -> int:
    return int(time.time() * 1000)


def _chat_to_row(chat: dict[str, Any]) -> dict[str, Any]:
    normalized = normalize_chat(chat)
    assert normalized is not None
    return {
        "id": normalized["id"],
        "name": normalized["name"],
        "unread_admin": int(normalized.get("unread") or 0),
        "unread_customer": int(normalized.get("unreadCustomer") or 0),
        "messages": normalized.get("messages") or [],
        "status": normalized.get("status") or "open",
        "meta": {
            "awaitingAgent": bool(normalized.get("awaitingAgent")),
            "agentConnected": bool(normalized.get("agentConnected")),
            "typingAgentAt": normalized.get("typingAgentAt"),
            "ip": normalized.get("ip") or "",
            "city": normalized.get("city") or "",
            "country": normalized.get("country") or "",
            "countryCode": normalized.get("countryCode") or "",
            "geoLabel": normalized.get("geoLabel") or "",
            "endedAt": normalized.get("endedAt"),
            "agentConnectedAt": normalized.get("agentConnectedAt"),
            "status": normalized.get("status") or "open",
        },
        "updated_at": datetime.fromtimestamp(
            int(normalized.get("updatedAt") or _now_ms()) / 1000.0, tz=timezone.utc
        ).isoformat(),
        "created_at": normalized.get("createdAt")
        or datetime.now(timezone.utc).isoformat(),
    }


def _row_to_chat(row: dict[str, Any]) -> dict[str, Any] | None:
    if not row:
        return None
    meta = row.get("meta") if isinstance(row.get("meta"), dict) else {}
    updated = row.get("updated_at")
    try:
        updated_ms = int(datetime.fromisoformat(str(updated).replace("Z", "+00:00")).timestamp() * 1000) if updated else _now_ms()
    except (TypeError, ValueError):
        updated_ms = _now_ms()
    return normalize_chat(
        {
            "id": row.get("id"),
            "name": row.get("name") or "Website Visitor",
            "unread": int(row.get("unread_admin") or 0),
            "unreadCustomer": int(row.get("unread_customer") or 0),
            "messages": row.get("messages") or [],
            "status": row.get("status") or meta.get("status") or "open",
            "awaitingAgent": meta.get("awaitingAgent") is True,
            "agentConnected": meta.get("agentConnected") is True,
            "typingAgentAt": meta.get("typingAgentAt"),
            "ip": meta.get("ip") or "",
            "city": meta.get("city") or "",
            "country": meta.get("country") or "",
            "countryCode": meta.get("countryCode") or "",
            "geoLabel": meta.get("geoLabel") or "",
            "updatedAt": updated_ms,
            "createdAt": row.get("created_at"),
            "endedAt": meta.get("endedAt"),
            "agentConnectedAt": meta.get("agentConnectedAt"),
        }
    )


def _read_all() -> list[dict[str, Any]]:
    if not shipment_service.using_supabase():
        raise RuntimeError("Supabase is required for support chats.")
    rows = shipment_service._supabase_request(
        "GET",
        "support_chats",
        query="select=*&order=updated_at.desc",
        prefer="return=representation",
    ) or []
    out: list[dict[str, Any]] = []
    for row in rows:
        if isinstance(row, dict):
            chat = _row_to_chat(row)
            if chat:
                out.append(chat)
    return out


def _write_all(chats: list[dict[str, Any]]) -> None:
    if not shipment_service.using_supabase():
        raise RuntimeError("Supabase is required for support chats.")
    existing = shipment_service._supabase_request(
        "GET",
        "support_chats",
        query="select=id",
        prefer="return=representation",
    ) or []
    existing_ids = {str(r.get("id")) for r in existing if isinstance(r, dict) and r.get("id")}
    next_ids = {str(c.get("id")) for c in chats if c.get("id")}
    rows = [_chat_to_row(c) for c in chats if c.get("id")]
    if rows:
        shipment_service._supabase_request(
            "POST",
            "support_chats",
            payload=rows,
            query="on_conflict=id",
            prefer="resolution=merge-duplicates,return=minimal",
        )
    to_delete = sorted(existing_ids - next_ids)
    if to_delete:
        joined = ",".join('"' + cid.replace('"', "") + '"' for cid in to_delete)
        shipment_service._supabase_request(
            "DELETE",
            "support_chats",
            query=f"id=in.({joined})",
            prefer="return=minimal",
        )


def empty_chat(chat_id: str, name: str | None = None) -> dict[str, Any]:
    return {
        "id": str(chat_id),
        "name": name or "Website Visitor",
        "unread": 0,
        "unreadCustomer": 0,
        "customerUnread": 0,
        "messages": [],
        "status": "open",
        "awaitingAgent": False,
        "agentConnected": False,
        "typingAgentAt": None,
        "ip": "",
        "city": "",
        "country": "",
        "countryCode": "",
        "geoLabel": "",
        "updatedAt": _now_ms(),
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def normalize_chat(chat: dict[str, Any] | None) -> dict[str, Any] | None:
    if not chat:
        return None
    unread_customer = int(chat.get("unreadCustomer") if chat.get("unreadCustomer") is not None else chat.get("customerUnread") or 0)
    typing_at = chat.get("typingAgentAt")
    typing_at_n = int(typing_at) if typing_at is not None else None
    typing_fresh = bool(typing_at_n and (_now_ms() - typing_at_n) < TYPING_TTL_MS)
    return {
        "id": str(chat.get("id") or ""),
        "name": chat.get("name") or "Website Visitor",
        "unread": int(chat.get("unread") or 0),
        "unreadCustomer": unread_customer,
        "customerUnread": unread_customer,
        "messages": list(chat.get("messages") or []) if isinstance(chat.get("messages"), list) else [],
        "status": "ended" if chat.get("status") == "ended" else "open",
        "awaitingAgent": bool(chat.get("awaitingAgent")),
        "agentConnected": bool(chat.get("agentConnected")),
        "typingAgentAt": typing_at_n if typing_fresh else None,
        "typing": typing_fresh,
        "ip": chat.get("ip") or "",
        "city": chat.get("city") or "",
        "country": chat.get("country") or "",
        "countryCode": chat.get("countryCode") or "",
        "geoLabel": chat.get("geoLabel") or "",
        "updatedAt": int(chat.get("updatedAt") or _now_ms()),
        "createdAt": chat.get("createdAt"),
        "endedAt": chat.get("endedAt"),
        "agentConnectedAt": chat.get("agentConnectedAt"),
    }


def list_chats() -> list[dict[str, Any]]:
    with _lock:
        chats = [normalize_chat(c) for c in _read_all()]
    out = [c for c in chats if c]
    out.sort(key=lambda c: int(c.get("updatedAt") or 0), reverse=True)
    return out


def get_chat(chat_id: str) -> dict[str, Any] | None:
    key = str(chat_id or "")
    if not key:
        return None
    with _lock:
        for row in _read_all():
            if str(row.get("id")) == key:
                return normalize_chat(row)
    return None


def _save_unlocked(chat: dict[str, Any]) -> dict[str, Any]:
    normalized = normalize_chat(chat)
    assert normalized is not None
    all_chats = [c for c in _read_all() if str(c.get("id")) != normalized["id"]]
    all_chats.insert(0, normalized)
    _write_all(all_chats)
    return normalize_chat(normalized)  # type: ignore[return-value]


def save_chat(chat: dict[str, Any]) -> dict[str, Any]:
    with _lock:
        return _save_unlocked(chat)


def append_message(chat_id: str, message: dict[str, Any], options: dict[str, Any] | None = None) -> dict[str, Any]:
    options = options or {}
    with _lock:
        existing = None
        for row in _read_all():
            if str(row.get("id")) == str(chat_id):
                existing = normalize_chat(row)
                break
        if not existing:
            existing = empty_chat(chat_id, options.get("name"))
        if options.get("name"):
            existing["name"] = str(options["name"])
        geo = options.get("geo") or {}
        for key in ("ip", "city", "country", "countryCode", "geoLabel"):
            if geo.get(key) is not None:
                existing[key] = str(geo.get(key) or "")
        existing["messages"] = list(existing.get("messages") or [])
        existing["messages"].append(
            {
                "from": message.get("from"),
                "text": message.get("text"),
                "at": message.get("at") or _now_ms(),
            }
        )
        existing["updatedAt"] = _now_ms()
        existing["typingAgentAt"] = None
        if existing.get("status") != "ended":
            existing["status"] = "open"
        frm = message.get("from")
        if frm == "customer":
            existing["unread"] = int(existing.get("unread") or 0) + 1
            if options.get("awaitingAgent", True):
                existing["awaitingAgent"] = True
        elif frm == "agent":
            existing["unreadCustomer"] = int(existing.get("unreadCustomer") or 0) + 1
            existing["customerUnread"] = existing["unreadCustomer"]
            existing["unread"] = 0
            existing["awaitingAgent"] = False
            existing["agentConnected"] = True
        elif frm == "system":
            existing["unreadCustomer"] = int(existing.get("unreadCustomer") or 0) + 1
            existing["customerUnread"] = existing["unreadCustomer"]
        return _save_unlocked(existing)


def mark_customer_read(chat_id: str) -> dict[str, Any] | None:
    with _lock:
        chat = None
        for row in _read_all():
            if str(row.get("id")) == str(chat_id):
                chat = normalize_chat(row)
                break
        if not chat:
            return None
        chat["unreadCustomer"] = 0
        chat["customerUnread"] = 0
        return _save_unlocked(chat)


def mark_admin_read(chat_id: str) -> dict[str, Any] | None:
    with _lock:
        chat = None
        for row in _read_all():
            if str(row.get("id")) == str(chat_id):
                chat = normalize_chat(row)
                break
        if not chat:
            return None
        chat["unread"] = 0
        return _save_unlocked(chat)


def patch_chat_meta(chat_id: str, patch: dict[str, Any] | None = None) -> dict[str, Any]:
    patch = patch or {}
    with _lock:
        chat = None
        for row in _read_all():
            if str(row.get("id")) == str(chat_id):
                chat = normalize_chat(row)
                break
        if not chat:
            chat = empty_chat(chat_id, patch.get("name"))
        if patch.get("name"):
            chat["name"] = str(patch["name"]).strip() or chat["name"]
        for key in ("ip", "city", "country", "countryCode", "geoLabel"):
            if key in patch and patch[key] is not None:
                chat[key] = str(patch[key] or "")
        if "awaitingAgent" in patch and patch["awaitingAgent"] is not None:
            chat["awaitingAgent"] = bool(patch["awaitingAgent"])
        if "agentConnected" in patch and patch["agentConnected"] is not None:
            chat["agentConnected"] = bool(patch["agentConnected"])
        chat["updatedAt"] = _now_ms()
        return _save_unlocked(chat)


def mark_agent_connected(chat_id: str) -> dict[str, Any] | None:
    with _lock:
        chat = None
        for row in _read_all():
            if str(row.get("id")) == str(chat_id):
                chat = normalize_chat(row)
                break
        if not chat:
            return None
        if chat.get("status") == "ended":
            return chat
        chat["agentConnected"] = True
        chat["agentConnectedAt"] = chat.get("agentConnectedAt") or _now_ms()
        chat["awaitingAgent"] = False
        chat["unread"] = 0
        chat["updatedAt"] = _now_ms()
        return _save_unlocked(chat)


def set_typing(chat_id: str, typing: bool) -> dict[str, Any] | None:
    with _lock:
        chat = None
        for row in _read_all():
            if str(row.get("id")) == str(chat_id):
                chat = normalize_chat(row)
                break
        if not chat or chat.get("status") == "ended":
            return chat
        chat["typingAgentAt"] = _now_ms() if typing else None
        chat["updatedAt"] = _now_ms()
        return _save_unlocked(chat)


def end_chat(chat_id: str) -> dict[str, Any] | None:
    with _lock:
        chat = None
        for row in _read_all():
            if str(row.get("id")) == str(chat_id):
                chat = normalize_chat(row)
                break
        if not chat:
            return None
        if chat.get("status") == "ended":
            return chat
        chat["status"] = "ended"
        chat["endedAt"] = _now_ms()
        chat["updatedAt"] = _now_ms()
        chat["unread"] = 0
        chat["awaitingAgent"] = False
        chat["typingAgentAt"] = None
        chat["unreadCustomer"] = int(chat.get("unreadCustomer") or 0) + 1
        chat["customerUnread"] = chat["unreadCustomer"]
        chat["messages"] = list(chat.get("messages") or [])
        chat["messages"].append(
            {
                "from": "system",
                "text": "Conversation ended by support. You can start a new chat anytime.",
                "at": _now_ms(),
            }
        )
        return _save_unlocked(chat)


def clear_all_chats() -> list[dict[str, Any]]:
    with _lock:
        _write_all([])
    return []
