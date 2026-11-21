const state = { board: null, refreshFailed: false, refreshing: false, open: {} };

const leaveEl = document.querySelector("#leave");
const backEl = document.querySelector("#back");
const alertsEl = document.querySelector("#alerts");
const clockEl = document.querySelector("#clock");
const roadSummaryEl = document.querySelector("#road-summary");
const roadBodyEl = document.querySelector("#road-body");
const taxiSummaryEl = document.querySelector("#taxi-summary");
const taxiBodyEl = document.querySelector("#taxi-body");

const ORDER = ["ferry-central", "ferry-tsuen-wan", "nr330", "nr332", "nr334", "nr338s", "nr338", "nr331", "nr331s"];
const PLACES = {
  "ferry-central": ["中環船", "中環"],
  "ferry-tsuen-wan": ["荃灣船", "荃灣"],
  "nr330": ["青衣巴士", "青衣站"],
  "nr332": ["葵芳巴士", "葵芳"],
  "nr334": ["機場巴士", "機場"],
  "nr338s": ["中環巴士", "中環"],
  "nr338": ["中環夜巴", "中環"],
  "nr331": ["荃灣巴士", "荃灣站"],
  "nr331s": ["荃灣西巴士", "荃灣西"],
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

function remainParts(iso, kind, now = new Date()) {
  const left = Math.ceil((new Date(iso) - now) / 60000);
  const verb = kind === "arrive" ? "後到" : "後開出";
  if (left <= 0) return { amount: kind === "arrive" ? "就快到" : "就快開出", verb: "" };
  if (left < 60) return { amount: `${left} 分鐘`, verb };
  const hours = Math.floor(left / 60);
  const minutes = left % 60;
  return { amount: minutes ? `${hours} 小時 ${minutes} 分` : `${hours} 小時`, verb };
}

function remainHtml(iso, kind) {
  const parts = remainParts(iso, kind);
  return `<span class="amount">${escapeHtml(parts.amount)}</span><span class="verb">${escapeHtml(parts.verb)}</span>`;
}

function shiftDate(day, days) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

function whenText(iso, clock, dayLabel, today) {
  const day = hkDate(iso);
  if (day === today) return clock;
  if (day === shiftDate(today, 1)) return `聽日 ${clock}`;
  return `${dayLabel || day.slice(5)} ${clock}`;
}

function shortNote(note) {
  if (!note) return "";
  if (note.includes("港珠澳")) return "經口岸";
  if (note.includes("青衣站")) return "經青衣站";
  return "";
}

function usefulNotes(notes) {
  return (notes || []).flatMap((note) => {
    if (note.includes("編定班次") || note.includes("碼頭關閘") || note.includes("每日服務") || note.includes("港鐵")) return [];
    if (note.includes("班表摘要")) return ["上車站在中環碼頭近三號碼頭，經香港站"];
    if (note.includes("臨海廣場")) return ["去挪亞方舟在臨海廣場落車"];
    if (note.includes("通宵")) return ["通宵班"];
    if (note.includes("基慧")) return ["經基慧小學"];
    return [note];
  });
}

function tripItems(trips, today, kind) {
  return trips.slice(0, 3).map((trip) => {
    const iso = trip.time || trip.eta;
    const ownKind = trip.timeLabel === "預計到達" ? "arrive" : kind;
    const tag = shortNote(trip.note);
    return `
      <li>
        <b>${escapeHtml(whenText(iso, trip.clock, trip.dayLabel, today))}</b>
        <em data-iso="${escapeHtml(iso)}" data-kind="${ownKind}">${remainHtml(iso, ownKind)}</em>
        ${tag ? `<span class="tag">${escapeHtml(tag)}</span>` : ""}
      </li>
    `;
  }).join("");
}

function lineHtml(id, name, where, trips, today, kind, more) {
  const times = trips.length
    ? `<ol class="times">${tripItems(trips, today, kind)}</ol>`
    : `<p class="none">未有接下來的班次</p>`;
  return `
    <details class="fold" data-id="${escapeHtml(id)}" ${state.open[id] ? "open" : ""}>
      <summary>
        <div class="title"><span class="name">${escapeHtml(name)}</span><span class="where">${escapeHtml(where)}</span></div>
        ${times}
      </summary>
      <div class="more">${more}</div>
    </details>
  `;
}

function serviceLines(board, direction) {
  const today = hkDate(board.now);
  const services = ORDER.map((id) => board.services.find((service) => service.id === id)).filter(Boolean);
  return services.map((service) => {
    const leg = service.directions[direction];
    const [name, place] = PLACES[service.id];
    const where = direction === "from-mawan" ? `去${place}` : `由${place}返`;
    const notes = usefulNotes(service.notes);
    const meaning = service.mode === "ferry"
      ? "時間是碼頭關閘，不是船到對面。"
      : "這是開出時間，不是到達時間。";
    const more = `
      <p>${escapeHtml(leg.boardStop)}開去${escapeHtml(leg.destination)}。</p>
      <p>${meaning}</p>
      ${notes.map((note) => `<p>${escapeHtml(note)}</p>`).join("")}
      <p><a href="${escapeHtml(service.sourceUrl)}">班表</a> · <a href="${escapeHtml(service.fareUrl)}">${escapeHtml(service.fareText)}</a></p>
    `;
    return lineHtml(`${service.id}-${direction}`, name, where, leg.upcoming, today, "leave", more);
  }).join("");
}

function kmbLine(board, direction) {
  const today = hkDate(board.now);
  const slot = board.live?.kmb;
  const value = slot?.value;
  const where = direction === "from-mawan" ? "去九龍站" : "由九龍站返";
  const id = `kmb-${direction}`;
  if (!value) {
    return lineHtml(id, "九巴 230R", where, [], today, "arrive", "<p>暫時讀不到到站時間。</p>");
  }
  const trips = value.trips.filter((trip) => trip.direction === direction).slice(0, 3);
  const stop = direction === "to-mawan" ? value.originTo : value.originFrom;
  const dest = direction === "to-mawan" ? value.destinationTo : value.destinationFrom;
  const stale = slot.stale ? "<p>到站時間可能未更新。</p>" : "";
  const more = `
    <p>${escapeHtml(stop)}去${escapeHtml(dest)}。</p>
    <p>沒有備註的是到站時間。寫著原定班次的是開出時間。</p>
    ${stale}
    <p><a href="${escapeHtml(value.fareUrl)}">${escapeHtml(value.fareText)}</a></p>
  `;
  return lineHtml(id, "九巴 230R", where, trips, today, "arrive", more);
}

function alertHtml(board) {
  const parts = [];
  const weather = board.live?.weather?.value;
  const warnings = weather?.warnings || [];
  if (warnings.length) {
    const names = warnings.map((item) => item.name).join("、");
    const lines = (weather.wind?.lines || []).map((line) => `<p>${escapeHtml(line)}</p>`).join("");
    parts.push(`<details class="fold alert" data-id="weather" ${state.open.weather ? "open" : ""}><summary><span class="name">天氣</span><span class="aside">${escapeHtml(names)}</span></summary><div class="more">${lines || "<p>生效中。</p>"}</div></details>`);
  }
  const notice = (board.notices || []).find((item) => item.appliesToday);
  if (notice) {
    parts.push(`<details class="fold alert" data-id="notice" ${state.open.notice ? "open" : ""}><summary><span class="name">平日船期有改</span><span class="aside">已在下面扣走</span></summary><div class="more"><p>${escapeHtml(notice.body)}</p></div></details>`);
  }
  if ((board.calendarGaps || []).length) {
    parts.push(`<p class="alert">有幾日未能判斷是不是假期，那些日子的班次先不顯示。</p>`);
  }
  return parts.join("");
}

function roadHeadline(board) {
  const roads = board.live?.speeds?.value?.roads || [];
  if (roads.length) {
    return roads.map((road) => `${road.road === "北大嶼山公路" ? "大嶼山公路" : road.road} ${road.speed}`).join(" · ");
  }
  if ((board.live?.news?.value?.messages || []).length) return "有交通消息";
  if (!board.live?.speeds?.value) return "暫時未能更新";
  return "沒有特別消息";
}

function roadHtml(board) {
  const news = board.live.news;
  const speeds = board.live.speeds;
  const journey = board.live.journey;
  const messages = news.value?.messages || [];
  const newsBody = !news.value
    ? "<p>交通消息暫時未能更新。</p>"
    : messages.length
      ? messages.map((item) => `<p><strong>${escapeHtml(item.heading)}</strong> ${escapeHtml(item.detail)}</p>`).join("")
      : "<p>沒有影響馬灣來回路線的特別消息。</p>";
  const speedBody = (speeds.value?.roads || []).map((road) => `
    <p>${escapeHtml(road.road)} ${escapeHtml(road.speed)} 公里/小時</p>
  `).join("") || "<p>這次沒有車速數字。</p>";
  const journeyBody = (journey.value?.rows || []).map((row) => `<p>${escapeHtml(row.from)}去${escapeHtml(row.to)}約 ${escapeHtml(row.minutes)} 分鐘。</p>`).join("")
    || "<p>未有南昌站去機場的時間。</p>";
  return `
    ${newsBody}
    ${speedBody}
    <p>青馬大橋、汲水門大橋、青嶼幹線、馬灣路、長青公路沒有車速，只看消息同鏡頭。</p>
    ${journeyBody}
    <p>上面的分鐘由南昌站計，不是馬灣島內的車程。</p>
  `;
}

function taxiCopy(taxi) {
  const openNow = taxi.status.startsWith("現在至晚上11時");
  if (openNow) {
    return {
      summary: "而家至晚上 11 時可以入珀欣路",
      body: "<p>市區的士可以去挪亞方舟正門。</p><p>馬灣路、芳園路一帶全日可以入。沒有許可證的私家車不可入。</p><p>貨車是上午 10 時至下午 4 時。旅遊巴是上午 9 時至晚上 11 時。</p>",
    };
  }
  return {
    summary: "而家珀欣路不准市區的士入",
    body: "<p>珀欣路是上午 9 時至晚上 11 時先可以入。</p><p>馬灣路、芳園路一帶全日可以入。沒有許可證的私家車不可入。</p><p>貨車是上午 10 時至下午 4 時。旅遊巴是上午 9 時至晚上 11 時。</p>",
  };
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
  setHtml(leaveEl, serviceLines(board, "from-mawan") + kmbLine(board, "from-mawan"));
  setHtml(backEl, serviceLines(board, "to-mawan") + kmbLine(board, "to-mawan"));
  roadSummaryEl.textContent = roadHeadline(board);
  setHtml(roadBodyEl, roadHtml(board));
  updateCameras(board.live.cameras || []);
  const taxi = taxiCopy(board.taxi);
  taxiSummaryEl.textContent = taxi.summary;
  setHtml(taxiBodyEl, `${taxi.body}<p><a href="${escapeHtml(board.taxi.sourceUrl)}">運輸署通告</a></p>`);
  if (scrollY !== null) window.scrollTo(0, scrollY);
}

function tick() {
  document.querySelectorAll("[data-iso]").forEach((el) => {
    const parts = remainParts(el.dataset.iso, el.dataset.kind);
    const amount = el.querySelector(".amount");
    const verb = el.querySelector(".verb");
    if (!amount || !verb) return;
    amount.textContent = parts.amount;
    verb.textContent = parts.verb;
  });
}

function updateCameras(cameras) {
  const root = document.querySelector("#cameras");
  const seen = new Set();
  cameras.forEach((camera) => {
    seen.add(camera.id);
    let figure = root.querySelector(`[data-id="${camera.id}"]`);
    if (!figure) {
      figure = document.createElement("figure");
      figure.dataset.id = camera.id;
      root.append(figure);
    }
    let captionEl = figure.querySelector("figcaption");
    if (!captionEl) {
      captionEl = document.createElement("figcaption");
      figure.append(captionEl);
    }
    captionEl.textContent = camera.message ? `${camera.name}，暫時沒有畫面` : camera.name;
    const wantImage = camera.status === "ok" || camera.lastGoodAt;
    const token = camera.lastGoodAt || camera.fetchedAt || "";
    const image = figure.querySelector("img");
    if (wantImage) {
      figure.querySelector(".blank")?.remove();
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
    } else if (!figure.querySelector(".blank")) {
      image?.remove();
      const blank = document.createElement("div");
      blank.className = "blank";
      blank.textContent = "鏡頭暫時沒有畫面";
      figure.prepend(blank);
    }
  });
  root.querySelectorAll("figure").forEach((figure) => {
    if (!seen.has(figure.dataset.id)) figure.remove();
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
