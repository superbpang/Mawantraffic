import detectors from "../data/detectors.json" with { type: "json" };
import schedule from "./schedule.json" with { type: "json" };
import { hkParts, isoHk } from "./board.js";

const USER_AGENT = "MawanTraffic/1.0 (local timetable site)";
const NEWS_URL = "https://www.td.gov.hk/tc/special_news/trafficnews.xml";
const SPEED_URL = "https://resource.data.one.gov.hk/td/traffic-detectors/rawSpeedVol-all.xml";
const JOURNEY_URL = "https://resource.data.one.gov.hk/td/jss/Journeytimev2.xml";
const WEATHER_URL = "https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warnsum&lang=tc";
const CAMERA_URL = "https://tdcctv.data.one.gov.hk/{camera_id}.JPG";
const KMB_ROUTE = "https://data.etabus.gov.hk/v1/transport/kmb/route-stop/230R/{direction}/1";
const KMB_STOP = "https://data.etabus.gov.hk/v1/transport/kmb/stop/{stop_id}";
const KMB_ETA = "https://data.etabus.gov.hk/v1/transport/kmb/eta/{stop_id}/230R/1";

const WEATHER_CODES = {
  WTCSGNL: "熱帶氣旋警告",
  WRAIN: "暴雨警告",
  WTS: "雷暴警告",
};
const WIND_QUOTE = {
  sourceName: "珀麗灣客運惡劣天氣安排",
  sourceUrl: "http://www.pitcl.com.hk/attachment/download/1785814481xghWe.pdf",
  capturedOn: "2026-11-21",
  lines: [
    "一號或三號風球：渡輪可能延誤。三號風球期間，渡輪亦可能在八號風球懸掛前或除下後短暫停航。",
    "八號風球懸掛前約兩小時的預告：營辦商會按海面情況決定會否停航。",
    "八號或以上：停航與否在約兩小時內按海面情況決定。本站不會自動取消班次。",
    "青馬大橋風速超過每小時75公里，並實施第二階段強風管制時，巴士會暫停。",
  ],
};
const FALSE_PLACES = ["珀麗高爾夫"];
const ALLOWED_CAMERAS = new Set(schedule.cameras.map((camera) => camera.id));

function toText(body) {
  if (typeof body === "string") return body;
  return new TextDecoder().decode(body);
}

function decodeXml(text) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value)))
    .replace(/&amp;/g, "&");
}

function tag(block, name) {
  const match = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return match ? decodeXml(match[1]).trim() : "";
}

function tagNs(block, local) {
  const match = block.match(new RegExp(`<(?:[\\w.-]+:)?${local}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${local}>`));
  return match ? decodeXml(match[1]).trim() : "";
}

export function parseIso(value) {
  if (!value) return null;
  const hasZone = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(value);
  if (!hasZone) {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?/);
    if (!match) return null;
    const millis = match[7] ? Number(match[7].slice(0, 3).padEnd(3, "0")) : 0;
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]) - 8, Number(match[5]), Number(match[6] || 0), millis));
  }
  const parsed = new Date(value.replace(/Z$/, "+00:00"));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function clockOf(date) {
  if (!date) return "";
  const part = hkParts(date);
  return `${part.hour}:${part.minute}`;
}

function medianInt(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.trunc(median);
}

export function corridorMatch(blob) {
  let cleaned = blob;
  for (const place of FALSE_PLACES) cleaned = cleaned.split(place).join("");
  const lowered = cleaned.toLowerCase();
  return schedule.newsKeywords.some((keyword) => lowered.includes(keyword.toLowerCase()));
}

export function parseNews(body) {
  const xml = toText(body);
  const messages = [];
  const pattern = /<message>([\s\S]*?)<\/message>/g;
  let match = pattern.exec(xml);
  while (match) {
    const block = match[1];
    const fields = [
      "INCIDENT_HEADING_CN", "INCIDENT_DETAIL_CN", "LOCATION_CN", "CONTENT_CN", "CONTENT_EN",
      "LOCATION_EN", "NEAR_LANDMARK_CN", "NEAR_LANDMARK_EN", "BETWEEN_LANDMARK_CN", "BETWEEN_LANDMARK_EN",
    ].map((name) => tag(block, name));
    if (corridorMatch(fields.join(" "))) {
      messages.push({
        id: tag(block, "INCIDENT_NUMBER"),
        heading: tag(block, "INCIDENT_HEADING_CN") || tag(block, "INCIDENT_HEADING_EN"),
        detail: tag(block, "INCIDENT_DETAIL_CN") || tag(block, "CONTENT_CN"),
        location: tag(block, "LOCATION_CN"),
        announcedAt: tag(block, "ANNOUNCEMENT_DATE"),
      });
    }
    match = pattern.exec(xml);
  }
  return {
    messages,
    emptyText: "相關走廊暫時沒有特別交通消息",
    sourceName: "運輸署特別交通消息 v2",
    sourceUrl: NEWS_URL,
  };
}

function laneSpeed(block) {
  if (tag(block, "valid").toUpperCase() !== "Y") return null;
  const raw = tag(block, "speed").trim();
  const value = Number(raw);
  if (!raw || Number.isNaN(value)) return null;
  return Math.trunc(value);
}

export function parseSpeeds(body, rows = detectors) {
  const xml = toText(body);
  const periods = [...xml.matchAll(/<period>([\s\S]*?)<\/period>/g)];
  const period = periods.length ? periods[periods.length - 1][1] : xml;
  const label = `${tag(xml, "date")} ${tag(period, "period_from")}–${tag(period, "period_to")}`.trim();
  const candidates = { nlh: [], wkh: [] };
  for (const meta of rows) {
    const needle = `<detector_id>${meta.id}</detector_id>`;
    const at = period.indexOf(needle);
    if (at < 0) continue;
    const start = period.lastIndexOf("<detector>", at);
    const end = period.indexOf("</detector>", at);
    if (start < 0 || end < 0) continue;
    const block = period.slice(start, end);
    const speeds = [];
    const lanePattern = /<lane>([\s\S]*?)<\/lane>/g;
    let lane = lanePattern.exec(block);
    while (lane) {
      const speed = laneSpeed(lane[1]);
      if (speed != null) speeds.push(speed);
      lane = lanePattern.exec(block);
    }
    if (!speeds.length) continue;
    const axis = meta.group === "nlh" ? meta.longitude : meta.latitude;
    if (!candidates[meta.group]) continue;
    candidates[meta.group].push([axis, meta, medianInt(speeds)]);
  }
  const labels = { nlh: "北大嶼山公路", wkh: "西九龍公路" };
  const chosen = [];
  for (const [group, groupRows] of Object.entries(candidates)) {
    if (!groupRows.length) continue;
    let best = groupRows[0];
    for (const row of groupRows) if (row[0] > best[0]) best = row;
    chosen.push({
      road: labels[group],
      detector: best[1].name.trim().split(/\s+/).filter(Boolean).join(" "),
      speed: best[2],
      unit: "公里/小時",
    });
  }
  return {
    roads: chosen,
    period: label,
    sourceName: "運輸署主要道路原始車速",
    sourceUrl: "https://data.gov.hk/tc-data/dataset/hk-td-sm_4-traffic-data-strategic-major-roads",
    omitted: ["青嶼幹線", "青馬大橋", "汲水門大橋", "馬灣路", "長青公路"],
    omittedReason: "這些路段的偵測器沒有有效車速，只顯示交通消息及閉路電視。",
  };
}

export function parseJourney(body) {
  const xml = toText(body);
  const wanted = { ACTT: "機場經三號幹線", ATSCA: "機場經八號幹線" };
  const rows = [];
  let capture = "";
  const pattern = /<(?:[\w.-]+:)?jtis_journey_time(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?jtis_journey_time>/g;
  let match = pattern.exec(xml);
  while (match) {
    const block = match[1];
    const location = tagNs(block, "LOCATION_ID");
    const destination = tagNs(block, "DESTINATION_ID");
    const kind = tagNs(block, "JOURNEY_TYPE");
    if (location === "K07" && wanted[destination] && kind === "1") {
      const stamped = tagNs(block, "CAPTURE_DATE");
      if (stamped) capture = stamped;
      rows.push({
        from: "西九龍公路西行近港鐵南昌站",
        to: wanted[destination],
        minutes: tagNs(block, "JOURNEY_DATA"),
      });
    }
    match = pattern.exec(xml);
  }
  return {
    rows,
    capture,
    sourceName: "運輸署行車時間指標 v2",
    sourceUrl: JOURNEY_URL,
    note: "這是告示板至目的地的分鐘，不是馬灣島內車程，也不加進船或巴士時間。",
  };
}

export function parseWeather(payload) {
  const warnings = [];
  for (const [code, label] of Object.entries(WEATHER_CODES)) {
    const item = payload[code];
    if (!item) continue;
    const action = String(item.actionCode || "").trim().toUpperCase();
    if (action.startsWith("CANCEL")) continue;
    warnings.push({
      code,
      name: item.name || label,
      codeName: item.code || "",
      action: item.actionCode || "",
      issueTime: item.issueTime || item.updateTime || "",
    });
  }
  return {
    warnings,
    wind: warnings.length ? WIND_QUOTE : null,
    sourceName: "香港天文台天氣警告摘要",
    sourceUrl: WEATHER_URL,
  };
}

export function snapshotKind(body) {
  const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
  const head = String.fromCharCode(...bytes.slice(0, 6));
  if (head === "GIF87a" || head === "GIF89a") return "gif";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg";
  return "other";
}

function cameraMessage(status) {
  if (status === "ok") return "";
  if (status === "no-service") return "運輸署暫時未能提供服務";
  return "暫時未能更新";
}

export function reduceCamera(previous, body, nowMs) {
  const kind = snapshotKind(body);
  if (kind === "jpeg") {
    return { body, fetchedAt: nowMs, goodAt: nowMs, status: "ok", upstream: "" };
  }
  return {
    body: previous?.body || null,
    fetchedAt: nowMs,
    goodAt: previous?.goodAt || null,
    status: "no-service",
    upstream: previous?.upstream || "",
  };
}

function createSlot(cycleSeconds) {
  return { cycle: cycleSeconds * 1000, value: null, fetchedAt: null, failedAt: null, error: "" };
}

function pack(slot, cacheHit, now = Date.now()) {
  const age = slot.fetchedAt == null ? null : (now - slot.fetchedAt) / 1000;
  const stale = slot.value == null || age == null || age > (slot.cycle / 1000) * 2;
  return {
    value: slot.value,
    fetchedAt: slot.fetchedAt == null ? null : isoHk(new Date(slot.fetchedAt)),
    stale,
    error: slot.error,
    cacheHit,
    status: stale ? "暫時未能更新" : "已更新",
  };
}

async function readSlot(slot, loader) {
  const now = Date.now();
  const fresh = slot.value != null && slot.fetchedAt != null && now - slot.fetchedAt < slot.cycle;
  if (fresh) return pack(slot, true, now);
  if (slot.failedAt != null && now - slot.failedAt < slot.cycle) return pack(slot, false, now);
  try {
    slot.value = await loader();
    slot.fetchedAt = Date.now();
    slot.failedAt = null;
    slot.error = "";
  } catch (error) {
    slot.error = error?.name || "Error";
    slot.failedAt = Date.now();
  }
  return pack(slot, false);
}

async function getBytes(url, timeoutMs) {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "*/*" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.name = "HTTPError";
    throw error;
  }
  return {
    body: new Uint8Array(await response.arrayBuffer()),
    headers: { "Last-Modified": response.headers.get("Last-Modified") || "" },
  };
}

async function getJson(url, timeoutMs) {
  const { body } = await getBytes(url, timeoutMs);
  return JSON.parse(new TextDecoder().decode(body));
}

export async function loadKmb() {
  const stops = {};
  const expect = { outbound: "九龍站", inbound: "馬灣" };
  for (const [direction, key] of [["outbound", "O"], ["inbound", "I"]]) {
    const payload = await getJson(KMB_ROUTE.replace("{direction}", direction), 8000);
    const rows = payload.data || [];
    if (!rows.length) throw new Error(`230R ${direction} 沒有站`);
    const row = rows.reduce((best, item) => (Number(item.seq) < Number(best.seq) ? item : best));
    const stopPayload = await getJson(KMB_STOP.replace("{stop_id}", row.stop), 8000);
    const name = stopPayload.data?.name_tc || "";
    if (!name.includes(expect[direction]) || (direction === "inbound" && !name.includes("珀欣"))) {
      throw new Error(`230R ${direction} 站名未能對上`);
    }
    stops[key] = { stopId: row.stop, seq: row.seq, name, dir: key };
  }
  const trips = [];
  const dataTimes = [];
  let generated = null;
  for (const [key, stop] of Object.entries(stops)) {
    const payload = await getJson(KMB_ETA.replace("{stop_id}", stop.stopId), 8000);
    generated = parseIso(payload.generated_timestamp);
    for (const row of payload.data || []) {
      if (row.dir !== key) continue;
      if (String(row.seq) !== String(stop.seq)) continue;
      const stamp = parseIso(row.data_timestamp);
      if (stamp) dataTimes.push(stamp);
      const remark = String(row.rmk_tc || "").trim();
      const eta = parseIso(row.eta);
      const blank = remark === "";
      trips.push({
        direction: key === "O" ? "to-mawan" : "from-mawan",
        eta: eta ? isoHk(eta) : null,
        clock: clockOf(eta),
        grade: blank ? "官方實時" : "官方班表",
        timeLabel: blank ? "預計到達" : "表定開出",
        remark,
        dataTime: stamp ? isoHk(stamp) : null,
      });
    }
  }
  const oldest = dataTimes.reduce((best, item) => (!best || item < best ? item : best), null);
  const sourceStale = !oldest || Date.now() - oldest.getTime() > 2 * 60 * 1000;
  return {
    route: "230R",
    operator: "九巴",
    originTo: stops.O.name,
    originFrom: stops.I.name,
    destinationTo: "馬灣(珀欣路)",
    destinationFrom: "九龍站",
    trips: trips.filter((trip) => trip.eta),
    dataTime: oldest ? isoHk(oldest) : null,
    sourceStale,
    generatedAt: generated ? isoHk(generated) : null,
    sourceName: "九巴 ETA API",
    sourceUrl: "https://data.etabus.gov.hk/datagovhk/kmb_eta_api_specification.pdf",
    fareUrl: "https://search.kmb.hk/KMBWebSite/?action=routesearch&route=230R",
    fareText: "票價見官網",
    notes: ["備註不是空白時，這班是官方班表。"],
  };
}

export function markKmbFreshness(slot, now) {
  const value = slot.value;
  const stamp = value ? parseIso(value.dataTime) : null;
  const sourceStale = !stamp || now - stamp.getTime() > 2 * 60 * 1000;
  if (value) value.sourceStale = sourceStale;
  if (sourceStale && value) {
    slot.stale = true;
    slot.status = "暫時未能更新";
  }
  return slot;
}

const slots = {
  kmb: createSlot(60),
  news: createSlot(60),
  speeds: createSlot(60),
  journey: createSlot(120),
  weather: createSlot(60),
};
const frames = new Map();

function cameraMeta(id, current, cacheHit, now = Date.now()) {
  const fetched = current.fetchedAt || null;
  const good = current.goodAt || null;
  const age = fetched == null ? null : (now - fetched) / 1000;
  return {
    id,
    status: current.status || "empty",
    fetchedAt: fetched == null ? null : isoHk(new Date(fetched)),
    lastGoodAt: good == null ? null : isoHk(new Date(good)),
    stale: age == null || age > 240,
    cacheHit,
    message: cameraMessage(current.status || "empty"),
  };
}

export async function cameraFrame(cameraId) {
  if (!ALLOWED_CAMERAS.has(cameraId)) {
    const error = new Error("missing");
    error.name = "KeyError";
    throw error;
  }
  const now = Date.now();
  const current = frames.get(cameraId) || {};
  const fresh = current.fetchedAt && now - current.fetchedAt < 120000;
  if (fresh && (current.body || current.status === "no-service")) {
    return { body: current.body || new Uint8Array(), meta: cameraMeta(cameraId, current, true, now) };
  }
  try {
    const pulled = await getBytes(CAMERA_URL.replace("{camera_id}", cameraId), 8000);
    const next = reduceCamera(current, pulled.body, Date.now());
    next.upstream = pulled.headers["Last-Modified"];
    frames.set(cameraId, next);
    return { body: next.body || new Uint8Array(), meta: cameraMeta(cameraId, next, false) };
  } catch (error) {
    const previous = frames.get(cameraId) || {};
    const failed = { ...previous };
    failed.fetchedAt = previous.fetchedAt || Date.now();
    failed.status = "error";
    failed.error = error?.name || "Error";
    frames.set(cameraId, failed);
    return { body: failed.body || new Uint8Array(), meta: cameraMeta(cameraId, failed, false) };
  }
}

async function cameraMetaAll() {
  const listed = await Promise.all(schedule.cameras.map(async (camera) => {
    const { meta } = await cameraFrame(camera.id);
    return { ...meta, name: camera.name, road: camera.road };
  }));
  return listed;
}

export async function snapshot() {
  const [kmb, news, speeds, journey, weather, cameras] = await Promise.all([
    readSlot(slots.kmb, loadKmb),
    readSlot(slots.news, async () => parseNews((await getBytes(NEWS_URL, 8000)).body)),
    readSlot(slots.speeds, async () => parseSpeeds((await getBytes(SPEED_URL, 12000)).body)),
    readSlot(slots.journey, async () => parseJourney((await getBytes(JOURNEY_URL, 8000)).body)),
    readSlot(slots.weather, async () => parseWeather(await getJson(WEATHER_URL, 8000))),
    cameraMetaAll(),
  ]);
  markKmbFreshness(kmb, Date.now());
  return { kmb, news, speeds, journey, weather, cameras };
}

export function describeCamera(previous, body) {
  const next = reduceCamera(previous, body, Date.now());
  return {
    status: next.status,
    message: cameraMessage(next.status),
    hasBody: Boolean(next.body && next.body.length),
  };
}
