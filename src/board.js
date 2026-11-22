import schedule from "./schedule.json" with { type: "json" };

const WEEKDAY = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const HK_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Hong_Kong",
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function atHk(year, month, day, hour, minute, second = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour - 8, minute, second));
}

export function hkParts(date) {
  const bag = {};
  for (const part of HK_FORMAT.formatToParts(date)) bag[part.type] = part.value;
  return bag;
}

export function isoHk(date) {
  const part = hkParts(date);
  return `${part.year}-${part.month}-${part.day}T${part.hour}:${part.minute}:${part.second}+08:00`;
}

export function dateKey(date) {
  const part = hkParts(date);
  return `${part.year}-${part.month}-${part.day}`;
}

function weekdayIndex(date) {
  const name = hkParts(date).weekday;
  if (!(name in WEEKDAY)) throw new Error(`未知星期 ${name}`);
  return WEEKDAY[name];
}

function addDays(key, offset) {
  const [year, month, day] = key.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + offset));
  const monthText = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dayText = String(shifted.getUTCDate()).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${monthText}-${dayText}`;
}

export function dayKind(date) {
  const key = dateKey(date);
  const weekday = weekdayIndex(date);
  if (weekday === 6) {
    return { key: "sunday", label: "星期日", isSunday: true, isHoliday: true, table: "weekend" };
  }
  const holidays = schedule.holidays[key.slice(0, 4)];
  if (!holidays) {
    return { key: "unknown", label: "假期表未涵蓋", isSunday: false, isHoliday: false, table: "unknown" };
  }
  if (holidays.includes(key)) {
    return { key: "holiday", label: "公眾假期", isSunday: false, isHoliday: true, table: "weekend" };
  }
  if (weekday === 5) {
    return { key: "saturday", label: "星期六", isSunday: false, isHoliday: false, table: "weekend" };
  }
  return { key: "weekday", label: "平日", isSunday: false, isHoliday: false, table: "weekday" };
}

function kindForKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return dayKind(atHk(year, month, day, 12, 0));
}

function floorMinute(date) {
  const part = hkParts(date);
  return atHk(Number(part.year), Number(part.month), Number(part.day), Number(part.hour), Number(part.minute));
}

function timesFor(direction, kind) {
  if (direction.daily) return direction.daily;
  return direction[kind.table] || direction.weekday || [];
}

function suppressed(routeId, direction, day, token, kind) {
  if (kind.key !== "weekday") return null;
  for (const notice of schedule.notices) {
    if (!notice.weekdayOnly) continue;
    if (day < notice.effectiveFrom) continue;
    for (const rule of notice.suppress) {
      if (rule.routeId === routeId && rule.direction === direction && rule.times.includes(token)) {
        return notice.id;
      }
    }
  }
  return null;
}

export function upcoming(route, directionName, now, limit = 3) {
  const direction = route.directions[directionName];
  const found = [];
  const startKey = dateKey(now);
  const cutoff = floorMinute(now).getTime();
  for (let offset = 0; offset < 3; offset += 1) {
    const key = addDays(startKey, offset);
    const kind = kindForKey(key);
    if (kind.key === "unknown") continue;
    const [year, month, day] = key.split("-").map(Number);
    for (const item of timesFor(direction, kind)) {
      const [hour, minute] = item.time.split(":").map(Number);
      const moment = atHk(year, month, day, hour, minute);
      const stamp = moment.getTime();
      if (stamp < cutoff) continue;
      if (item.skipSundayHoliday && (kind.isSunday || kind.isHoliday)) continue;
      if (suppressed(route.id, directionName, key, item.time, kind)) continue;
      found.push({
        stamp,
        moment,
        clock: item.time,
        note: item.note || "",
        dayLabel: kind.label,
        grade: route.grade,
        timeLabel: route.timeLabel,
      });
    }
  }
  found.sort((a, b) => a.stamp - b.stamp);
  return found.slice(0, limit).map((item) => ({
    time: isoHk(item.moment),
    clock: item.clock,
    note: item.note,
    dayLabel: item.dayLabel,
    grade: item.grade,
    timeLabel: item.timeLabel,
  }));
}

function serviceView(route, now) {
  const directions = {};
  for (const [name, direction] of Object.entries(route.directions)) {
    directions[name] = {
      originId: direction.originId,
      boardStop: direction.boardStop,
      destination: direction.destination,
      upcoming: upcoming(route, name, now),
    };
  }
  return {
    id: route.id,
    route: route.route,
    operator: route.operator,
    mode: route.mode,
    grade: route.grade,
    timeLabel: route.timeLabel,
    effectiveDate: route.effectiveDate,
    capturedOn: route.capturedOn,
    sourceName: route.sourceName,
    sourceUrl: route.sourceUrl,
    fareUrl: route.fareUrl,
    fareText: "票價見官網",
    notes: route.notes,
    directions,
    live: false,
  };
}

function noticeViews(now) {
  const kind = dayKind(now);
  const day = dateKey(now);
  return schedule.notices.map((notice) => {
    const applies = kind.key === "weekday" && day >= notice.effectiveFrom;
    let text = notice.body;
    if (kind.key === "unknown") text += " 假期表未涵蓋今日，這項平日調整未套用。";
    else if (applies) text += " 今日是平日，受影響的表定班次已從下一班剔除。";
    else text += " 今日不是受影響的平日，班表不套用這項調整。";
    return {
      id: notice.id,
      grade: notice.grade,
      title: notice.title,
      body: text,
      appliesToday: applies,
      sourceName: notice.sourceName,
      sourceUrl: notice.sourceUrl,
      capturedOn: notice.capturedOn,
      effectiveFrom: notice.effectiveFrom,
    };
  });
}

export function board(now = new Date()) {
  const kind = dayKind(now);
  const start = dateKey(now);
  const gaps = [];
  for (let offset = 0; offset < 3; offset += 1) {
    const key = addDays(start, offset);
    if (kindForKey(key).key === "unknown") gaps.push(key);
  }
  return {
    now: isoHk(now),
    dayLabel: kind.label,
    calendarGaps: gaps,
    origins: schedule.origins,
    notices: noticeViews(now),
    services: schedule.routes.map((route) => serviceView(route, now)),
    cameras: schedule.cameras,
  };
}

export function routeById(id) {
  return schedule.routes.find((route) => route.id === id);
}
