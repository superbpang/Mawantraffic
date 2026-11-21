const state = { board: null, refreshFailed: false, refreshing: false, open: {} };

const leaveEl = document.querySelector("#leave");
const backEl = document.querySelector("#back");
const alertsEl = document.querySelector("#alerts");
const clockEl = document.querySelector("#clock");
const roadSummaryEl = document.querySelector("#road-summary");
const roadBodyEl = document.querySelector("#road-body");
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

function remainHtml(iso, kind, compact) {
  const parts = remainParts(iso, kind, compact);
  return `<span class="amount">${escapeHtml(parts.amount)}</span><span class="verb">${escapeHtml(parts.verb)}</span>`;
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
  if (note.includes("港珠澳")) return "途經口岸";
  if (note.includes("青衣站")) return "途經青衣站";
  return "";
}

function usefulNotes(notes) {
  return (notes || []).flatMap((note) => {
    if (note.includes("編定班次") || note.includes("碼頭關閘") || note.includes("每日服務") || note.includes("港鐵")) return [];
    if (note.includes("班表摘要")) return ["上車站為中環碼頭近三號碼頭，途經香港站"];
    if (note.includes("臨海廣場")) return ["前往挪亞方舟的乘客在臨海廣場下車"];
    if (note.includes("通宵")) return ["通宵班次"];
    if (note.includes("基慧")) return ["途經基慧小學"];
    return [note];
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
        <b>${escapeHtml(whenText(iso, trip.clock, trip.dayLabel, today))}</b>
        <em data-iso="${escapeHtml(iso)}" data-kind="${kind}" data-compact="${compact ? "1" : ""}">${remainHtml(iso, kind, compact)}</em>
        ${tag ? `<span class="tag">${escapeHtml(tag)}</span>` : ""}
      </li>
    `;
  }).join("");
}

function lineHtml(id, code, where, trips, today, more) {
  const kinds = trips.map((trip) => tripKind(trip));
  const compact = kinds.length > 0 && kinds.every((kind) => kind === kinds[0]);
  const verb = compact ? (kinds[0] === "arrive" ? "到達" : "開出") : "";
  const place = verb ? `${where} · ${verb}` : where;
  const times = trips.length
    ? `<ol class="times">${tripItems(trips, today, compact)}</ol>`
    : `<p class="none">暫無班次</p>`;
  return `
    <details class="fold" data-id="${escapeHtml(id)}" ${state.open[id] ? "open" : ""}>
      <summary>
        <div class="title"><span class="code">${escapeHtml(code)}</span><span class="where">${escapeHtml(place)}</span></div>
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
      ? "所示為碼頭關閘時間，並非船隻抵達時間。"
      : "所示為開出時間，並非抵達時間。";
    const more = `
      <p>由${escapeHtml(leg.boardStop)}開往${escapeHtml(leg.destination)}。</p>
      <p>${meaning}</p>
      ${notes.map((note) => `<p>${escapeHtml(note)}</p>`).join("")}
      <p><a href="${escapeHtml(service.sourceUrl)}">班表</a> · <a href="${escapeHtml(service.fareUrl)}">${escapeHtml(service.fareText)}</a></p>
    `;
    return lineHtml(`${service.id}-${direction}`, service.route, where, leg.upcoming, today, more);
  }).join("");
}

function kmbLine(board, direction) {
  const today = hkDate(board.now);
  const slot = board.live?.kmb;
  const value = slot?.value;
  const where = direction === "from-mawan" ? "往九龍站" : "由九龍站";
  const id = `kmb-${direction}`;
  if (!value) {
    return lineHtml(id, "230R", where, [], today, "<p>暫時未能讀取到站時間。</p>");
  }
  const trips = value.trips.filter((trip) => trip.direction === direction).slice(0, 3);
  const stop = direction === "to-mawan" ? value.originTo : value.originFrom;
  const dest = direction === "to-mawan" ? value.destinationTo : value.destinationFrom;
  const stale = slot.stale ? "<p>到站時間可能尚未更新。</p>" : "";
  const more = `
    <p>九巴。由${escapeHtml(stop)}開往${escapeHtml(dest)}。</p>
    <p>無備註者為預計到達；備註為「原定班次」者為表定開出。</p>
    ${stale}
    <p><a href="${escapeHtml(value.fareUrl)}">${escapeHtml(value.fareText)}</a></p>
  `;
  return lineHtml(id, "230R", where, trips, today, more);
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
      ? `${staleNote(weatherSlot)}<p>警告狀態未能更新，未必仍然生效。</p>${lines}`
      : (lines || "<p>生效中。</p>");
    const aside = weatherSlot.stale ? `${names} · 未能更新` : names;
    parts.push(`<details class="fold alert" data-id="weather" ${state.open.weather ? "open" : ""}><summary><span class="name">天氣</span><span class="aside">${escapeHtml(aside)}</span></summary><div class="more">${body}</div></details>`);
  }
  const notice = (board.notices || []).find((item) => item.appliesToday);
  if (notice) {
    parts.push(`<details class="fold alert" data-id="notice" ${state.open.notice ? "open" : ""}><summary><span class="name">平日船期調整</span><span class="aside">受影響班次已剔除</span></summary><div class="more"><p>${escapeHtml(notice.body)}</p></div></details>`);
  }
  if ((board.calendarGaps || []).length) {
    parts.push(`<p class="alert">部分日期未能判斷是否公眾假期，該等日子的班次暫不列出。</p>`);
  }
  return parts.join("");
}

function roadHeadline(board) {
  const speeds = board.live?.speeds;
  const roads = speeds?.value?.roads || [];
  const stale = speeds?.stale && speeds.value ? " · 未能更新" : "";
  if (roads.length) {
    return roads.map((road) => `${road.road} ${road.speed}`).join(" · ") + stale;
  }
  if ((board.live?.news?.value?.messages || []).length) {
    return board.live.news.stale ? "有特別交通消息 · 未能更新" : "有特別交通消息";
  }
  if (!speeds?.value) return "暫時未能更新";
  return "暫無特別消息";
}

function roadHtml(board) {
  const news = board.live.news;
  const speeds = board.live.speeds;
  const journey = board.live.journey;
  const messages = news.value?.messages || [];
  const newsBody = !news.value
    ? "<p>交通消息暫時未能更新。</p>"
    : `${staleNote(news)}${messages.length
      ? messages.map((item) => `<p><strong>${escapeHtml(item.heading)}</strong> ${escapeHtml(item.detail)}</p>`).join("")
      : "<p>暫無影響往返馬灣路線的特別消息。</p>"}`;
  const speedBody = !speeds.value
    ? "<p>暫無車速數據。</p>"
    : `${staleNote(speeds)}${(speeds.value.roads || []).map((road) => `
    <p>${escapeHtml(road.road)} ${escapeHtml(road.speed)} 公里/小時</p>
  `).join("") || "<p>暫無車速數據。</p>"}`;
  const journeyBody = !journey.value?.rows?.length
    ? `<p>${journey?.stale ? "行車時間暫時未能更新。" : "暫無南昌站往機場的行車時間。"}</p>`
    : `${staleNote(journey)}<p>南昌站往機場：${journey.value.rows.map((row) => `${escapeHtml(row.to.includes("三號") ? "三號幹線" : "八號幹線")}約 ${escapeHtml(row.minutes)} 分鐘`).join("，")}。上述時間並非馬灣島內車程。</p>`;
  return `
    ${newsBody}
    ${speedBody}
    <p>青馬大橋、汲水門大橋、青嶼幹線、馬灣路及長青公路沒有車速，只顯示消息及閉路電視。</p>
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
  const failed = state.refreshFailed ? " · 暫時未能更新" : "";
  clockEl.textContent = `${board.now.slice(11, 16)}${failed}`;
  setHtml(alertsEl, alertHtml(board));
  setHtml(leaveEl, serviceLines(board, "from-mawan", BUS_ORDER) + kmbLine(board, "from-mawan") + serviceLines(board, "from-mawan", FERRY_ORDER));
  setHtml(backEl, serviceLines(board, "to-mawan", BUS_ORDER) + kmbLine(board, "to-mawan") + serviceLines(board, "to-mawan", FERRY_ORDER));
  roadSummaryEl.textContent = roadHeadline(board);
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
    amount.textContent = parts.amount;
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
    else clockEl.textContent = "暫時未能更新";
  } finally {
    state.refreshing = false;
  }
}

refresh();
setInterval(refresh, 60000);
setInterval(tick, 15000);
