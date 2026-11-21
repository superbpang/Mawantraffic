const state = { origin: "mawan", direction: "from-mawan", board: null };

const originsEl = document.querySelector("#origins");
const servicesEl = document.querySelector("#services");
const noticesEl = document.querySelector("#notices");
const roadEl = document.querySelector("#road");
const taxiEl = document.querySelector("#taxi");
const aboutEl = document.querySelector("#about");
const clockEl = document.querySelector("#clock");

document.querySelectorAll(".directions button").forEach((button) => {
  button.addEventListener("click", () => {
    state.direction = button.dataset.direction;
    render();
  });
});

function gradeClass(grade, stale) {
  if (stale) return "badge stale";
  if (grade === "官方實時") return "badge live";
  if (grade === "服務通告") return "badge notice";
  return "badge";
}

function tripLabel(item, today) {
  const day = (item.time || item.eta || "").slice(0, 10);
  let clock = day && day !== today ? `${item.dayLabel || day.slice(5)} ${item.clock}` : item.clock;
  if (item.timeLabel && (item.eta || Object.hasOwn(item, "remark"))) {
    clock = `${clock} ${item.timeLabel}`;
  }
  if (item.note) return `${clock}（${item.note}）`;
  if (item.remark) return `${clock}（${item.remark}）`;
  return clock;
}

function laterText(items, today) {
  return items.map((item) => tripLabel(item, today)).join("、");
}

function clockOf(iso) {
  if (!iso) return "";
  const text = /T/.test(iso) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(iso) ? `${iso}+08:00` : iso;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return iso.replace("T", " ").slice(0, 16);
  return new Intl.DateTimeFormat("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

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

function render(options = {}) {
  const board = state.board;
  if (!board) return;
  const scrollY = options.keepScroll ? window.scrollY : null;
  document.querySelectorAll(".directions button").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.direction === state.direction));
  });
  const originsHtml = board.origins.map((origin) => `
    <button type="button" data-origin="${origin.id}" aria-pressed="${origin.id === state.origin}">${origin.label}</button>
  `).join("");
  if (setHtml(originsEl, originsHtml)) {
    originsEl.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => {
        state.origin = button.dataset.origin;
        state.direction = state.origin === "mawan" ? "from-mawan" : "to-mawan";
        render();
      });
    });
  }
  clockEl.textContent = `${clockOf(board.now)} · ${board.dayLabel}`;
  setHtml(noticesEl, board.notices.map((notice) => `
    <article class="notice">
      <h2><span class="${gradeClass(notice.grade)}">${notice.grade}</span> ${escapeHtml(notice.title)}</h2>
      <p>${escapeHtml(notice.body)}</p>
      <p class="meta">資料時間：通告由 ${escapeHtml(notice.effectiveFrom)} 起，擷取 ${escapeHtml(notice.capturedOn)} · ${escapeHtml(notice.sourceName)}</p>
    </article>
  `).join("") + weatherHtml(board.live.weather));

  const cards = scheduledCards(board).concat(kmbCard(board));
  setHtml(servicesEl, cards.length ? cards.join("") : `<article class="card empty"><p>這個起點沒有「${state.direction === "to-mawan" ? "往馬灣" : "離開馬灣"}」的開出班次。請轉換方向或起點。</p></article>`);
  renderRoad(board);
  setHtml(taxiEl, taxiHtml(board.taxi));
  if (!aboutEl.dataset.drawn) setHtml(aboutEl, aboutHtml());
  if (scrollY !== null) window.scrollTo(0, scrollY);
}

function weatherHtml(slot) {
  const value = slot?.value;
  if (!value || slot.stale && !value.warnings?.length) return "";
  if (!value.warnings?.length) return "";
  const lines = value.warnings.map((item) => `${item.name}（${item.action || "生效"}，${clockOf(item.issueTime)}）`).join("、");
  const quote = (value.wind?.lines || []).map((line) => `<li>${escapeHtml(line)}</li>`).join("");
  return `<article class="notice"><h2>天氣警告</h2><p>${escapeHtml(lines)}</p><ul>${quote}</ul><p class="meta">${slot.status} · 資料時間：${escapeHtml(clockOf(slot.fetchedAt))} · ${escapeHtml(value.sourceName)}</p></article>`;
}

function scheduledCards(board) {
  return board.services.flatMap((service) => {
    const direction = service.directions[state.direction];
    if (!direction || direction.originId !== state.origin) return [];
    const today = board.now.slice(0, 10);
    const next = direction.upcoming[0];
    const later = laterText(direction.upcoming.slice(1), today);
    return [`
      <article class="card">
        <header>
          <h2 class="route">${escapeHtml(service.route)} <span class="meta">${escapeHtml(service.operator)}</span></h2>
          <span class="${gradeClass(service.grade)}">${escapeHtml(service.grade)}</span>
        </header>
        <p class="stops">${escapeHtml(direction.boardStop)} → ${escapeHtml(direction.destination)}</p>
        <p class="depart">${next ? escapeHtml(next.clock) : "今日稍後沒有班次"}</p>
        <p>${next ? `${escapeHtml(next.timeLabel)} · ${escapeHtml(next.dayLabel)}` : ""} ${next?.note ? `· ${escapeHtml(next.note)}` : ""}</p>
        <p class="later">${later ? `其後 ${escapeHtml(later)}` : ""}</p>
        <p class="note">${service.notes.map(escapeHtml).join(" · ")}</p>
        <p class="meta">資料時間：班表 ${escapeHtml(service.effectiveDate)} 生效，${escapeHtml(service.capturedOn)} 擷取 · <a href="${escapeHtml(service.sourceUrl)}">${escapeHtml(service.sourceName)}</a> · <a href="${escapeHtml(service.fareUrl)}">${escapeHtml(service.fareText)}</a></p>
      </article>
    `];
  });
}

function kmbCard(board) {
  const slot = board.live?.kmb;
  const value = slot?.value;
  if (!value) {
    const show = (state.origin === "kowloon" && state.direction === "to-mawan") || (state.origin === "mawan" && state.direction === "from-mawan");
    if (!show) return [];
    return [`<article class="card"><header><h2 class="route">230R <span class="meta">九巴</span></h2><span class="badge stale">暫時未能更新</span></header><p>未有成功讀取過九巴到站。</p></article>`];
  }
  const trips = value.trips.filter((trip) => trip.direction === state.direction).slice(0, 3);
  const matches = (state.direction === "to-mawan" && state.origin === "kowloon") || (state.direction === "from-mawan" && state.origin === "mawan");
  if (!matches) return [];
  const today = board.now.slice(0, 10);
  const next = trips[0];
  const grade = slot.stale ? "暫時未能更新" : (next?.grade || "官方班表");
  const stop = state.direction === "to-mawan" ? value.originTo : value.originFrom;
  const dest = state.direction === "to-mawan" ? value.destinationTo : value.destinationFrom;
  return [`
    <article class="card">
      <header>
        <h2 class="route">230R <span class="meta">九巴</span></h2>
        <span class="${gradeClass(next?.grade, slot.stale)}">${escapeHtml(grade)}</span>
      </header>
      <p class="stops">${escapeHtml(stop)} → ${escapeHtml(dest)}</p>
      <p class="depart">${next ? escapeHtml(next.clock) : "未有到站時間"}</p>
      <p>${next ? `${escapeHtml(next.timeLabel)}${next.remark ? ` · 備註：${escapeHtml(next.remark)}` : ""}` : ""}</p>
      <p class="later">${trips.slice(1).length ? `其後 ${escapeHtml(laterText(trips.slice(1), today))}` : ""}</p>
      <p class="note">${value.notes.map(escapeHtml).join(" ")} 港鐵只作轉乘提示，不顯示到站時間。</p>
      <p class="meta">${escapeHtml(slot.status)} · 資料時間：${escapeHtml(clockOf(value.dataTime || slot.fetchedAt))} · <a href="${escapeHtml(value.sourceUrl)}">${escapeHtml(value.sourceName)}</a> · <a href="${escapeHtml(value.fareUrl)}">${escapeHtml(value.fareText)}</a></p>
    </article>
  `];
}

function roadHtml(board) {
  const news = board.live.news;
  const speeds = board.live.speeds;
  const journey = board.live.journey;
  const messages = news.value?.messages || [];
  const newsBody = !news.value
    ? "暫時未能更新"
    : messages.length
      ? messages.map((item) => `<p><strong>${escapeHtml(item.heading)}</strong> ${escapeHtml(item.detail)} ${escapeHtml(item.location)}</p>`).join("")
      : `<p>${escapeHtml(news.value.emptyText)}</p>`;
  const speedBody = (speeds.value?.roads || []).map((road) => `
    <div class="speed"><span>${escapeHtml(road.road)}<br><span class="meta">${escapeHtml(road.detector)}</span></span><strong>${escapeHtml(road.speed)} <span class="meta">公里/小時</span></strong></div>
  `).join("") || `<p class="meta">這次讀數沒有可顯示的有效車速。</p>`;
  const omitted = (speeds.value?.omitted || ["青嶼幹線", "青馬大橋", "汲水門大橋", "馬灣路", "長青公路"]).join("、");
  const journeyBody = (journey.value?.rows || []).map((row) => `<p>${escapeHtml(row.from)} → ${escapeHtml(row.to)}：${escapeHtml(row.minutes)} 分鐘</p>`).join("") || `<p class="meta">未有南昌站告示的機場行車時間。</p>`;
  return `
    <h2>相關走廊路面</h2>
    <p class="meta">只看往返馬灣的走廊，不是全港車速圖。</p>
    ${newsBody}
    <p class="meta">${escapeHtml(news.status)} · 資料時間：${escapeHtml(clockOf(news.fetchedAt))} · ${escapeHtml(news.value?.sourceName || "運輸署特別交通消息")}</p>
    <div class="speeds">${speedBody}</div>
    <p class="meta">${escapeHtml(omitted)}：只有消息同鏡頭。${escapeHtml(speeds.value?.omittedReason || "")}</p>
    <p class="meta">${escapeHtml(speeds.status)} · 資料時間：${escapeHtml(speeds.value?.period || clockOf(speeds.fetchedAt))} · ${escapeHtml(speeds.value?.sourceName || "運輸署車速")}</p>
    ${journeyBody}
    <p class="note">${escapeHtml(journey.value?.note || "")}</p>
    <p class="meta">${escapeHtml(journey.status)} · 資料時間：${escapeHtml(clockOf(journey.value?.capture) || clockOf(journey.fetchedAt))}</p>
  `;
}

function renderRoad(board) {
  if (!roadEl.querySelector("#road-body")) {
    roadEl.innerHTML = `<article class="panel"><div id="road-body"></div><div class="cameras" id="cameras"></div></article>`;
  }
  setHtml(document.querySelector("#road-body"), roadHtml(board));
  updateCameras(board.live.cameras || []);
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
    const caption = camera.message ? `${camera.name} · ${camera.message}` : `${camera.name} · ${clockOf(camera.lastGoodAt)}`;
    let captionEl = figure.querySelector("figcaption");
    if (!captionEl) {
      captionEl = document.createElement("figcaption");
      figure.append(captionEl);
    }
    captionEl.textContent = caption;
    const wantImage = camera.status === "ok" || camera.lastGoodAt;
    const token = camera.lastGoodAt || camera.fetchedAt || "";
    const image = figure.querySelector("img");
    if (wantImage) {
      figure.querySelector(".blank")?.remove();
      const picture = image || document.createElement("img");
      picture.alt = `${camera.name}閉路電視`;
      if (!image) figure.prepend(picture);
      if (picture.dataset.token !== token) {
        picture.dataset.token = token;
        picture.src = `/cameras/${encodeURIComponent(camera.id)}.jpg?t=${encodeURIComponent(token)}`;
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

function taxiHtml(taxi) {
  return `
    <article class="panel">
      <h2>${escapeHtml(taxi.title)}</h2>
      <p>${escapeHtml(taxi.status)}</p>
      <p>${escapeHtml(taxi.always)}</p>
      <p>${escapeHtml(taxi.goods)}</p>
      <p class="meta">${escapeHtml(taxi.dataTimeLabel)}：${escapeHtml(taxi.effective)} · 擷取 ${escapeHtml(taxi.capturedOn)} · <a href="${escapeHtml(taxi.sourceUrl)}">${escapeHtml(taxi.sourceName)}</a></p>
    </article>
  `;
}

function aboutHtml() {
  return `
    <article class="panel" id="sources">
      <h2>關於資料</h2>
      <p>官方實時只用於來源寫明到站、車速、行車時間、閉路電視或特別交通消息，而且更新周期短於五分鐘。官方班表是營辦商或運輸署公布的開出時間。服務通告覆蓋同日受影響班次。推估不在這一版顯示。</p>
      <p>2026 年公眾假期採用香港政府一站通假期頁，頁尾修訂日期為 2025 年 5 月。沒有編入 2027 年假期。陽光巴士 2020 年改道通告尚未核對，頁面使用 2024 年 12 月 15 日的班表。</p>
      <p class="meta"><a href="https://data.gov.hk/en/terms-and-conditions">DATA.GOV.HK 使用條款</a> · <a href="https://www.gov.hk/tc/about/abouthk/holiday/2026.htm">2026 年公眾假期</a></p>
    </article>
  `;
}

async function refresh() {
  try {
    const response = await fetch("/api/board", { cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    state.board = await response.json();
    render({ keepScroll: true });
  } catch (error) {
    clockEl.textContent = state.board ? `${clockOf(state.board.now)} · 暫時未能更新` : "暫時未能更新";
  }
}

refresh();
setInterval(refresh, 60000);
