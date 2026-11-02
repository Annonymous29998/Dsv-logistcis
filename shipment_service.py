"""Shipment persistence, geocoding, and route-based travel history."""

from __future__ import annotations

import json
import math
import os
import random
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any

ROOT = os.path.dirname(os.path.abspath(__file__))
SITE_ROOT = os.path.join(ROOT, "www.dsv.com", "www.dsv.com")
SHIPMENTS_PATH = os.path.join(SITE_ROOT, "resource", "data", "shipments.json")
TRACKING_JS_PATH = os.path.join(SITE_ROOT, "resource", "js", "tracking-data.js")

NOMINATIM_SEARCH = "https://nominatim.openstreetmap.org/search"
NOMINATIM_REVERSE = "https://nominatim.openstreetmap.org/reverse"
OSRM_ROUTE = "https://router.project-osrm.org/route/v1/driving/"
USER_AGENT = "DSV-Local-Logistics-Control/1.0 (admin portal)"


def _http_json(url: str, timeout: float = 12.0) -> Any:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def load_shipments() -> dict[str, Any]:
    try:
        with open(SHIPMENTS_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def public_item(item: dict[str, Any]) -> dict[str, Any]:
    skip = {
        "routeGeometry",
        "routeStops",
        "plannedEvents",
        "createdAt",
        "etaAt",
        "progressUpdatedAt",
        "fromLat",
        "fromLon",
        "toLat",
        "toLon",
        "routeDistanceM",
        "routeDurationS",
    }
    return {k: v for k, v in item.items() if k not in skip}


def _public_item(item: dict[str, Any]) -> dict[str, Any]:
    return public_item(item)


def save_shipments(shipments: dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(SHIPMENTS_PATH), exist_ok=True)
    with open(SHIPMENTS_PATH, "w", encoding="utf-8") as fh:
        json.dump(shipments, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    public: dict[str, Any] = {}
    for tid, item in shipments.items():
        if isinstance(item, dict):
            public[tid] = _public_item(item)
    with open(TRACKING_JS_PATH, "w", encoding="utf-8") as fh:
        fh.write("window.DSV_SHIPMENTS = ")
        json.dump(public, fh, indent=2, ensure_ascii=False)
        fh.write(";\n")


def generate_tracking_id(existing: dict[str, Any]) -> str:
    for _ in range(40):
        tid = "".join(str(random.randint(0, 9)) for _ in range(12))
        if tid not in existing:
            return tid
    return str(int(time.time() * 1000))[-12:]


def _address_primary(row: dict[str, Any], label: str) -> str:
    """Match Prime Business Grant / Nominatim display: name, then street bits, then first label part."""
    name = str(row.get("name") or "").strip()
    if name:
        return name
    addr = row.get("address") if isinstance(row.get("address"), dict) else {}
    house = str(addr.get("house_number") or "").strip()
    road = str(
        addr.get("road")
        or addr.get("pedestrian")
        or addr.get("residential")
        or addr.get("path")
        or ""
    ).strip()
    if road:
        return f"{house} {road}".strip() if house else road
    for key in (
        "neighbourhood",
        "suburb",
        "hamlet",
        "village",
        "town",
        "city",
        "municipality",
        "county",
        "state",
    ):
        val = str(addr.get(key) or "").strip()
        if val:
            return val
    return label.split(",")[0].strip()


def search_addresses(query: str, limit: int = 8) -> list[dict[str, Any]]:
    """Worldwide Nominatim forward search (all countries — never set countrycodes)."""
    q = (query or "").strip()
    if len(q) < 3:
        return []
    # Intentionally omit countrycodes so results cover every country.
    params = urllib.parse.urlencode(
        {
            "q": q,
            "format": "jsonv2",
            "addressdetails": 1,
            "limit": max(1, min(limit, 10)),
            "accept-language": "en",
        }
    )
    try:
        req = urllib.request.Request(
            f"{NOMINATIM_SEARCH}?{params}",
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "application/json",
                "Accept-Language": "en",
            },
        )
        with urllib.request.urlopen(req, timeout=12.0) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError):
        return []
    if not isinstance(data, list):
        return []
    results = []
    seen = set()
    for row in data:
        try:
            lat = float(row.get("lat"))
            lon = float(row.get("lon"))
        except (TypeError, ValueError):
            continue
        label = str(row.get("display_name") or "").strip()
        if not label:
            continue
        key = label.lower()
        if key in seen:
            continue
        seen.add(key)
        primary = _address_primary(row, label)
        secondary = label
        if primary and label.lower().startswith(primary.lower()):
            rest = label[len(primary) :].lstrip(" ,")
            secondary = rest or label
        results.append(
            {
                "label": label,
                "primary": primary,
                "secondary": secondary,
                "lat": lat,
                "lon": lon,
                "type": row.get("type") or row.get("category") or row.get("class") or "",
            }
        )
    return results


def geocode_address(query: str) -> dict[str, Any] | None:
    hits = search_addresses(query, limit=1)
    return hits[0] if hits else None


def reverse_label(lat: float, lon: float) -> str:
    params = urllib.parse.urlencode(
        {
            "lat": f"{lat:.6f}",
            "lon": f"{lon:.6f}",
            "format": "json",
            "zoom": 12,
        }
    )
    try:
        data = _http_json(f"{NOMINATIM_REVERSE}?{params}")
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError):
        return f"{lat:.3f}, {lon:.3f}"
    addr = data.get("address") if isinstance(data, dict) else None
    if isinstance(addr, dict):
        city = (
            addr.get("city")
            or addr.get("town")
            or addr.get("village")
            or addr.get("municipality")
            or addr.get("county")
            or ""
        )
        state = addr.get("state") or addr.get("region") or ""
        country = addr.get("country_code") or ""
        parts = [p for p in [city, state] if p]
        if parts:
            label = ", ".join(parts)
            if country:
                label += f", {country.upper()}"
            return label.upper()
    display = str((data or {}).get("display_name") or "").strip()
    if display:
        bits = [b.strip() for b in display.split(",")[:3] if b.strip()]
        return ", ".join(bits).upper()
    return f"{lat:.3f}, {lon:.3f}"


def fetch_route(from_lat: float, from_lon: float, to_lat: float, to_lon: float) -> dict[str, Any] | None:
    coords = f"{from_lon:.6f},{from_lat:.6f};{to_lon:.6f},{to_lat:.6f}"
    url = f"{OSRM_ROUTE}{coords}?overview=full&geometries=geojson"
    try:
        data = _http_json(url)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError):
        return None
    routes = data.get("routes") if isinstance(data, dict) else None
    if not routes:
        return None
    route = routes[0]
    geometry = route.get("geometry") or {}
    coords_list = geometry.get("coordinates") or []
    if len(coords_list) < 2:
        return None
    return {
        "distanceM": float(route.get("distance") or 0),
        "durationS": float(route.get("duration") or 0),
        "coordinates": coords_list,  # [lon, lat]
    }


def _sample_route_points(coordinates: list[list[float]], count: int) -> list[tuple[float, float]]:
    if count <= 0 or len(coordinates) < 2:
        return []
    # Evenly sample excluding exact start/end
    idxs = []
    n = len(coordinates)
    for i in range(1, count + 1):
        t = i / (count + 1)
        idxs.append(min(n - 2, max(1, int(round(t * (n - 1))))))
    # de-dupe while preserving order
    seen = set()
    points: list[tuple[float, float]] = []
    for i in idxs:
        if i in seen:
            continue
        seen.add(i)
        lon, lat = coordinates[i][0], coordinates[i][1]
        points.append((float(lat), float(lon)))
    return points


def _format_stamp(dt: datetime) -> str:
    # Match existing book style: 07/10/2026 1:45 PM
    hour12 = dt.strftime("%I").lstrip("0") or "12"
    return f"{dt.strftime('%m/%d/%Y')} {hour12}:{dt.strftime('%M %p')}"


def _format_eta(dt: datetime) -> str:
    return f"{dt.strftime('%A')}, {dt.strftime('%m/%d/%Y')} by end of day"


def _status_meta(status: str) -> tuple[str, str]:
    s = (status or "in-transit").lower()
    mapping = {
        "label-created": ("label-created", "Label Created"),
        "pending": ("pending", "Pending"),
        "in-transit": ("in-transit", "In Transit"),
        "out-for-delivery": ("out-for-delivery", "Out For Delivery"),
        "delivered": ("delivered", "Delivered"),
        "exception": ("exception", "Delayed / Exception"),
        "on-hold": ("on-hold", "On Hold"),
        "cancelled": ("cancelled", "Cancelled"),
    }
    return mapping.get(s, ("in-transit", "In Transit"))


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


def _append_timeline(item: dict[str, Any], title: str, detail: str | None = None) -> None:
    timeline = list(item.get("timeline") or [])
    location = detail or item.get("statusNearPlace") or item.get("toLocation") or ""
    timeline.append(
        {
            "title": title,
            "location": location,
            "date": _format_stamp(datetime.now(timezone.utc).astimezone()),
        }
    )
    item["timeline"] = timeline
    events = list(item.get("adminEvents") or [])
    events.append({"at": _now_iso(), "action": title.lower().replace(" ", "-"), "reason": detail})
    item["adminEvents"] = events


def find_shipment(shipments: dict[str, Any], tracking_id: str) -> tuple[str | None, dict[str, Any] | None]:
    raw = str(tracking_id or "").strip()
    if not raw:
        return None, None
    if raw in shipments and isinstance(shipments[raw], dict):
        return raw, shipments[raw]
    needle = raw.upper()
    matches: list[str] = []
    for key, value in shipments.items():
        if not isinstance(value, dict):
            continue
        key_u = str(key).upper()
        if key_u == needle:
            return key, value
        # Allow short display IDs from admin UI (#000001 → DEMO100000001)
        if needle.isdigit() and key_u.endswith(needle.zfill(6) if len(needle) <= 6 else needle):
            matches.append(key)
        elif len(needle) >= 4 and key_u.endswith(needle):
            matches.append(key)
    if len(matches) == 1:
        key = matches[0]
        return key, shipments[key]
    return None, None


def hold_shipment(tracking_id: str, reason: str) -> dict[str, Any]:
    why = str(reason or "").strip()
    if not why:
        raise ValueError("A hold reason is required.")
    shipments = load_shipments()
    key, item = find_shipment(shipments, tracking_id)
    if not key or not item:
        raise LookupError("Shipment not found.")
    current = str(item.get("status") or "").lower()
    if current == "cancelled":
        raise ValueError("Cannot hold a cancelled shipment.")
    if current == "delivered":
        raise ValueError("Cannot hold a delivered shipment.")
    if current != "on-hold":
        item["previousStatus"] = item.get("status")
    item["status"] = "on-hold"
    item["deliveryStatus"] = "On Hold"
    item["holdReason"] = why
    item["statusReason"] = why
    item["heldAt"] = _now_iso()
    item["outForDeliveryToday"] = False
    _append_timeline(item, "ON HOLD", why)
    shipments[key] = item
    save_shipments(shipments)
    return {"id": key, "shipment": public_item(item)}


def release_hold(tracking_id: str, note: str | None = None) -> dict[str, Any]:
    shipments = load_shipments()
    key, item = find_shipment(shipments, tracking_id)
    if not key or not item:
        raise LookupError("Shipment not found.")
    if str(item.get("status") or "").lower() != "on-hold":
        raise ValueError("Shipment is not on hold.")
    resume = str(item.get("previousStatus") or "in-transit")
    status, delivery_status = _status_meta(resume)
    note_text = str(note or "").strip()
    item["status"] = status
    item["deliveryStatus"] = delivery_status
    item["previousStatus"] = None
    item["holdReason"] = None
    item["statusReason"] = note_text or None
    item["heldAt"] = None
    _append_timeline(item, "HOLD RELEASED", note_text or "Shipment released from hold")
    shipments[key] = item
    save_shipments(shipments)
    return {"id": key, "shipment": public_item(item)}


def cancel_shipment(tracking_id: str, reason: str) -> dict[str, Any]:
    why = str(reason or "").strip()
    if not why:
        raise ValueError("A cancel reason is required.")
    shipments = load_shipments()
    key, item = find_shipment(shipments, tracking_id)
    if not key or not item:
        raise LookupError("Shipment not found.")
    if str(item.get("status") or "").lower() == "delivered":
        raise ValueError("Delivered shipments cannot be cancelled.")
    item["status"] = "cancelled"
    item["deliveryStatus"] = "Cancelled"
    item["cancelReason"] = why
    item["statusReason"] = why
    item["cancelledAt"] = _now_iso()
    item["outForDeliveryToday"] = False
    item["holdReason"] = None
    item["heldAt"] = None
    _append_timeline(item, "CANCELLED", why)
    shipments[key] = item
    save_shipments(shipments)
    return {"id": key, "shipment": public_item(item)}


def delete_shipment(tracking_id: str) -> dict[str, Any]:
    shipments = load_shipments()
    key, item = find_shipment(shipments, tracking_id)
    if not key or not item:
        raise LookupError("Shipment not found.")
    del shipments[key]
    save_shipments(shipments)
    return {"id": key, "deleted": True}


def update_shipment(tracking_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    shipments = load_shipments()
    key, item = find_shipment(shipments, tracking_id)
    if not key or not item:
        raise LookupError("Shipment not found.")
    if str(item.get("status") or "").lower() == "cancelled":
        raise ValueError("Cancelled shipments cannot be edited. Create a new tracking instead.")

    editable = [
        "sender",
        "receiver",
        "packageContent",
        "serviceType",
        "deliveryTime",
        "estimatedDelivery",
        "signatureRequired",
        "statusNearPlace",
        "fromLocation",
        "toLocation",
    ]
    for field in editable:
        if field in payload and payload[field] is not None:
            if field == "signatureRequired":
                item[field] = bool(payload[field])
            else:
                item[field] = str(payload[field]).strip()

    if payload.get("status"):
        status, delivery_status = _status_meta(str(payload.get("status")))
        if status in {"on-hold", "cancelled"}:
            raise ValueError("Use the hold or cancel actions to change to those statuses.")
        item["status"] = status
        item["deliveryStatus"] = delivery_status

    note = str(payload.get("reason") or "Shipment details updated").strip() or "Shipment details updated"
    _append_timeline(item, "DETAILS UPDATED", note)
    shipments[key] = item
    save_shipments(shipments)
    return {"id": key, "shipment": public_item(item)}


def build_route_plan(
    from_label: str,
    to_label: str,
    from_lat: float,
    from_lon: float,
    to_lat: float,
    to_lon: float,
    transit_hours: float = 72.0,
) -> dict[str, Any]:
    route = fetch_route(from_lat, from_lon, to_lat, to_lon)
    coords = (route or {}).get("coordinates") or []
    if not coords:
        # Straight-line fallback samples
        coords = []
        for i in range(12):
            t = i / 11
            lon = from_lon + (to_lon - from_lon) * t
            lat = from_lat + (to_lat - from_lat) * t
            coords.append([lon, lat])
        distance_m = math.hypot((to_lon - from_lon) * 111320 * math.cos(math.radians(from_lat)), (to_lat - from_lat) * 110540)
        duration_s = max(3600.0, transit_hours * 3600.0)
    else:
        distance_m = float(route["distanceM"])
        duration_s = float(route["durationS"]) or transit_hours * 3600.0

    mid_points = _sample_route_points(coords, 4)
    stops: list[dict[str, Any]] = [
        {"lat": from_lat, "lon": from_lon, "label": from_label, "kind": "origin"}
    ]
    for lat, lon in mid_points:
        # Soft rate-limit Nominatim
        time.sleep(0.35)
        stops.append(
            {
                "lat": lat,
                "lon": lon,
                "label": reverse_label(lat, lon),
                "kind": "transit",
            }
        )
    stops.append({"lat": to_lat, "lon": to_lon, "label": to_label, "kind": "destination"})

    now = datetime.now(timezone.utc).astimezone()
    # Prefer planned transit window; stretch OSRM duration to at least transit_hours for demo realism
    total_hours = max(transit_hours, duration_s / 3600.0 * 1.15)
    eta = now + timedelta(hours=total_hours)

    planned: list[dict[str, Any]] = []
    # Event schedule fractions along the journey
    planned.append(
        {
            "title": "LABEL CREATED",
            "location": f"FROM {from_label}",
            "fraction": 0.0,
            "stopIndex": 0,
        }
    )
    planned.append(
        {
            "title": "PACKAGE RECEIVED BY DSV",
            "location": stops[0]["label"].split(",")[0].upper() if stops else from_label,
            "fraction": 0.06,
            "stopIndex": 0,
        }
    )
    transit_stops = [i for i, s in enumerate(stops) if s["kind"] == "transit"]
    for idx, stop_i in enumerate(transit_stops):
        frac = 0.15 + (0.65 * (idx + 1) / max(1, len(transit_stops) + 1))
        planned.append(
            {
                "title": "IN TRANSIT",
                "location": stops[stop_i]["label"],
                "fraction": frac,
                "stopIndex": stop_i,
            }
        )
    planned.append(
        {
            "title": "OUT FOR DELIVERY",
            "location": to_label,
            "fraction": 0.9,
            "stopIndex": len(stops) - 1,
        }
    )
    planned.append(
        {
            "title": "DELIVERED",
            "location": to_label,
            "fraction": 1.0,
            "stopIndex": len(stops) - 1,
        }
    )

    for event in planned:
        when = now + timedelta(hours=total_hours * float(event["fraction"]))
        event["date"] = _format_stamp(when)
        event["at"] = when.isoformat()

    near = stops[0]["label"]
    if "," in near:
        near = ", ".join([p.strip() for p in near.split(",")[:2] if p.strip()])

    return {
        "distanceM": distance_m,
        "durationS": duration_s,
        "etaAt": eta.isoformat(),
        "estimatedDelivery": _format_eta(eta),
        "routeStops": stops,
        "plannedEvents": planned,
        "statusNearPlace": near,
        "labelCreatedDate": now.strftime("%m/%d/%Y"),
        "createdAt": now.isoformat(),
    }


def timeline_for_status(planned_events: list[dict[str, Any]], status: str) -> list[dict[str, Any]]:
    status = (status or "in-transit").lower()
    if status in {"label-created", "pending"}:
        max_title = {"LABEL CREATED"}
    elif status == "in-transit":
        max_title = {"LABEL CREATED", "PACKAGE RECEIVED BY DSV", "IN TRANSIT"}
    elif status == "out-for-delivery":
        max_title = {"LABEL CREATED", "PACKAGE RECEIVED BY DSV", "IN TRANSIT", "OUT FOR DELIVERY"}
    elif status == "delivered":
        max_title = {"LABEL CREATED", "PACKAGE RECEIVED BY DSV", "IN TRANSIT", "OUT FOR DELIVERY", "DELIVERED"}
    else:
        max_title = {"LABEL CREATED", "PACKAGE RECEIVED BY DSV", "IN TRANSIT"}

    out = []
    for ev in planned_events:
        title = ev.get("title")
        if title not in max_title:
            break
        out.append(
            {
                "title": title,
                "location": ev.get("location"),
                "date": ev.get("date"),
            }
        )
        # For in-transit keep all transit stops that are already scheduled before OFD
        if status == "in-transit" and title == "IN TRANSIT":
            continue
        if status in {"label-created", "pending"} and title == "LABEL CREATED":
            break
    # Ensure at least label created
    if not out and planned_events:
        ev = planned_events[0]
        out = [{"title": ev["title"], "location": ev["location"], "date": ev["date"]}]
    return out


def progress_shipment(item: dict[str, Any], force: bool = False) -> bool:
    """Advance timeline/status from stored route plan using elapsed time. Returns True if changed."""
    current = str(item.get("status") or "").lower()
    if current in {"on-hold", "cancelled", "delivered"}:
        return False
    planned = item.get("plannedEvents") or []
    created_raw = item.get("createdAt")
    eta_raw = item.get("etaAt")
    if not planned or not created_raw or not eta_raw:
        return False

    try:
        created = datetime.fromisoformat(created_raw)
        eta = datetime.fromisoformat(eta_raw)
    except ValueError:
        return False

    now = datetime.now(timezone.utc).astimezone()
    total = max(1.0, (eta - created).total_seconds())
    frac = max(0.0, min(1.0, (now - created).total_seconds() / total))

    visible = []
    current_title = "LABEL CREATED"
    for ev in planned:
        if float(ev.get("fraction") or 0) <= frac + 1e-9:
            visible.append(
                {
                    "title": ev.get("title"),
                    "location": ev.get("location"),
                    "date": ev.get("date"),
                }
            )
            current_title = ev.get("title") or current_title

    if not visible:
        return False

    # Never regress history the admin already published.
    existing = item.get("timeline") or []
    if len(visible) < len(existing):
        return False

    title = (current_title or "").upper()
    if title == "DELIVERED":
        status, delivery_status = "delivered", "Delivered"
    elif title == "OUT FOR DELIVERY":
        status, delivery_status = "out-for-delivery", "Out For Delivery"
    elif title in {"IN TRANSIT", "PACKAGE RECEIVED BY DSV"}:
        status, delivery_status = "in-transit", "In Transit"
    else:
        status, delivery_status = "pending", "Pending"

    rank = {
        "pending": 0,
        "label-created": 0,
        "in-transit": 1,
        "out-for-delivery": 2,
        "delivered": 3,
        "exception": 1,
    }
    old_rank = rank.get(str(item.get("status") or "").lower(), 0)
    new_rank = rank.get(status, 0)
    if new_rank < old_rank:
        status = str(item.get("status") or status)
        delivery_status = str(item.get("deliveryStatus") or delivery_status)

    changed = False
    if item.get("timeline") != visible:
        item["timeline"] = visible
        changed = True
    if item.get("status") != status and new_rank >= old_rank:
        item["status"] = status
        changed = True
    if item.get("deliveryStatus") != delivery_status and new_rank >= old_rank:
        item["deliveryStatus"] = delivery_status
        changed = True

    # Near place from latest event
    last_loc = visible[-1].get("location") if visible else None
    if last_loc:
        near = re.sub(r"^FROM\s+", "", str(last_loc), flags=re.I)
        bits = [b.strip() for b in near.split(",")[:2] if b.strip()]
        near_place = ", ".join(bits)
        if near_place and item.get("statusNearPlace") != near_place:
            item["statusNearPlace"] = near_place
            changed = True

    if status == "out-for-delivery":
        item["outForDeliveryToday"] = True
    elif "outForDeliveryToday" in item and status != "out-for-delivery":
        item.pop("outForDeliveryToday", None)
        changed = True

    if changed or force:
        item["progressUpdatedAt"] = now.isoformat()
    return changed


def create_shipment(payload: dict[str, Any]) -> dict[str, Any]:
    shipments = load_shipments()

    sender = str(payload.get("sender") or "").strip()
    receiver = str(payload.get("receiver") or "").strip()
    from_location = str(payload.get("fromLocation") or "").strip()
    to_location = str(payload.get("toLocation") or "").strip()
    if not sender or not receiver or not from_location or not to_location:
        raise ValueError("Sender, receiver, from, and to addresses are required.")

    from_lat = payload.get("fromLat")
    from_lon = payload.get("fromLon")
    to_lat = payload.get("toLat")
    to_lon = payload.get("toLon")

    if from_lat is None or from_lon is None:
        geo = geocode_address(from_location)
        if not geo:
            raise ValueError("Could not find the origin address on the map.")
        from_lat, from_lon = geo["lat"], geo["lon"]
        from_location = geo["label"]
    if to_lat is None or to_lon is None:
        geo = geocode_address(to_location)
        if not geo:
            raise ValueError("Could not find the destination address on the map.")
        to_lat, to_lon = geo["lat"], geo["lon"]
        to_location = geo["label"]

    transit_hours = float(payload.get("transitHours") or 72)
    plan = build_route_plan(
        from_location,
        to_location,
        float(from_lat),
        float(from_lon),
        float(to_lat),
        float(to_lon),
        transit_hours=transit_hours,
    )

    status_in = str(payload.get("status") or "in-transit").lower()
    status, delivery_status = _status_meta(status_in)
    timeline = timeline_for_status(plan["plannedEvents"], status)

    tracking_id = str(payload.get("id") or "").strip()
    if tracking_id:
        if not re.fullmatch(r"[A-Za-z0-9]{6,24}", tracking_id):
            raise ValueError("Tracking ID must be 6–24 letters or digits.")
        if tracking_id in shipments:
            raise ValueError("That tracking ID already exists.")
    else:
        tracking_id = generate_tracking_id(shipments)

    service = str(payload.get("serviceType") or "DSV Road").strip() or "DSV Road"
    package_content = str(payload.get("packageContent") or "General cargo").strip() or "General cargo"
    signature_required = bool(payload.get("signatureRequired", True))
    delivery_time = str(payload.get("deliveryTime") or "9:00 PM").strip() or "9:00 PM"

    item: dict[str, Any] = {
        "status": status,
        "deliveryStatus": delivery_status,
        "serviceType": service,
        "estimatedDelivery": plan["estimatedDelivery"],
        "deliveryTime": delivery_time,
        "sender": sender,
        "receiver": receiver,
        "packageContent": package_content,
        "signatureRequired": signature_required,
        "fromLocation": from_location,
        "toLocation": to_location,
        "statusNearPlace": plan["statusNearPlace"],
        "labelCreatedDate": plan["labelCreatedDate"],
        "timeline": timeline,
        "fromLat": float(from_lat),
        "fromLon": float(from_lon),
        "toLat": float(to_lat),
        "toLon": float(to_lon),
        "routeStops": plan["routeStops"],
        "plannedEvents": plan["plannedEvents"],
        "createdAt": plan["createdAt"],
        "etaAt": plan["etaAt"],
        "routeDistanceM": plan["distanceM"],
        "routeDurationS": plan["durationS"],
    }
    if status == "out-for-delivery":
        item["outForDeliveryToday"] = True

    # Honor the admin-selected starting timeline; later requests advance along the route by time.
    shipments[tracking_id] = item
    save_shipments(shipments)
    return {"id": tracking_id, "shipment": public_item(item)}


def preview_route(payload: dict[str, Any]) -> dict[str, Any]:
    from_location = str(payload.get("fromLocation") or "").strip()
    to_location = str(payload.get("toLocation") or "").strip()
    if not from_location or not to_location:
        raise ValueError("From and to addresses are required.")

    from_lat = payload.get("fromLat")
    from_lon = payload.get("fromLon")
    to_lat = payload.get("toLat")
    to_lon = payload.get("toLon")
    if from_lat is None or from_lon is None:
        geo = geocode_address(from_location)
        if not geo:
            raise ValueError("Could not geocode origin.")
        from_lat, from_lon, from_location = geo["lat"], geo["lon"], geo["label"]
    if to_lat is None or to_lon is None:
        geo = geocode_address(to_location)
        if not geo:
            raise ValueError("Could not geocode destination.")
        to_lat, to_lon, to_location = geo["lat"], geo["lon"], geo["label"]

    plan = build_route_plan(
        from_location,
        to_location,
        float(from_lat),
        float(from_lon),
        float(to_lat),
        float(to_lon),
        transit_hours=float(payload.get("transitHours") or 72),
    )
    return {
        "fromLocation": from_location,
        "toLocation": to_location,
        "fromLat": float(from_lat),
        "fromLon": float(from_lon),
        "toLat": float(to_lat),
        "toLon": float(to_lon),
        "estimatedDelivery": plan["estimatedDelivery"],
        "distanceKm": round(plan["distanceM"] / 1000.0, 1),
        "stops": [{"label": s["label"], "kind": s["kind"]} for s in plan["routeStops"]],
        "plannedEvents": [
            {"title": e["title"], "location": e["location"], "date": e["date"]}
            for e in plan["plannedEvents"]
        ],
    }


def progress_all() -> int:
    shipments = load_shipments()
    changed = 0
    for item in shipments.values():
        if isinstance(item, dict) and progress_shipment(item):
            changed += 1
    if changed:
        save_shipments(shipments)
    return changed
