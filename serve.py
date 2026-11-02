#!/usr/bin/env python3
"""Local server for the DSV site + secured admin portal APIs."""

from __future__ import annotations

import hashlib
import hmac
import http.cookies
import http.server
import json
import os
import posixpath
import secrets
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from typing import Any

PORT = int(os.environ.get("PORT", "8080"))
ROOT = os.path.dirname(os.path.abspath(__file__))
SITE_ROOT = os.path.join(ROOT, "www.dsv.com", "www.dsv.com")
SHIPMENTS_PATH = os.path.join(SITE_ROOT, "resource", "data", "shipments.json")


def _load_dotenv(path: str, *, override: bool = False) -> None:
    """Load KEY=VALUE pairs into os.environ from a local .env file."""
    if not os.path.isfile(path):
        return
    try:
        with open(path, encoding="utf-8") as handle:
            for raw in handle:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip()
                if not key:
                    continue
                if not override and key in os.environ:
                    continue
                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                    value = value[1:-1]
                os.environ[key] = value
    except OSError:
        pass


# Project .env is the source of truth for local admin credentials.
_load_dotenv(os.path.join(ROOT, ".env"), override=True)
_load_dotenv(os.path.join(SITE_ROOT, ".env"), override=True)

try:
    import shipment_service
except ImportError:
    shipment_service = None  # type: ignore

try:
    import support_service
except ImportError:
    support_service = None  # type: ignore

# Credentials come from environment / .env — never from frontend code.
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@dsv.com").strip().lower()
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "dsv2026")
PASSWORD_SALT = os.environ.get("ADMIN_PASSWORD_SALT", "dsv-local-admin-salt-v1").encode("utf-8")
SESSION_TTL_SEC = int(os.environ.get("ADMIN_SESSION_TTL", "43200"))  # 12h
COOKIE_NAME = "dsv_admin_session"
LOGIN_WINDOW_SEC = 15 * 60
LOGIN_MAX_ATTEMPTS = 5

_sessions: dict[str, dict[str, Any]] = {}
_login_attempts: dict[str, list[float]] = {}
_lock = threading.Lock()


def _hash_password(password: str) -> str:
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        PASSWORD_SALT,
        120_000,
    )
    return digest.hex()


ADMIN_PASSWORD_HASH = _hash_password(ADMIN_PASSWORD)


def _client_ip(handler: http.server.BaseHTTPRequestHandler) -> str:
    forwarded = handler.headers.get("X-Forwarded-For") or handler.headers.get("X-Real-IP")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return handler.client_address[0] if handler.client_address else "unknown"


def _is_private_ip(ip: str) -> bool:
    value = str(ip or "").strip().lower()
    return (
        not value
        or value in {"unknown", "localhost", "::1"}
        or value.startswith("127.")
        or value.startswith("10.")
        or value.startswith("192.168.")
        or value.startswith("172.16.")
        or value.startswith("172.17.")
        or value.startswith("172.18.")
        or value.startswith("172.19.")
        or value.startswith("172.2")
        or value.startswith("172.3")
        or value.startswith("fc")
        or value.startswith("fd")
    )


def _http_json(url: str, timeout: float = 6.0) -> dict[str, Any]:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "DSV-Logistics-Control/1.0",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _lookup_client_geo(ip: str) -> dict[str, Any]:
    """Resolve a visitor IP to a rough country/city label for support chat."""
    query_ip = str(ip or "").strip()
    public_ip = query_ip
    if _is_private_ip(query_ip):
        try:
            public_ip = str(_http_json("https://api.ipify.org?format=json").get("ip") or "").strip()
        except Exception:
            public_ip = ""

    city = ""
    region = ""
    country = ""
    country_code = ""
    if public_ip and not _is_private_ip(public_ip):
        try:
            data = _http_json(f"https://ipapi.co/{urllib.parse.quote(public_ip)}/json/")
            if not data.get("error"):
                city = str(data.get("city") or "").strip()
                region = str(data.get("region") or data.get("region_code") or "").strip()
                country = str(data.get("country_name") or "").strip()
                country_code = str(data.get("country_code") or "").strip().upper()
        except Exception:
            try:
                data = _http_json(f"http://ip-api.com/json/{urllib.parse.quote(public_ip)}?fields=status,country,countryCode,regionName,city,query")
                if data.get("status") == "success":
                    city = str(data.get("city") or "").strip()
                    region = str(data.get("regionName") or "").strip()
                    country = str(data.get("country") or "").strip()
                    country_code = str(data.get("countryCode") or "").strip().upper()
                    public_ip = str(data.get("query") or public_ip).strip()
            except Exception:
                pass

    place_parts = [p for p in (city, region, country) if p]
    label = ", ".join(place_parts) if place_parts else ("Local network" if _is_private_ip(query_ip) else "Unknown location")
    display_ip = public_ip or query_ip or "unknown"
    return {
        "ip": display_ip,
        "socketIp": query_ip,
        "city": city,
        "region": region,
        "country": country,
        "countryCode": country_code,
        "label": label,
    }


def _rate_limited(ip: str) -> bool:
    now = time.time()
    with _lock:
        stamps = [t for t in _login_attempts.get(ip, []) if now - t < LOGIN_WINDOW_SEC]
        _login_attempts[ip] = stamps
        return len(stamps) >= LOGIN_MAX_ATTEMPTS


def _record_attempt(ip: str) -> None:
    with _lock:
        _login_attempts.setdefault(ip, []).append(time.time())


def _create_session(email: str) -> str:
    token = secrets.token_urlsafe(32)
    with _lock:
        _sessions[token] = {
            "email": email,
            "role": "administrator",
            "created_at": time.time(),
            "expires_at": time.time() + SESSION_TTL_SEC,
        }
    return token


def _get_session(token: str | None) -> dict[str, Any] | None:
    if not token:
        return None
    with _lock:
        session = _sessions.get(token)
        if not session:
            return None
        if session["expires_at"] < time.time():
            _sessions.pop(token, None)
            return None
        session["expires_at"] = time.time() + SESSION_TTL_SEC
        return dict(session)


def _destroy_session(token: str | None) -> None:
    if not token:
        return
    with _lock:
        _sessions.pop(token, None)


def _read_cookie(handler: http.server.BaseHTTPRequestHandler, name: str) -> str | None:
    raw = handler.headers.get("Cookie", "")
    if not raw:
        return None
    jar = http.cookies.SimpleCookie()
    try:
        jar.load(raw)
    except http.cookies.CookieError:
        return None
    morsel = jar.get(name)
    return morsel.value if morsel else None


def _set_cookie(handler: http.server.BaseHTTPRequestHandler, token: str, max_age: int) -> None:
    cookie = http.cookies.SimpleCookie()
    cookie[COOKIE_NAME] = token
    cookie[COOKIE_NAME]["httponly"] = True
    cookie[COOKIE_NAME]["samesite"] = "Lax"
    cookie[COOKIE_NAME]["path"] = "/"
    cookie[COOKIE_NAME]["max-age"] = str(max_age)
    handler.send_header("Set-Cookie", cookie.output(header="").strip())


def _clear_cookie(handler: http.server.BaseHTTPRequestHandler) -> None:
    cookie = http.cookies.SimpleCookie()
    cookie[COOKIE_NAME] = ""
    cookie[COOKIE_NAME]["httponly"] = True
    cookie[COOKIE_NAME]["samesite"] = "Lax"
    cookie[COOKIE_NAME]["path"] = "/"
    cookie[COOKIE_NAME]["max-age"] = "0"
    handler.send_header("Set-Cookie", cookie.output(header="").strip())


def _load_shipments() -> dict[str, Any]:
    if shipment_service is not None:
        return shipment_service.load_shipments()
    try:
        with open(SHIPMENTS_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _progress_book() -> None:
    if shipment_service is None:
        return
    try:
        shipment_service.progress_all()
    except Exception:
        pass


def _json_response(handler: http.server.BaseHTTPRequestHandler, status: int, payload: dict[str, Any]) -> None:
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _read_json_body(handler: http.server.BaseHTTPRequestHandler) -> dict[str, Any]:
    length = int(handler.headers.get("Content-Length", "0") or "0")
    if length <= 0 or length > 500_000:
        return {}
    raw = handler.rfile.read(length)
    try:
        data = json.loads(raw.decode("utf-8"))
        return data if isinstance(data, dict) else {}
    except (UnicodeDecodeError, json.JSONDecodeError):
        return {}


def _require_admin(handler: http.server.BaseHTTPRequestHandler) -> dict[str, Any] | None:
    token = _read_cookie(handler, COOKIE_NAME)
    session = _get_session(token)
    if not session or session.get("role") != "administrator":
        _json_response(handler, 401, {"ok": False, "error": "Unauthorized"})
        return None
    return session


class SiteHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=SITE_ROOT, **kwargs)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        super().end_headers()

    def _clean_path(self) -> str:
        parsed = urllib.parse.urlparse(self.path)
        return posixpath.normpath(urllib.parse.unquote(parsed.path))

    def do_OPTIONS(self):
        clean = self._clean_path()
        if clean.startswith("/api/"):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Credentials", "true")
            self.end_headers()
            return
        self.send_error(404)

    def do_GET(self):
        clean = self._clean_path()

        if clean == "/api/client-info":
            ip = _client_ip(self)
            try:
                geo = _lookup_client_geo(ip)
            except Exception:
                geo = {
                    "ip": ip,
                    "socketIp": ip,
                    "city": "",
                    "region": "",
                    "country": "",
                    "countryCode": "",
                    "label": "Unknown location",
                }
            return _json_response(self, 200, {"ok": True, **geo})

        if clean.startswith("/api/support/"):
            if support_service is None:
                return _json_response(self, 500, {"ok": False, "error": "Support service unavailable."})
            chat_id = urllib.parse.unquote(clean.split("/api/support/", 1)[-1].strip().strip("/"))
            if not chat_id:
                return _json_response(self, 400, {"ok": False, "error": "Missing chat id"})
            chat = support_service.get_chat(chat_id) or support_service.normalize_chat(
                support_service.empty_chat(chat_id)
            )
            return _json_response(self, 200, {"ok": True, "chat": chat})

        if clean == "/api/admin/support":
            session = _require_admin(self)
            if not session:
                return
            if support_service is None:
                return _json_response(self, 500, {"ok": False, "error": "Support service unavailable."})
            chats = support_service.list_chats()
            return _json_response(self, 200, {"ok": True, "chats": chats})

        if clean == "/api/admin/me":
            token = _read_cookie(self, COOKIE_NAME)
            session = _get_session(token)
            if not session:
                return _json_response(self, 401, {"ok": False, "authenticated": False})
            return _json_response(
                self,
                200,
                {
                    "ok": True,
                    "authenticated": True,
                    "user": {"email": session["email"], "role": session["role"]},
                },
            )

        if clean == "/api/admin/shipments":
            session = _require_admin(self)
            if not session:
                return
            _progress_book()
            shipments = _load_shipments()
            rows = []
            for tracking_id, item in shipments.items():
                timeline = item.get("timeline") or []
                last = timeline[-1] if timeline else {}
                rows.append(
                    {
                        "id": tracking_id,
                        "status": item.get("status"),
                        "deliveryStatus": item.get("deliveryStatus"),
                        "serviceType": item.get("serviceType"),
                        "sender": item.get("sender"),
                        "receiver": item.get("receiver"),
                        "fromLocation": item.get("fromLocation"),
                        "toLocation": item.get("toLocation"),
                        "statusNearPlace": item.get("statusNearPlace"),
                        "packageContent": item.get("packageContent"),
                        "signatureRequired": bool(item.get("signatureRequired")),
                        "estimatedDelivery": item.get("estimatedDelivery"),
                        "deliveryTime": item.get("deliveryTime"),
                        "labelCreatedDate": item.get("labelCreatedDate"),
                        "deliveryNotice": item.get("deliveryNotice"),
                        "holdReason": item.get("holdReason"),
                        "cancelReason": item.get("cancelReason"),
                        "statusReason": item.get("statusReason"),
                        "timeline": timeline,
                        "routeStops": item.get("routeStops") or [],
                        "fromLat": item.get("fromLat"),
                        "fromLon": item.get("fromLon"),
                        "toLat": item.get("toLat"),
                        "toLon": item.get("toLon"),
                        "routeDistanceM": item.get("routeDistanceM"),
                        "routeDurationS": item.get("routeDurationS"),
                        "lastEvent": last.get("title"),
                        "lastDate": last.get("date"),
                        "lastLocation": last.get("location"),
                    }
                )
            return _json_response(self, 200, {"ok": True, "shipments": rows, "count": len(rows)})

        if clean == "/api/admin/geo/search":
            session = _require_admin(self)
            if not session:
                return
            if shipment_service is None:
                return _json_response(self, 500, {"ok": False, "error": "Geo service unavailable."})
            query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("q", [""])[0]
            results = shipment_service.search_addresses(query)
            return _json_response(self, 200, {"ok": True, "results": results})

        if clean.startswith("/api/tracking/"):
            tracking_id = urllib.parse.unquote(clean.split("/api/tracking/", 1)[-1].strip())
            _progress_book()
            shipments = _load_shipments()
            item = None
            if shipment_service is not None:
                key, item = shipment_service.find_shipment(shipments, tracking_id)
                if key:
                    tracking_id = key
            else:
                item = shipments.get(tracking_id)
                if not item:
                    for key, value in shipments.items():
                        if str(key).upper() == tracking_id.upper():
                            item = value
                            tracking_id = key
                            break
            if not item:
                return _json_response(self, 404, {"ok": False, "error": "Tracking not found."})
            public = (
                shipment_service.public_item(item)
                if shipment_service is not None
                else item
            )
            return _json_response(self, 200, {"ok": True, "id": tracking_id, "shipment": public})

        if clean == "/api/admin/summary":
            session = _require_admin(self)
            if not session:
                return
            _progress_book()
            shipments = _load_shipments()
            counts = {
                "total": 0,
                "inTransit": 0,
                "outForDelivery": 0,
                "delivered": 0,
                "pending": 0,
                "exception": 0,
            }
            for item in shipments.values():
                counts["total"] += 1
                status = str(item.get("status") or "").lower()
                if status == "delivered":
                    counts["delivered"] += 1
                elif status == "out-for-delivery":
                    counts["outForDelivery"] += 1
                elif status == "in-transit":
                    counts["inTransit"] += 1
                elif status == "exception":
                    counts["exception"] += 1
                    counts["pending"] += 1
                else:
                    counts["pending"] += 1
            counts["active"] = counts["inTransit"] + counts["outForDelivery"]
            return _json_response(self, 200, {"ok": True, "summary": counts})

        # Protected admin application pages
        if clean in {"/admin/app", "/admin/app/", "/admin/dashboard", "/admin/dashboard/"}:
            token = _read_cookie(self, COOKIE_NAME)
            if not _get_session(token):
                self.send_response(302)
                self.send_header("Location", "/admin/login")
                self.end_headers()
                return
            return self._serve_file(os.path.join(SITE_ROOT, "admin", "app.html"))

        return super().do_GET()

    def do_POST(self):
        clean = self._clean_path()

        if clean == "/api/admin/login":
            ip = _client_ip(self)
            if _rate_limited(ip):
                return _json_response(
                    self,
                    429,
                    {"ok": False, "error": "Too many login attempts. Try again later."},
                )

            payload = _read_json_body(self)
            email = str(payload.get("email") or "").strip().lower()
            password = str(payload.get("password") or "")
            remember = bool(payload.get("remember"))

            if not email or "@" not in email or not password:
                _record_attempt(ip)
                return _json_response(self, 400, {"ok": False, "error": "Enter a valid email and password."})

            email_ok = hmac.compare_digest(email, ADMIN_EMAIL)
            pass_ok = hmac.compare_digest(_hash_password(password), ADMIN_PASSWORD_HASH)
            if not (email_ok and pass_ok):
                _record_attempt(ip)
                return _json_response(self, 401, {"ok": False, "error": "Invalid administrator credentials."})

            token = _create_session(email)
            max_age = SESSION_TTL_SEC if remember else 0
            body = json.dumps(
                {
                    "ok": True,
                    "user": {"email": email, "role": "administrator"},
                    "redirect": "/admin/app",
                }
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            if remember:
                _set_cookie(self, token, max_age)
            else:
                # Session cookie (browser session) still HttpOnly.
                cookie = http.cookies.SimpleCookie()
                cookie[COOKIE_NAME] = token
                cookie[COOKIE_NAME]["httponly"] = True
                cookie[COOKIE_NAME]["samesite"] = "Lax"
                cookie[COOKIE_NAME]["path"] = "/"
                self.send_header("Set-Cookie", cookie.output(header="").strip())
            self.end_headers()
            self.wfile.write(body)
            return

        if clean == "/api/admin/logout":
            token = _read_cookie(self, COOKIE_NAME)
            _destroy_session(token)
            body = json.dumps({"ok": True}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            _clear_cookie(self)
            self.end_headers()
            self.wfile.write(body)
            return

        if clean.startswith("/api/support/"):
            if support_service is None:
                return _json_response(self, 500, {"ok": False, "error": "Support service unavailable."})
            chat_id = urllib.parse.unquote(clean.split("/api/support/", 1)[-1].strip().strip("/"))
            if not chat_id:
                return _json_response(self, 400, {"ok": False, "error": "Missing chat id"})
            payload = _read_json_body(self)
            action = str(payload.get("action") or "message")
            if action == "read":
                chat = support_service.mark_customer_read(chat_id) or support_service.normalize_chat(
                    support_service.empty_chat(chat_id)
                )
                return _json_response(self, 200, {"ok": True, "chat": chat})
            if action == "meta":
                chat = support_service.patch_chat_meta(
                    chat_id,
                    {
                        "name": payload.get("name"),
                        "ip": payload.get("ip"),
                        "city": payload.get("city"),
                        "country": payload.get("country"),
                        "countryCode": payload.get("countryCode"),
                        "geoLabel": payload.get("geoLabel"),
                        "awaitingAgent": payload.get("awaitingAgent"),
                    },
                )
                return _json_response(self, 200, {"ok": True, "chat": chat})
            text = str(payload.get("text") or "").strip()
            if not text:
                return _json_response(self, 400, {"ok": False, "error": "Message required"})
            from_role = payload.get("from")
            if from_role == "bot":
                frm = "bot"
            elif from_role == "system":
                frm = "system"
            else:
                frm = "customer"
            chat = support_service.append_message(
                chat_id,
                {"from": frm, "text": text, "at": int(time.time() * 1000)},
                {
                    "name": payload.get("name"),
                    "awaitingAgent": False if frm != "customer" else payload.get("awaitingAgent", True),
                    "geo": {
                        "ip": payload.get("ip"),
                        "city": payload.get("city"),
                        "country": payload.get("country"),
                        "countryCode": payload.get("countryCode"),
                        "geoLabel": payload.get("geoLabel"),
                    },
                },
            )
            return _json_response(self, 200, {"ok": True, "chat": chat})

        if clean == "/api/admin/support":
            session = _require_admin(self)
            if not session:
                return
            if support_service is None:
                return _json_response(self, 500, {"ok": False, "error": "Support service unavailable."})
            payload = _read_json_body(self)
            action = str(payload.get("action") or "message")
            if action == "clear-all":
                support_service.clear_all_chats()
                return _json_response(self, 200, {"ok": True, "chats": []})
            chat_id = str(payload.get("id") or "").strip()
            if not chat_id:
                return _json_response(self, 400, {"ok": False, "error": "Missing chat id"})
            if action == "read":
                return _json_response(self, 200, {"ok": True, "chat": support_service.mark_admin_read(chat_id)})
            if action == "open":
                return _json_response(self, 200, {"ok": True, "chat": support_service.mark_agent_connected(chat_id)})
            if action == "typing":
                return _json_response(
                    self,
                    200,
                    {"ok": True, "chat": support_service.set_typing(chat_id, payload.get("typing", True) is not False)},
                )
            if action == "end":
                return _json_response(self, 200, {"ok": True, "chat": support_service.end_chat(chat_id)})
            text = str(payload.get("text") or "").strip()
            if not text:
                return _json_response(self, 400, {"ok": False, "error": "Message required"})
            chat = support_service.append_message(
                chat_id,
                {"from": "agent", "text": text, "at": int(time.time() * 1000)},
            )
            return _json_response(self, 200, {"ok": True, "chat": chat})

        if clean == "/api/admin/shipments":
            session = _require_admin(self)
            if not session:
                return
            if shipment_service is None:
                return _json_response(self, 500, {"ok": False, "error": "Shipment service unavailable."})
            payload = _read_json_body(self)
            try:
                created = shipment_service.create_shipment(payload)
            except ValueError as err:
                return _json_response(self, 400, {"ok": False, "error": str(err)})
            except Exception as err:
                return _json_response(self, 502, {"ok": False, "error": "Could not build route map: %s" % err})
            return _json_response(self, 201, {"ok": True, **created})

        if clean == "/api/admin/shipments/preview-route":
            session = _require_admin(self)
            if not session:
                return
            if shipment_service is None:
                return _json_response(self, 500, {"ok": False, "error": "Shipment service unavailable."})
            payload = _read_json_body(self)
            try:
                preview = shipment_service.preview_route(payload)
            except ValueError as err:
                return _json_response(self, 400, {"ok": False, "error": str(err)})
            except Exception as err:
                return _json_response(self, 502, {"ok": False, "error": "Route preview failed: %s" % err})
            return _json_response(self, 200, {"ok": True, "preview": preview})

        self.send_error(404)

    def do_PATCH(self):
        clean = self._clean_path()
        if not clean.startswith("/api/admin/shipments/"):
            self.send_error(404)
            return

        session = _require_admin(self)
        if not session:
            return
        if shipment_service is None:
            return _json_response(self, 500, {"ok": False, "error": "Shipment service unavailable."})

        tracking_id = clean.split("/api/admin/shipments/", 1)[-1].strip().strip("/")
        if not tracking_id or tracking_id in {"preview-route"}:
            return _json_response(self, 400, {"ok": False, "error": "Missing shipment id"})

        payload = _read_json_body(self)
        action = str(payload.get("action") or "edit").strip().lower()

        try:
            if action == "hold":
                result = shipment_service.hold_shipment(tracking_id, payload.get("reason"))
            elif action in {"release-hold", "release"}:
                result = shipment_service.release_hold(
                    tracking_id, payload.get("note") or payload.get("reason")
                )
            elif action == "cancel":
                result = shipment_service.cancel_shipment(tracking_id, payload.get("reason"))
            elif action in {"edit", "update"}:
                result = shipment_service.update_shipment(tracking_id, payload)
            else:
                return _json_response(
                    self,
                    400,
                    {
                        "ok": False,
                        "error": "Unsupported action. Use edit, hold, release-hold, or cancel.",
                    },
                )
        except LookupError as err:
            return _json_response(self, 404, {"ok": False, "error": str(err)})
        except ValueError as err:
            return _json_response(self, 400, {"ok": False, "error": str(err)})
        except Exception as err:
            return _json_response(self, 500, {"ok": False, "error": "Shipment action failed: %s" % err})

        return _json_response(self, 200, {"ok": True, **result})

    def do_PUT(self):
        return self.do_PATCH()

    def do_DELETE(self):
        clean = self._clean_path()

        if clean == "/api/admin/support":
            session = _require_admin(self)
            if not session:
                return
            if support_service is None:
                return _json_response(self, 500, {"ok": False, "error": "Support service unavailable."})
            support_service.clear_all_chats()
            return _json_response(self, 200, {"ok": True, "chats": []})

        if not clean.startswith("/api/admin/shipments/"):
            self.send_error(404)
            return

        session = _require_admin(self)
        if not session:
            return
        if shipment_service is None:
            return _json_response(self, 500, {"ok": False, "error": "Shipment service unavailable."})

        tracking_id = clean.split("/api/admin/shipments/", 1)[-1].strip().strip("/")
        if not tracking_id or tracking_id in {"preview-route"}:
            return _json_response(self, 400, {"ok": False, "error": "Missing shipment id"})

        try:
            result = shipment_service.delete_shipment(tracking_id)
        except LookupError as err:
            return _json_response(self, 404, {"ok": False, "error": str(err)})
        except Exception as err:
            return _json_response(self, 500, {"ok": False, "error": "Delete failed: %s" % err})

        return _json_response(self, 200, {"ok": True, **result})

    def translate_path(self, path: str) -> str:
        parsed = urllib.parse.urlparse(path)
        clean = posixpath.normpath(urllib.parse.unquote(parsed.path))
        if clean in {"/", "", "/en"}:
            return os.path.join(SITE_ROOT, "en.html")
        if clean in {"/admin", "/admin/", "/admin/login", "/admin/login/"}:
            return os.path.join(SITE_ROOT, "admin", "login.html")
        if clean in {"/admin/app", "/admin/app/", "/admin/dashboard", "/admin/dashboard/"}:
            return os.path.join(SITE_ROOT, "admin", "app.html")
        if clean in {
            "/new/tracking/shipment-details-public",
            "/tracking/shipment-details-public",
            "/shipment-details-public",
        }:
            return os.path.join(SITE_ROOT, "shipment-details-public.html")

        relative = clean.lstrip("/")
        candidates = [
            os.path.join(SITE_ROOT, relative),
            os.path.join(SITE_ROOT, relative + ".html"),
            os.path.join(SITE_ROOT, relative.replace(":", "")),
            os.path.join(SITE_ROOT, relative.replace(":", "") + ".html"),
        ]

        basename = os.path.basename(relative)
        if "." not in basename:
            candidates.insert(1, os.path.join(SITE_ROOT, relative, "index.html"))

        for candidate in candidates:
            if os.path.isfile(candidate):
                return candidate
            if os.path.isdir(candidate):
                index = os.path.join(candidate, "index.html")
                if os.path.isfile(index):
                    return index

        return super().translate_path(path)

    def _serve_file(self, absolute_path: str) -> None:
        if not os.path.isfile(absolute_path):
            self.send_error(404)
            return
        self.path = "/" + os.path.relpath(absolute_path, SITE_ROOT).replace(os.sep, "/")
        return http.server.SimpleHTTPRequestHandler.do_GET(self)


def main() -> None:
    if not os.path.isfile(os.path.join(SITE_ROOT, "en.html")):
        sys.exit("Could not find en.html. Expected it at %s" % SITE_ROOT)

    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), SiteHandler)
    url = "http://127.0.0.1:%s/" % PORT
    print("Serving DSV site from:")
    print("  %s" % SITE_ROOT)
    print("Admin login:")
    print("  http://127.0.0.1:%s/admin/login" % PORT)
    print("Admin credentials (from .env / environment):")
    print("  email: %s" % ADMIN_EMAIL)
    print("Open this address in your browser:")
    print("  %s" % url)
    print("Press Ctrl+C to stop.")
    if "--no-browser" not in sys.argv:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        server.server_close()


if __name__ == "__main__":
    main()
