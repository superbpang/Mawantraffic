const state = { board: null, refreshFailed: false, refreshing: false, open: {} };

const leaveEl = document.querySelector("#leave");
const backEl = document.querySelector("#back");
const leaveSummaryEl = document.querySelector("#leave-summary");
const backSummaryEl = document.querySelector("#back-summary");
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

function remainHtml(iso, kind, compact, stacked = true) {
  const parts = remainParts(iso, kind, compact);
  const amount = stacked ? formatAmount(parts.amount) : escapeHtml(parts.amount);
  return `<span class="amount">${amount}</span><span class="verb">${escapeHtml(parts.verb)}</span>`;
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

function boundLabel(destination) {
  if (destination.includes("珀欣")) return "往珀欣路";
  if (destination.includes("碼頭")) return "往珀麗灣碼頭";
  return "往珀麗灣";
}

function serviceRow(board, direction, id) {
  const service = board.services.find((item) => item.id === id);
  if (!service) return null;
  const leg = service.directions[direction];
  const place = DEST[service.id];
  return {
    stop: leg.boardStop,
    code: service.route,
    where: direction === "from-mawan" ? `往${place}` : boundLabel(leg.destination),
    kindClass: service.mode === "ferry" ? "ferry" : "bus",
    trip: leg.upcoming[0] || null,
    today: hkDate(board.now),
    note: "",
    href: service.sourceUrl,
  };
}

function kmbRow(board, direction) {
  const slot = board.live?.kmb;
  const value = slot?.value;
  const stop = !value
    ? (direction === "from-mawan" ? "馬灣（珀欣路）" : "九龍站")
    : (direction === "to-mawan" ? value.originTo : value.originFrom);
  const trip = value
    ? value.trips.filter((item) => item.direction === direction)[0] || null
    : null;
  let note = "";
  if (!value) note = "暫時未能讀取九巴到站時間。";
  else if (slot?.stale) {
    const time = clockOf(slot.fetchedAt);
    note = time ? `未能更新。以下為 ${time} 的資料。` : "未能更新。以下為較早的資料。";
  }
  return {
    stop,
    code: "230R",
    where: direction === "from-mawan" ? "往九龍站" : "往珀欣路",
    kindClass: "kmb",
    trip,
    today: hkDate(board.now),
    note,
    href: value?.fareUrl || "https://search.kmb.hk/KMBWebSite/?action=routesearch&route=230R",
  };
}

function directionRows(board, direction) {
  return [
    ...BUS_ORDER.map((id) => serviceRow(board, direction, id)),
    kmbRow(board, direction),
    ...FERRY_ORDER.map((id) => serviceRow(board, direction, id)),
  ].filter(Boolean);
}

function waitHtml(row) {
  const trip = row.trip;
  const iso = trip?.time || trip?.eta;
  if (!iso) return `<span class="none">暫無班次</span>`;
  const kind = tripKind(trip);
  const action = kind === "arrive" ? "到達" : "開出";
  return `
    <em data-iso="${escapeHtml(iso)}" data-kind="${kind}" data-compact="1">${remainHtml(iso, kind, true)}</em>
    <b>${escapeHtml(whenText(iso, trip.clock, trip.dayLabel, row.today))}</b>
    <span class="act">${action}</span>
  `;
}

function rowHtml(row) {
  const tag = shortNote(row.trip?.note);
  return `
    <li class="depart ${row.kindClass}">
      <span class="badge">${escapeHtml(row.code)}</span>
      <span class="going">
        <span class="where">${escapeHtml(row.where)}</span>
        ${tag ? `<span class="tag">${escapeHtml(tag)}</span>` : ""}
        ${row.note ? `<span class="note">${escapeHtml(row.note)}</span>` : ""}
        <a href="${escapeHtml(row.href)}">班表</a>
      </span>
      <span class="wait">${waitHtml(row)}</span>
    </li>
  `;
}

function stopKey(stop) {
  return String(stop).replaceAll("（", "(").replaceAll("）", ")");
}

function directionHtml(rows) {
  const groups = [];
  rows.forEach((row) => {
    const last = groups[groups.length - 1];
    if (!last || stopKey(last.stop) !== stopKey(row.stop)) groups.push({ stop: row.stop, rows: [row] });
    else last.rows.push(row);
  });
  return groups.map((group) => `
    <section class="stop-block">
      <h3>${escapeHtml(group.stop)}</h3>
      <ul>${group.rows.map(rowHtml).join("")}</ul>
    </section>
  `).join("");
}

function soonestHtml(rows) {
  const ranked = rows
    .map((row) => ({ row, iso: row.trip?.time || row.trip?.eta || "" }))
    .filter((item) => item.iso)
    .sort((a, b) => new Date(a.iso) - new Date(b.iso));
  if (!ranked.length) return "暫無班次";
  const { row, iso } = ranked[0];
  const kind = tripKind(row.trip);
  return `${escapeHtml(row.code)}　${escapeHtml(row.stop)}　<em data-iso="${escapeHtml(iso)}" data-kind="${kind}" data-compact="1" data-flat="1">${remainHtml(iso, kind, true, false)}</em>`;
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
  const leaveRows = directionRows(board, "from-mawan");
  const backRows = directionRows(board, "to-mawan");
  setHtml(leaveEl, directionHtml(leaveRows));
  setHtml(backEl, directionHtml(backRows));
  leaveSummaryEl.innerHTML = soonestHtml(leaveRows);
  backSummaryEl.innerHTML = soonestHtml(backRows);
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
    amount.innerHTML = el.dataset.flat === "1" ? escapeHtml(parts.amount) : formatAmount(parts.amount);
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
