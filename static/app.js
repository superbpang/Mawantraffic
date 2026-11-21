const state = { board: null, refreshFailed: false, refreshing: false, open: {} };

const leaveEl = document.querySelector("#leave");
const backEl = document.querySelector("#back");
const alertsEl = document.querySelector("#alerts");
const roadSummaryEl = document.querySelector("#road-summary");
const roadBodyEl = document.querySelector("#road-body");
const dayEl = document.querySelector("#day");
const timeEl = document.querySelector("#time");
const failEl = document.querySelector("#fail");
const BUS_ORDER = ["nr330", "nr332", "nr334", "nr338s", "nr338", "nr331", "nr331s"];
const FERRY_ORDER = ["ferry-central", "ferry-tsuen-wan"];
const DEST = {
  "ferry-central": "中環",
  "ferry-tsuen-wan": "荃灣",
  nr330: "青衣站",
  nr332: "葵芳",
  nr334: "機場",
  nr338s: "中環",
  nr338: "中環",
  nr331: "荃灣站",
  nr331s: "荃灣西站",
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));
}

function setHtml(element, html) {
  if (element.dataset.drawn === html) return false;
  element.dataset.drawn = html;
  element.innerHTML = html;
  return true;
}

function hkDate(iso) {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-HK", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const bag = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${bag.year}-${bag.month}-${bag.day}`;
}

function remainParts(iso, kind, compact, now = new Date()) {
  const left = Math.ceil((new Date(iso) - now) / 60000);
  const verb = compact ? "" : (kind === "arrive" ? "後到達" : "後開出");
  if (left <= 0) return { amount: kind === "arrive" ? "即將到達" : "即將開出", verb: "" };
  if (left < 60) return { amount: `${left} 分鐘`, verb };
  const hours = Math.floor(left / 60);
  const minutes = left % 60;
  return { amount: minutes ? `${hours} 小時 ${minutes} 分` : `${hours} 小時`, verb };
}

function formatAmount(amount) {
  const hour = String(amount).match(/^(\d+) 小時(?: (\d+) 分)?$/);
  if (!hour) return escapeHtml(amount);
  return `<span>${hour[1]} 小時</span>${hour[2] ? `<span>${hour[2]} 分</span>` : ""}`;
}

function remainHtml(iso, kind, compact) {
  const parts = remainParts(iso, kind, compact);
  return `<span class="amount">${formatAmount(parts.amount)}</span><span class="verb">${escapeHtml(parts.verb)}</span>`;
}

function shiftDate(day, days) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

function whenText(iso, clock, dayLabel, today) {
  const day = hkDate(iso);
  if (day === today) return clock;
  if (day === shiftDate(today, 1)) return `明日 ${clock}`;
  return `${dayLabel || day.slice(5)} ${clock}`;
}

function shortNote(note) {
  if (!note) return "";
  if (note.includes("港珠澳")) return "經香港口岸";
  if (note.includes("青衣站")) return "途經青衣站";
  return "";
}

function usefulNotes(notes) {
  return (notes || []).flatMap((note) => {
    if (note.includes("編定班次") || note.includes("碼頭關閘") || note.includes("每日服務") || note.includes("港鐵")) return [];
    if (note.includes("班表摘要")) return ["上車站為中環碼頭近三號碼頭，途經香港站（民祥街）。"];
    if (note.includes("臨海廣場")) return ["前往挪亞方舟的乘客在臨海廣場下車。"];
    if (note.includes("通宵")) return ["此路線包括通宵班次。"];
    if (note.includes("基慧")) return ["途經基慧小學。"];
    if (note.includes("循環線")) return ["循環線，機場站開出時間僅供參考。"];
    if (note.includes("二元")) return ["本路線不設居民票價，二元優惠不適用。"];
    return [note.endsWith("。") ? note : `${note}。`];
  });
}

function tripKind(trip) {
  return trip.timeLabel === "預計到達" ? "arrive" : "leave";
}

function clockOf(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function staleNote(slot) {
  if (!slot?.stale || !slot.value) return "";
  const time = clockOf(slot.fetchedAt);
  return time
    ? `<p>未能更新。以下為 ${escapeHtml(time)} 的資料。</p>`
    : "<p>未能更新。以下為較早的資料。</p>";
}

function tripItems(trips, today, compact) {
  return trips.slice(0, 3).map((trip) => {
    const iso = trip.time || trip.eta;
    const kind = tripKind(trip);
    const tag = shortNote(trip.note);
    return `
      <li>
        <em data-iso="${escapeHtml(iso)}" data-kind="${kind}" data-compact="${compact ? "1" : ""}">${remainHtml(iso, kind, compact)}</em>
        <b>${escapeHtml(whenText(iso, trip.clock, trip.dayLabel, today))}</b>
        ${tag ? `<span class="tag">${escapeHtml(tag)}</span>` : ""}
      </li>
    `;
  }).join("");
}

function lineHtml(id, code, where, modeLabel, trips, today, more) {
  const kinds = trips.map((trip) => tripKind(trip));
  const compact = kinds.length > 0 && kinds.every((kind) => kind === kinds[0]);
  const action = compact ? (kinds[0] === "arrive" ? "到達" : "開出") : "";
  const meta = [modeLabel, action].filter(Boolean).join(" · ");
  const kindClass = modeLabel === "渡輪" ? "ferry" : modeLabel === "九巴" ? "kmb" : "bus";
  const times = trips.length
    ? `<ol class="times">${tripItems(trips, today, compact)}</ol>`
    : `<p class="none">暫無班次</p>`;
  return `
    <details class="fold route ${kindClass}" data-id="${escapeHtml(id)}" ${state.open[id] ? "open" : ""}>
      <summary>
        <span class="badge">${escapeHtml(code)}</span>
        <span class="going">
          <span class="where">${escapeHtml(where)}</span>
          ${meta ? `<span class="meta">${escapeHtml(meta)}</span>` : ""}
        </span>
        ${times}
      </summary>
      <div class="more">${more}</div>
    </details>
  `;
}

function serviceLines(board, direction, ids) {
  const today = hkDate(board.now);
  const services = ids.map((id) => board.services.find((service) => service.id === id)).filter(Boolean);
  return services.map((service) => {
    const leg = service.directions[direction];
    const place = DEST[service.id];
    const where = direction === "from-mawan" ? `往${place}` : `由${place}`;
    const notes = usefulNotes(service.notes);
    const meaning = service.mode === "ferry"
      ? "所示時間為碼頭關閘時間，而非船隻到達時間。"
      : "所示時間為表定開出時間，而非到達時間。";
    const more = `
      <p>由${escapeHtml(leg.boardStop)}開往${escapeHtml(leg.destination)}。</p>
      <p>${meaning}</p>
      ${notes.map((note) => `<p>${escapeHtml(note)}</p>`).join("")}
      <p><a href="${escapeHtml(service.sourceUrl)}">班表</a> · <a href="${escapeHtml(service.fareUrl)}">${escapeHtml(service.fareText)}</a></p>
    `;
    const modeLabel = service.mode === "ferry" ? "渡輪" : "巴士";
    return lineHtml(`${service.id}-${direction}`, service.route, where, modeLabel, leg.upcoming, today, more);
  }).join("");
}

function kmbLine(board, direction) {
  const today = hkDate(board.now);
  const slot = board.live?.kmb;
  const value = slot?.value;
  const where = direction === "from-mawan" ? "往九龍站" : "由九龍站";
  const id = `kmb-${direction}`;
  if (!value) {
    return lineHtml(id, "230R", where, "九巴", [], today, "<p>暫時未能讀取九巴到站時間。</p>");
  }
  const trips = value.trips.filter((trip) => trip.direction === direction).slice(0, 3);
  const stop = direction === "to-mawan" ? value.originTo : value.originFrom;
  const dest = direction === "to-mawan" ? value.destinationTo : value.destinationFrom;
  const more = `
    <p>九巴，由${escapeHtml(stop)}開往${escapeHtml(dest)}。</p>
    <p>沒有備註的班次為預計到達時間；標明「原定班次」的為表定開出時間。</p>
    ${staleNote(slot)}
    <p><a href="${escapeHtml(value.fareUrl)}">${escapeHtml(value.fareText)}</a></p>
  `;
  return lineHtml(id, "230R", where, "九巴", trips, today, more);
}

function alertHtml(board) {
  const parts = [];
  const weatherSlot = board.live?.weather;
  const weather = weatherSlot?.value;
  const warnings = weather?.warnings || [];
  if (warnings.length) {
    const names = warnings.map((item) => item.name).join("、");
    const lines = (weather.wind?.lines || []).map((line) => `<p>${escapeHtml(line)}</p>`).join("");
    const body = weatherSlot.stale
      ? `${staleNote(weatherSlot)}<p>警告狀態未能更新，未必仍然有效。</p>${lines}`
      : (lines || "<p>警告現正生效。</p>");
    const aside = weatherSlot.stale ? `${names} · 未能更新` : names;
    parts.push(`<details class="fold panel alert" data-id="weather" ${state.open.weather ? "open" : ""}><summary><span class="name">天氣</span><span class="aside">${escapeHtml(aside)}</span></summary><div class="more">${body}</div></details>`);
  }
  const notice = (board.notices || []).find((item) => item.appliesToday);
  if (notice) {
    parts.push(`<details class="fold panel alert" data-id="notice" ${state.open.notice ? "open" : ""}><summary><span class="name">平日船期調整</span><span class="aside">受影響班次已剔除</span></summary><div class="more"><p>${escapeHtml(notice.body)}</p></div></details>`);
  }
  if ((board.calendarGaps || []).length) {
    parts.push(`<p class="alert bare">部分日期未能判斷是否公眾假期，這些日子暫不列出班次。</p>`);
  }
  return parts.join("");
}

function roadHeadline(board) {
  const speeds = board.live?.speeds;
  const roads = speeds?.value?.roads || [];
  const stale = speeds?.stale && speeds.value ? " · 未能更新" : "";
  if (roads.length) {
    const lines = roads.map((road) => `<span class="statline">${escapeHtml(road.road)} ${escapeHtml(road.speed)} 公里/小時</span>`).join("");
    return stale ? `${lines}<span class="statline">未能更新</span>` : lines;
  }
  if ((board.live?.news?.value?.messages || []).length) {
    return board.live.news.stale ? "有特別交通消息 · 未能更新" : "有特別交通消息";
  }
  if (!speeds?.value) return "暫時未能更新";
  return "暫無特別交通消息";
}

function factTile(value, unit, label) {
  return `<div class="fact"><b>${escapeHtml(value)}</b><span>${escapeHtml(unit)}</span><small>${escapeHtml(label)}</small></div>`;
}

function roadHtml(board) {
  const news = board.live.news;
  const speeds = board.live.speeds;
  const journey = board.live.journey;
  const messages = news.value?.messages || [];
  const newsBody = !news.value
    ? "<p>交通消息暫時未能更新。</p>"
    : `${staleNote(news)}${messages.length
      ? messages.map((item) => `<p class="news"><strong>${escapeHtml(item.heading)}</strong><span>${escapeHtml(item.detail)}</span></p>`).join("")
      : "<p>暫無影響往返馬灣的特別交通消息。</p>"}`;
  const roads = speeds.value?.roads || [];
  const speedBody = !speeds.value
    ? "<p>車速暫時未能更新。</p>"
    : `${staleNote(speeds)}${roads.length
      ? `<div class="facts">${roads.map((road) => factTile(road.speed, "公里/小時", road.road)).join("")}</div>`
      : "<p>暫時沒有車速。</p>"}`;
  const rows = journey.value?.rows || [];
  const journeyBody = !rows.length
    ? `<p>${journey?.stale ? "行車時間暫時未能更新。" : "暫無南昌站往機場的行車時間。"}</p>`
    : `${staleNote(journey)}<div class="facts">${rows.map((row) => factTile(row.minutes, "分鐘", row.to.includes("三號") ? "三號幹線" : "八號幹線")).join("")}</div><p>南昌站往機場的行車時間，而非馬灣島內車程。</p>`;
  return `
    <p class="label">交通消息</p>
    ${newsBody}
    <p class="label">車速</p>
    ${speedBody}
    <p>青馬大橋、汲水門大橋、青嶼幹線、馬灣路及長青公路沒有車速數據，只顯示交通消息及閉路電視。</p>
    <p class="label">行車時間</p>
    ${journeyBody}
  `;
}

function rememberOpen() {
  document.querySelectorAll("details[data-id]").forEach((el) => {
    state.open[el.dataset.id] = el.open;
  });
}

function render(options = {}) {
  const board = state.board;
  if (!board) return;
  const scrollY = options.keepScroll ? window.scrollY : null;
  rememberOpen();
  dayEl.textContent = board.dayLabel;
  timeEl.textContent = board.now.slice(11, 16);
  failEl.textContent = state.refreshFailed ? "暫時未能更新" : "";
  setHtml(alertsEl, alertHtml(board));
  setHtml(leaveEl, serviceLines(board, "from-mawan", BUS_ORDER) + kmbLine(board, "from-mawan") + serviceLines(board, "from-mawan", FERRY_ORDER));
  setHtml(backEl, serviceLines(board, "to-mawan", BUS_ORDER) + kmbLine(board, "to-mawan") + serviceLines(board, "to-mawan", FERRY_ORDER));
  roadSummaryEl.innerHTML = roadHeadline(board);
  setHtml(roadBodyEl, roadHtml(board));
  updateCameras(board.live.cameras || []);
  if (scrollY !== null) window.scrollTo(0, scrollY);
}

function tick() {
  document.querySelectorAll("[data-iso]").forEach((el) => {
    const parts = remainParts(el.dataset.iso, el.dataset.kind, el.dataset.compact === "1");
    const amount = el.querySelector(".amount");
    const verb = el.querySelector(".verb");
    if (!amount || !verb) return;
    amount.innerHTML = formatAmount(parts.amount);
    verb.textContent = parts.verb;
  });
}

function updateCameras(cameras) {
  const root = document.querySelector("#cameras");
  const gaps = document.querySelector("#camera-gaps");
  const seen = new Set();
  cameras.forEach((camera) => {
    const wantImage = camera.status === "ok" || camera.lastGoodAt;
    if (!wantImage) return;
    seen.add(camera.id);
    let figure = root.querySelector(`figure[data-id="${camera.id}"]`);
    if (!figure) {
      figure = document.createElement("figure");
      figure.dataset.id = camera.id;
      const captionEl = document.createElement("figcaption");
      figure.append(captionEl);
    }
    root.append(figure);
    figure.querySelector("figcaption").textContent = camera.name;
    const token = camera.lastGoodAt || camera.fetchedAt || "";
    const image = figure.querySelector("img");
    const picture = image || document.createElement("img");
    picture.alt = camera.name;
    if (!image) figure.prepend(picture);
    if (token && picture.dataset.token !== token && picture.dataset.pending !== token) {
      picture.dataset.pending = token;
      const candidate = new Image();
      const url = `/cameras/${encodeURIComponent(camera.id)}.jpg?t=${encodeURIComponent(token)}`;
      candidate.onload = () => {
        if (picture.dataset.pending !== token) return;
        picture.src = url;
        picture.dataset.token = token;
        delete picture.dataset.pending;
      };
      candidate.onerror = () => {
        if (picture.dataset.pending === token) delete picture.dataset.pending;
      };
      candidate.src = url;
    }
  });
  root.querySelectorAll("figure").forEach((figure) => {
    if (!seen.has(figure.dataset.id)) figure.remove();
  });
  gaps.replaceChildren();
  cameras.forEach((camera) => {
    if (camera.status === "ok" || camera.lastGoodAt) return;
    const line = document.createElement("p");
    const reason = camera.status === "no-service" ? "暫時未能提供服務" : "暫時未能更新";
    line.textContent = `${camera.name}鏡頭${reason}。`;
    gaps.append(line);
  });
}

async function refresh() {
  if (state.refreshing) return;
  state.refreshing = true;
  try {
    const response = await fetch("/api/board", { cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    state.board = await response.json();
    state.refreshFailed = false;
    render({ keepScroll: true });
  } catch (error) {
    state.refreshFailed = true;
    if (state.board) render({ keepScroll: true });
    else {
      dayEl.textContent = "";
      timeEl.textContent = "暫時未能更新";
      failEl.textContent = "";
    }
  } finally {
    state.refreshing = false;
  }
}

refresh();
setInterval(refresh, 60000);
setInterval(tick, 15000);
