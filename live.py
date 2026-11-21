"""伺服器拉取並快取動態資料。瀏覽器不直接呼叫政府或巴士公司網址。"""

from __future__ import annotations

import json
import threading
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path
from statistics import median
from zoneinfo import ZoneInfo

from catalog import CAMERAS, NEWS_KEYWORDS

HK = ZoneInfo("Asia/Hong_Kong")
ROOT = Path(__file__).resolve().parent
USER_AGENT = "MawanTraffic/1.0 (local timetable site)"

KMB_ROUTE = "https://data.etabus.gov.hk/v1/transport/kmb/route-stop/230R/{direction}/1"
KMB_STOP = "https://data.etabus.gov.hk/v1/transport/kmb/stop/{stop_id}"
KMB_ETA = "https://data.etabus.gov.hk/v1/transport/kmb/eta/{stop_id}/230R/1"
NEWS_URL = "https://www.td.gov.hk/tc/special_news/trafficnews.xml"
SPEED_URL = "https://resource.data.one.gov.hk/td/traffic-detectors/rawSpeedVol-all.xml"
JOURNEY_URL = "https://resource.data.one.gov.hk/td/jss/Journeytimev2.xml"
WEATHER_URL = "https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warnsum&lang=tc"
CAMERA_URL = "https://tdcctv.data.one.gov.hk/{camera_id}.JPG"

JT_NS = {"j": "http://data.one.gov.hk/td"}
WEATHER_CODES = {
    "WTCSGNL": "熱帶氣旋警告",
    "WRAIN": "暴雨警告",
    "WTS": "雷暴警告",
}
WIND_QUOTE = {
    "sourceName": "珀麗灣客運惡劣天氣安排",
    "sourceUrl": "http://www.pitcl.com.hk/attachment/download/1785814481xghWe.pdf",
    "capturedOn": "2026-11-21",
    "lines": [
        "一號或三號風球：渡輪可能延誤。三號風球期間，渡輪亦可能在八號風球懸掛前或除下後短暫停航。",
        "八號風球懸掛前約兩小時的預告：營辦商會按海面情況決定會否停航。",
        "八號或以上：停航與否在約兩小時內按海面情況決定。本站不會自動取消班次。",
        "青馬大橋風速超過每小時75公里，並實施第二階段強風管制時，巴士會暫停。",
    ],
}


def _get(url: str, timeout: float = 8) -> tuple[bytes, dict]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read(), dict(response.headers)


class Slot:
    def __init__(self, cycle_seconds: int):
        self.cycle = cycle_seconds
        self.lock = threading.Lock()
        self.value = None
        self.fetched_at: datetime | None = None
        self.error = ""

    def read(self, loader):
        with self.lock:
            fresh = (
                self.value is not None
                and self.fetched_at is not None
                and (datetime.now(HK) - self.fetched_at).total_seconds() < self.cycle
            )
            if fresh:
                return self._pack(True)
            try:
                self.value = loader()
                self.fetched_at = datetime.now(HK)
                self.error = ""
            except Exception as exc:  # noqa: BLE001 - upstream failure must stay on the card
                self.error = type(exc).__name__
            return self._pack(False)

    def _pack(self, cache_hit: bool) -> dict:
        age = None
        if self.fetched_at is not None:
            age = (datetime.now(HK) - self.fetched_at).total_seconds()
        stale = self.value is None or age is None or age > self.cycle * 2
        return {
            "value": self.value,
            "fetchedAt": self.fetched_at.isoformat() if self.fetched_at else None,
            "stale": stale,
            "error": self.error,
            "cacheHit": cache_hit,
            "status": "暫時未能更新" if stale else "已更新",
        }


def _iso(value: str | None) -> datetime | None:
    if not value:
        return None
    text = value.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=HK)
    return parsed.astimezone(HK)


def _kmb_stop_name(stop_id: str) -> str:
    body, _ = _get(KMB_STOP.format(stop_id=stop_id))
    payload = json.loads(body)
    return payload.get("data", {}).get("name_tc") or ""


def load_kmb() -> dict:
    stops = {}
    expect = {"outbound": "九龍站", "inbound": "馬灣"}
    for direction, key in (("outbound", "O"), ("inbound", "I")):
        body, _ = _get(KMB_ROUTE.format(direction=direction))
        rows = json.loads(body).get("data") or []
        if not rows:
            raise RuntimeError(f"230R {direction} 沒有站")
        row = min(rows, key=lambda item: int(item["seq"]))
        name = _kmb_stop_name(row["stop"])
        if expect[direction] not in name or (direction == "inbound" and "珀欣" not in name):
            raise RuntimeError(f"230R {direction} 站名未能對上")
        stops[key] = {"stopId": row["stop"], "seq": row.get("seq"), "name": name, "dir": key}

    trips = []
    data_times = []
    for key, stop in stops.items():
        body, _ = _get(KMB_ETA.format(stop_id=stop["stopId"]))
        payload = json.loads(body)
        generated = _iso(payload.get("generated_timestamp"))
        for row in payload.get("data") or []:
            if row.get("dir") != key:
                continue
            if str(row.get("seq")) != str(stop["seq"]):
                continue
            stamp = _iso(row.get("data_timestamp"))
            if stamp:
                data_times.append(stamp)
            remark = (row.get("rmk_tc") or "").strip()
            eta = _iso(row.get("eta"))
            if remark == "":
                grade, label = "官方實時", "預計到達"
            else:
                grade, label = "官方班表", "表定開出"
            trips.append({
                "direction": "to-mawan" if key == "O" else "from-mawan",
                "eta": eta.isoformat() if eta else None,
                "clock": eta.strftime("%H:%M") if eta else "",
                "grade": grade,
                "timeLabel": label,
                "remark": remark,
                "dataTime": stamp.isoformat() if stamp else None,
            })
    oldest = min(data_times) if data_times else None
    source_stale = oldest is None or (datetime.now(HK) - oldest) > timedelta(minutes=2)
    return {
        "route": "230R",
        "operator": "九巴",
        "originTo": stops["O"]["name"],
        "originFrom": stops["I"]["name"],
        "destinationTo": "馬灣(珀欣路)",
        "destinationFrom": "九龍站",
        "trips": [trip for trip in trips if trip["eta"]],
        "dataTime": oldest.isoformat() if oldest else None,
        "sourceStale": source_stale,
        "generatedAt": generated.isoformat() if generated else None,
        "sourceName": "九巴 ETA API",
        "sourceUrl": "https://data.etabus.gov.hk/datagovhk/kmb_eta_api_specification.pdf",
        "fareUrl": "https://search.kmb.hk/KMBWebSite/?action=routesearch&route=230R",
        "fareText": "票價見官網",
        "notes": ["備註不是空白時，這班是官方班表。"],
    }


def _text(node, name: str) -> str:
    child = node.find(name)
    return (child.text or "").strip() if child is not None and child.text else ""


FALSE_PLACES = ("珀麗高爾夫",)


def corridor_match(blob: str) -> bool:
    cleaned = blob
    for place in FALSE_PLACES:
        cleaned = cleaned.replace(place, "")
    lowered = cleaned.lower()
    return any(keyword.lower() in lowered for keyword in NEWS_KEYWORDS)


def load_news() -> dict:
    body, _ = _get(NEWS_URL)
    root = ET.fromstring(body)
    messages = []
    for node in root.findall(".//message"):
        fields = [
            _text(node, "INCIDENT_HEADING_CN"),
            _text(node, "INCIDENT_DETAIL_CN"),
            _text(node, "LOCATION_CN"),
            _text(node, "CONTENT_CN"),
            _text(node, "CONTENT_EN"),
            _text(node, "LOCATION_EN"),
            _text(node, "NEAR_LANDMARK_CN"),
            _text(node, "NEAR_LANDMARK_EN"),
            _text(node, "BETWEEN_LANDMARK_CN"),
            _text(node, "BETWEEN_LANDMARK_EN"),
        ]
        blob = " ".join(fields)
        if not corridor_match(blob):
            continue
        messages.append({
            "id": _text(node, "INCIDENT_NUMBER"),
            "heading": _text(node, "INCIDENT_HEADING_CN") or _text(node, "INCIDENT_HEADING_EN"),
            "detail": _text(node, "INCIDENT_DETAIL_CN") or _text(node, "CONTENT_CN"),
            "location": _text(node, "LOCATION_CN"),
            "announcedAt": _text(node, "ANNOUNCEMENT_DATE"),
        })
    return {
        "messages": messages,
        "emptyText": "相關走廊暫時沒有特別交通消息",
        "sourceName": "運輸署特別交通消息 v2",
        "sourceUrl": NEWS_URL,
    }


def _lane_speed(lane) -> int | None:
    valid = (lane.findtext("valid") or "").strip().upper()
    if valid != "Y":
        return None
    raw = (lane.findtext("speed") or "").strip()
    try:
        return int(float(raw))
    except ValueError:
        return None


def parse_speeds(body: bytes, detectors: list[dict]) -> dict:
    by_id = {item["id"]: item for item in detectors}
    root = ET.fromstring(body)
    periods = root.findall("periods/period")
    period = periods[-1] if periods else root
    label = f"{(root.findtext('date') or '').strip()} {(period.findtext('period_from') or '').strip()}–{(period.findtext('period_to') or '').strip()}".strip()
    candidates = {"nlh": [], "wkh": []}
    for detector in period.findall("detectors/detector"):
        aid = (detector.findtext("detector_id") or "").strip()
        if aid not in by_id:
            continue
        speeds = [speed for speed in (_lane_speed(lane) for lane in detector.findall("lanes/lane")) if speed is not None]
        if not speeds:
            continue
        meta = by_id[aid]
        axis = meta["longitude"] if meta["group"] == "nlh" else meta["latitude"]
        candidates[meta["group"]].append((axis, meta, int(median(speeds))))
    chosen = []
    labels = {"nlh": "北大嶼山公路", "wkh": "西九龍公路"}
    for group, rows in candidates.items():
        if not rows:
            continue
        _, meta, speed = max(rows, key=lambda item: item[0])
        chosen.append({
            "road": labels[group],
            "detector": " ".join(meta["name"].split()),
            "speed": speed,
            "unit": "公里/小時",
        })
    return {
        "roads": chosen,
        "period": label,
        "sourceName": "運輸署主要道路原始車速",
        "sourceUrl": "https://data.gov.hk/tc-data/dataset/hk-td-sm_4-traffic-data-strategic-major-roads",
        "omitted": ["青嶼幹線", "青馬大橋", "汲水門大橋", "馬灣路", "長青公路"],
        "omittedReason": "偵測器名稱表沒有這些路段的有效車速，只顯示消息同鏡頭。",
    }


def load_speeds() -> dict:
    detectors = json.loads((ROOT / "data" / "detectors.json").read_text(encoding="utf-8"))
    body, _ = _get(SPEED_URL, timeout=12)
    return parse_speeds(body, detectors)


def parse_journey(body: bytes) -> dict:
    root = ET.fromstring(body)
    wanted = {"ACTT": "機場經三號幹線", "ATSCA": "機場經八號幹線"}
    rows = []
    capture = ""
    for item in root.findall("j:jtis_journey_time", JT_NS):
        loc_id = item.findtext("j:LOCATION_ID", default="", namespaces=JT_NS)
        dest_id = item.findtext("j:DESTINATION_ID", default="", namespaces=JT_NS)
        kind = item.findtext("j:JOURNEY_TYPE", default="", namespaces=JT_NS)
        if loc_id != "K07" or dest_id not in wanted or kind != "1":
            continue
        capture = item.findtext("j:CAPTURE_DATE", default="", namespaces=JT_NS) or capture
        rows.append({
            "from": "西九龍公路西行近港鐵南昌站",
            "to": wanted[dest_id],
            "minutes": item.findtext("j:JOURNEY_DATA", default="", namespaces=JT_NS),
        })
    return {
        "rows": rows,
        "capture": capture,
        "sourceName": "運輸署行車時間指標 v2",
        "sourceUrl": JOURNEY_URL,
        "note": "這是告示板至目的地的分鐘，不是馬灣島內車程，也不加進船或巴士時間。",
    }


def load_journey() -> dict:
    body, _ = _get(JOURNEY_URL)
    return parse_journey(body)


def parse_weather(payload: dict) -> dict:
    warnings = []
    for code, label in WEATHER_CODES.items():
        item = payload.get(code)
        if not item:
            continue
        action = (item.get("actionCode") or "").strip().upper()
        if action.startswith("CANCEL"):
            continue
        warnings.append({
            "code": code,
            "name": item.get("name") or label,
            "codeName": item.get("code") or "",
            "action": item.get("actionCode") or "",
            "issueTime": item.get("issueTime") or item.get("updateTime") or "",
        })
    return {
        "warnings": warnings,
        "wind": WIND_QUOTE if warnings else None,
        "sourceName": "香港天文台天氣警告摘要",
        "sourceUrl": WEATHER_URL,
    }


def load_weather() -> dict:
    body, _ = _get(WEATHER_URL)
    return parse_weather(json.loads(body))


class CameraStore:
    def __init__(self):
        self.lock = threading.Lock()
        self.frames: dict[str, dict] = {}

    def get(self, camera_id: str) -> tuple[bytes, str, dict]:
        allowed = {item["id"] for item in CAMERAS}
        if camera_id not in allowed:
            raise KeyError(camera_id)
        with self.lock:
            current = dict(self.frames.get(camera_id, {}))
            fresh = current.get("fetched_at") and (datetime.now(HK) - current["fetched_at"]).total_seconds() < 120
            if fresh and (current.get("body") or current.get("status") == "no-service"):
                return current.get("body") or b"", "image/jpeg", self._meta(camera_id, current, True)
        try:
            body, headers = _get(CAMERA_URL.format(camera_id=camera_id), timeout=8)
            kind = "gif" if body[:6] in {b"GIF87a", b"GIF89a"} else "jpeg" if body[:2] == b"\xff\xd8" else "other"
            fetched = datetime.now(HK)
            with self.lock:
                previous = self.frames.get(camera_id, {})
            if kind == "jpeg":
                current = {
                    "body": body,
                    "fetched_at": fetched,
                    "good_at": fetched,
                    "status": "ok",
                    "upstream": headers.get("Last-Modified", ""),
                }
            else:
                current = {
                    "body": previous.get("body"),
                    "fetched_at": fetched,
                    "good_at": previous.get("good_at"),
                    "status": "no-service",
                    "upstream": headers.get("Last-Modified", ""),
                }
        except Exception as exc:  # noqa: BLE001
            with self.lock:
                previous = dict(self.frames.get(camera_id, {}))
            current = previous
            current["fetched_at"] = previous.get("fetched_at") or datetime.now(HK)
            current["status"] = "error"
            current["error"] = type(exc).__name__
        with self.lock:
            self.frames[camera_id] = current
        return current.get("body") or b"", "image/jpeg", self._meta(camera_id, current, False)

    def _meta(self, camera_id: str, current: dict, cache_hit: bool) -> dict:
        fetched = current.get("fetched_at")
        good = current.get("good_at")
        age = (datetime.now(HK) - fetched).total_seconds() if fetched else None
        return {
            "id": camera_id,
            "status": current.get("status") or "empty",
            "fetchedAt": fetched.isoformat() if fetched else None,
            "lastGoodAt": good.isoformat() if good else None,
            "stale": age is None or age > 240,
            "cacheHit": cache_hit,
            "message": "鏡頭暫時沒有畫面" if current.get("status") != "ok" else "",
        }


class Live:
    def __init__(self):
        self.kmb = Slot(60)
        self.news = Slot(60)
        self.speeds = Slot(60)
        self.journey = Slot(120)
        self.weather = Slot(60)
        self.cameras = CameraStore()

    def snapshot(self) -> dict:
        with ThreadPoolExecutor(max_workers=6) as pool:
            jobs = {
                "kmb": pool.submit(self.kmb.read, load_kmb),
                "news": pool.submit(self.news.read, load_news),
                "speeds": pool.submit(self.speeds.read, load_speeds),
                "journey": pool.submit(self.journey.read, load_journey),
                "weather": pool.submit(self.weather.read, load_weather),
                "cameras": pool.submit(camera_meta_all),
            }
            result = {key: job.result() for key, job in jobs.items()}
        kmb = result["kmb"]
        if kmb["value"] and kmb["value"].get("sourceStale"):
            kmb["stale"] = True
            kmb["status"] = "暫時未能更新"
        return result


LIVE = Live()


def camera_meta_all() -> list[dict]:
    def one(camera: dict) -> dict:
        _, _, meta = LIVE.cameras.get(camera["id"])
        meta["name"] = camera["name"]
        meta["road"] = camera["road"]
        return meta

    with ThreadPoolExecutor(max_workers=4) as pool:
        return list(pool.map(one, CAMERAS))
