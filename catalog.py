"""版本化班表。欄位：路線、方向、營辦商、服務日類型、開出時間、起點站名、備註、來源、生效日期、擷取日期。

鐘點來自 2026-11-21 打開的營辦商 PDF。渡輪時間是碼頭關閘時間。
NR330 的星號班次在星期日及公眾假期不開出。NR332 往返葵芳不途經青衣站，通宵班次仍然開出。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

HK = ZoneInfo("Asia/Hong_Kong")

HOLIDAYS_2026 = {
    date(2026, 1, 1),
    date(2026, 2, 17),
    date(2026, 2, 18),
    date(2026, 2, 19),
    date(2026, 4, 3),
    date(2026, 4, 4),
    date(2026, 4, 6),
    date(2026, 4, 7),
    date(2026, 5, 1),
    date(2026, 5, 25),
    date(2026, 6, 19),
    date(2026, 7, 1),
    date(2026, 9, 26),
    date(2026, 10, 1),
    date(2026, 10, 19),
    date(2026, 12, 25),
    date(2026, 12, 26),
}
# https://www.gov.hk/tc/about/abouthk/holiday/2027.htm 頁尾修訂日期：2026年5月。2026-11-21 擷取。
# 年初二是星期日，補假在年初四。
HOLIDAYS_2027 = {
    date(2027, 1, 1),
    date(2027, 2, 6),
    date(2027, 2, 8),
    date(2027, 2, 9),
    date(2027, 3, 26),
    date(2027, 3, 27),
    date(2027, 3, 29),
    date(2027, 4, 5),
    date(2027, 5, 1),
    date(2027, 5, 13),
    date(2027, 6, 9),
    date(2027, 7, 1),
    date(2027, 9, 16),
    date(2027, 10, 1),
    date(2027, 10, 8),
    date(2027, 12, 25),
    date(2027, 12, 27),
}
HOLIDAYS_BY_YEAR = {2026: HOLIDAYS_2026, 2027: HOLIDAYS_2027}

ORIGINS = [
    {"id": "central", "label": "中環"},
    {"id": "tsuen-wan", "label": "荃灣"},
    {"id": "tsing-yi", "label": "青衣站"},
    {"id": "kwai-fong", "label": "葵芳"},
    {"id": "kowloon", "label": "九龍站"},
    {"id": "airport", "label": "機場"},
    {"id": "mawan", "label": "馬灣"},
]


def hm(hour: int, minute: int) -> str:
    return f"{hour:02d}:{minute:02d}"


def expand(rows: list[tuple[int, list[int]]], starred: set[str] | None = None, note: str = "") -> list[dict]:
    starred = starred or set()
    out = []
    for hour, minutes in rows:
        for minute in minutes:
            token = hm(hour, minute)
            item = {"time": token, "note": note}
            if token in starred:
                item["skipSundayHoliday"] = True
                item["note"] = "星期日及公眾假期不設服務"
            out.append(item)
    return out


def every(start: str, end: str, step: int) -> list[dict]:
    sh, sm = map(int, start.split(":"))
    eh, em = map(int, end.split(":"))
    cur = sh * 60 + sm
    last = eh * 60 + em
    if last < cur:
        last += 24 * 60
    out = []
    while cur <= last:
        minute_of_day = cur % (24 * 60)
        out.append({"time": hm(minute_of_day // 60, minute_of_day % 60), "note": ""})
        cur += step
    return out


def clock(values: list[str], note: str = "") -> list[dict]:
    return [{"time": value, "note": note} for value in values]


PITCL_BUS = "http://www.pitcl.com.hk/tc/bus_service.php"
PITCL_FERRY = "http://www.pitcl.com.hk/tc/ferry_service.php"
SUNBUS = "http://www.sunbus.com.hk/tc/"

NR330_PI_WEEKDAY = expand([
    (6, [0, 15, 30, 35, 40, 45, 50, 55]),
    (7, [0, 5, 10, 15, 20, 25, 30, 34, 38, 42, 46, 50, 54, 58]),
    (8, [2, 6, 10, 14, 18, 22, 26, 30, 35, 40, 45, 50, 55]),
    (9, [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]),
    *[(hour, [0, 10, 20, 30, 40, 50]) for hour in range(10, 16)],
    (16, [0, 10, 20, 30, 36, 42, 48, 54]),
    *[(hour, [0, 6, 12, 18, 24, 30, 36, 42, 48, 54]) for hour in range(17, 20)],
    *[(hour, [0, 12, 24, 36, 48]) for hour in range(20, 23)],
    (23, [0, 15, 30, 45]),
    (0, [0, 15, 30]),
])
NR330_TY_WEEKDAY = expand([
    (6, [15, 30, 40, 50]),
    *[(hour, [0, 10, 20, 30, 40, 50]) for hour in range(7, 16)],
    (16, [0, 10, 20, 30, 36, 42, 48, 54]),
    (17, [0, 6, 12, 18, 24, 30, 36, 42, 48, 54]),
    *[(hour, [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]) for hour in (18, 19)],
    (20, [0, 5, 10, 15, 20, 25, 30, 36, 42, 48, 54]),
    *[(hour, [0, 6, 12, 18, 24, 30, 36, 42, 48, 54]) for hour in (21, 22)],
    (23, [0, 6, 12, 18, 24, 30, 40, 50]),
    (0, [0, 15, 30, 45]),
])
NR330_PI_WEEKEND = expand(
    [
        (6, [0, 15, 30, 40, 50]),
        (7, [0, 10, 20, 30, 35, 40, 45, 50, 55]),
        (8, [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]),
        *[(hour, [0, 6, 12, 18, 24, 30, 36, 42, 48, 54]) for hour in (9, 10)],
        *[(hour, [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]) for hour in (11, 12)],
        *[(hour, [0, 6, 12, 18, 24, 30, 36, 42, 48, 54]) for hour in range(13, 17)],
        *[(hour, [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]) for hour in (17, 18)],
        *[(hour, [0, 6, 12, 18, 24, 30, 36, 42, 48, 54]) for hour in range(19, 23)],
        (23, [0, 15, 30, 45]),
        (0, [0, 15, 30]),
    ],
    starred={"07:35", "07:45", "07:55", "08:05", "08:15", "08:25", "08:35", "08:45", "08:55"},
)
NR330_TY_WEEKEND = expand([
    (6, [15, 30, 40, 50]),
    *[(hour, [0, 10, 20, 30, 40, 50]) for hour in range(7, 10)],
    (10, [0, 6, 12, 18, 24, 30, 36, 42, 48, 54]),
    *[(hour, [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]) for hour in (11, 12)],
    *[(hour, [0, 6, 12, 18, 24, 30, 36, 42, 48, 54]) for hour in range(13, 17)],
    *[(hour, [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]) for hour in (17, 18)],
    *[(hour, [0, 6, 12, 18, 24, 30, 36, 42, 48, 54]) for hour in range(19, 23)],
    (23, [0, 6, 12, 18, 24, 30, 40, 50]),
    (0, [0, 15, 30, 45]),
])

NR332_PI_WEEKDAY = expand([
    (6, [0, 15, 30, 40, 50]),
    (7, [0, 10, 20, 30, 38, 46, 54]),
    (8, [2, 10, 18, 26, 34, 42, 50]),
    (9, [0, 10, 20, 30, 40, 50]),
    *[(hour, [0, 12, 24, 36, 48]) for hour in range(10, 17)],
    *[(hour, [0, 10, 20, 30, 40, 50]) for hour in (17, 18)],
    *[(hour, [0, 12, 24, 36, 48]) for hour in range(19, 23)],
    (23, [0, 15, 30, 45]),
    (0, [0, 15, 45]),
]) + clock(["01:00", "01:45", "02:30", "03:15", "04:00", "04:45", "05:30"])
NR332_KF_WEEKDAY = expand([
    (6, [20, 35, 45, 55]),
    *[(hour, [5, 15, 25, 35, 45, 55]) for hour in (7, 8)],
    (9, [5, 15, 25, 35, 45]),
    *[(hour, [0, 12, 24, 36, 48]) for hour in range(10, 17)],
    (17, [0, 10, 20, 30, 40, 50, 58]),
    (18, [6, 14, 22, 30, 38, 46, 54]),
    (19, [2, 10, 18, 26, 34, 42, 50, 58]),
    (20, [6, 14, 22, 30, 38, 46, 54]),
    (21, [2, 10, 18, 26, 34, 42, 50, 58]),
    (22, [6, 14, 22, 30, 38, 46, 54]),
    (23, [2, 15, 30, 45]),
    (0, [0, 30]),
    (1, [0, 25]),
    (2, [10, 55]),
    (3, [40]),
    (4, [25]),
    (5, [10, 55]),
])
NR332_PI_WEEKEND = expand([
    (6, [0, 15, 30, 40, 50]),
    *[(hour, [0, 10, 20, 30, 40, 50]) for hour in (7, 8)],
    (9, [0, 10, 20, 30, 45]),
    *[(hour, [0, 12, 24, 36, 48]) for hour in range(10, 17)],
    *[(hour, [0, 10, 20, 30, 40, 50]) for hour in (17, 18)],
    *[(hour, [0, 12, 24, 36, 48]) for hour in range(19, 23)],
    (23, [0, 15, 30, 45]),
    (0, [0, 15, 45]),
]) + clock(["01:00", "01:45", "02:30", "03:15", "04:00", "04:45", "05:30"])
NR332_KF_WEEKEND = expand([
    (6, [20, 35, 45, 55]),
    *[(hour, [5, 15, 25, 35, 45, 55]) for hour in (7, 8)],
    (9, [5, 15, 25, 35, 45]),
    *[(hour, [0, 12, 24, 36, 48]) for hour in range(10, 17)],
    (17, [0, 10, 20, 30, 40, 50]),
    (18, [0, 10, 20, 30, 38, 46, 54]),
    (19, [2, 10, 18, 26, 34, 42, 50, 58]),
    (20, [6, 14, 22, 30, 38, 46, 54]),
    (21, [2, 10, 18, 26, 34, 42, 50, 58]),
    (22, [6, 14, 22, 30, 38, 46, 54]),
    (23, [2, 15, 30, 45]),
    (0, [0, 30]),
    (1, [0, 25]),
    (2, [10, 55]),
    (3, [40]),
    (4, [25]),
    (5, [10, 55]),
])


def half_hours(start: str, end: str, star_on: int, star_note: str) -> list[dict]:
    rows = every(start, end, 30)
    for item in rows:
        if int(item["time"][3:]) == star_on:
            item["note"] = star_note
    return rows


HZMB = "途經港珠澳大橋香港口岸"

FERRY_NOTE = "來源文件為碼頭關閘時間"
SCHEDULE_NOTE = "編定班次可因交通或車務調動而調整"

ROUTES = [
    {
        "id": "ferry-central",
        "route": "中環渡輪",
        "operator": "珀麗灣客運",
        "mode": "ferry",
        "grade": "官方班表",
        "timeLabel": "表定開出",
        "effectiveDate": "2025-08-17",
        "capturedOn": "2026-11-21",
        "sourceName": "珀麗灣客運中環渡輪班表",
        "sourceUrl": "http://www.pitcl.com.hk/attachment/ferry/pdf/1755353991cflXU.pdf",
        "fareUrl": PITCL_FERRY,
        "notes": [FERRY_NOTE, SCHEDULE_NOTE],
        "directions": {
            "to-mawan": {
                "originId": "central",
                "boardStop": "中環2號碼頭",
                "destination": "珀麗灣碼頭",
                "weekday": clock(["07:00", "07:30", "07:50", "08:30", "08:50", "09:30", "10:00", "10:30", "12:30", "14:30", "16:30", "17:30", "18:00", "18:30", "19:00", "19:30", "20:00", "20:30", "21:30"]),
                "weekend": clock(["08:30", "10:30", "12:30", "14:30", "16:30", "18:30", "20:30"]),
            },
            "from-mawan": {
                "originId": "mawan",
                "boardStop": "珀麗灣碼頭",
                "destination": "中環2號碼頭",
                "weekday": clock(["06:30", "07:00", "07:20", "08:00", "08:20", "09:00", "09:30", "10:00", "12:00", "14:00", "16:00", "17:00", "17:30", "18:00", "18:30", "19:00", "19:30", "20:00", "21:00"]),
                "weekend": clock(["08:00", "10:00", "12:00", "14:00", "16:00", "18:00", "20:00"]),
            },
        },
    },
    {
        "id": "ferry-tsuen-wan",
        "route": "荃灣渡輪",
        "operator": "珀麗灣客運",
        "mode": "ferry",
        "grade": "官方班表",
        "timeLabel": "表定開出",
        "effectiveDate": "2025-08-17",
        "capturedOn": "2026-11-21",
        "sourceName": "珀麗灣客運荃灣渡輪班表",
        "sourceUrl": "http://www.pitcl.com.hk/attachment/ferry/pdf/17553540181Q6ca.pdf",
        "fareUrl": PITCL_FERRY,
        "notes": [FERRY_NOTE, SCHEDULE_NOTE],
        "directions": {
            "to-mawan": {
                "originId": "tsuen-wan",
                "boardStop": "荃灣碼頭",
                "destination": "珀麗灣碼頭",
                "weekday": clock(["08:30", "09:30", "16:30"]),
                "weekend": clock(["10:30", "13:30", "16:30"]),
            },
            "from-mawan": {
                "originId": "mawan",
                "boardStop": "珀麗灣碼頭",
                "destination": "荃灣碼頭",
                "weekday": clock(["08:10", "09:10", "16:10"]),
                "weekend": clock(["10:10", "13:10", "16:10"]),
            },
        },
    },
    {
        "id": "nr330",
        "route": "NR330",
        "operator": "珀麗灣客運",
        "mode": "bus",
        "grade": "官方班表",
        "timeLabel": "表定開出",
        "effectiveDate": "2025-04-01",
        "capturedOn": "2026-11-21",
        "sourceName": "珀麗灣客運 NR330 班表",
        "sourceUrl": "http://www.pitcl.com.hk/attachment/bus/pdf/1743472581VWL6Z.pdf",
        "fareUrl": PITCL_BUS,
        "notes": [SCHEDULE_NOTE, "往挪亞方舟的乘客在臨海廣場落車", "港鐵東涌線青衣站 C 出口轉乘，本站不顯示港鐵到站時間"],
        "directions": {
            "to-mawan": {
                "originId": "tsing-yi",
                "boardStop": "港鐵青衣站（近C出口）",
                "destination": "珀麗灣（沙灘臨海廣場）",
                "weekday": NR330_TY_WEEKDAY,
                "weekend": NR330_TY_WEEKEND,
            },
            "from-mawan": {
                "originId": "mawan",
                "boardStop": "珀麗灣",
                "destination": "港鐵青衣站",
                "weekday": NR330_PI_WEEKDAY,
                "weekend": NR330_PI_WEEKEND,
            },
        },
    },
    {
        "id": "nr332",
        "route": "NR332",
        "operator": "珀麗灣客運",
        "mode": "bus",
        "grade": "官方班表",
        "timeLabel": "表定開出",
        "effectiveDate": "2025-04-01",
        "capturedOn": "2026-11-21",
        "sourceName": "珀麗灣客運 NR332 班表",
        "sourceUrl": "http://www.pitcl.com.hk/attachment/bus/pdf/1743472662WJcLt.pdf",
        "fareUrl": PITCL_BUS,
        "notes": [SCHEDULE_NOTE, "往挪亞方舟的乘客在臨海廣場落車"],
        "directions": {
            "to-mawan": {
                "originId": "kwai-fong",
                "boardStop": "港鐵葵芳站（新都會廣場）",
                "destination": "珀麗灣（沙灘臨海廣場）",
                "weekday": NR332_KF_WEEKDAY,
                "weekend": NR332_KF_WEEKEND,
            },
            "from-mawan": {
                "originId": "mawan",
                "boardStop": "珀麗灣",
                "destination": "港鐵葵芳站",
                "weekday": NR332_PI_WEEKDAY,
                "weekend": NR332_PI_WEEKEND,
            },
        },
    },
    {
        "id": "nr334",
        "route": "NR334",
        "operator": "珀麗灣客運",
        "mode": "bus",
        "grade": "官方班表",
        "timeLabel": "表定開出",
        "effectiveDate": "2025-09-23",
        "capturedOn": "2026-11-21",
        "sourceName": "珀麗灣客運 NR334 班表",
        "sourceUrl": "http://www.pitcl.com.hk/attachment/bus/pdf/1758554831o21IM.pdf",
        "fareUrl": PITCL_BUS,
        "notes": [SCHEDULE_NOTE, "循環線，機場站開出時間僅作參考", "往挪亞方舟的乘客在臨海廣場落車", "本路線不設居民票價，二元優惠不適用"],
        "directions": {
            "to-mawan": {
                "originId": "airport",
                "boardStop": "機場二號客運大樓（旅遊車7號位）",
                "destination": "珀麗灣（沙灘臨海廣場）",
                "daily": half_hours("06:30", "00:30", 30, HZMB),
            },
            "from-mawan": {
                "originId": "mawan",
                "boardStop": "珀麗灣",
                "destination": "機場二號客運大樓（旅遊車7號位）",
                "daily": half_hours("06:00", "00:00", 0, HZMB),
            },
        },
    },
    {
        "id": "nr338",
        "route": "NR338",
        "operator": "珀麗灣客運",
        "mode": "bus",
        "grade": "官方班表",
        "timeLabel": "表定開出",
        "effectiveDate": "2025-04-01",
        "capturedOn": "2026-11-21",
        "sourceName": "珀麗灣客運 NR338 班表",
        "sourceUrl": "http://www.pitcl.com.hk/attachment/bus/pdf/1743472833DaZfv.pdf",
        "fareUrl": PITCL_BUS,
        "notes": [SCHEDULE_NOTE, "通宵班次", "往挪亞方舟的乘客在臨海廣場落車"],
        "directions": {
            "to-mawan": {
                "originId": "central",
                "boardStop": "中環（二號碼頭）",
                "destination": "珀麗灣（沙灘臨海廣場）",
                "daily": clock(["00:30", "01:40", "02:55", "04:05", "05:20", "06:35"]),
            },
            "from-mawan": {
                "originId": "mawan",
                "boardStop": "珀麗灣",
                "destination": "中環（二號碼頭）",
                "daily": clock(["23:50", "01:05", "02:20", "03:30", "04:45", "06:00"]),
            },
        },
    },
    {
        "id": "nr338s",
        "route": "NR338S",
        "operator": "珀麗灣客運",
        "mode": "bus",
        "grade": "官方班表",
        "timeLabel": "表定開出",
        "effectiveDate": "2025-09-01",
        "capturedOn": "2026-11-21",
        "sourceName": "珀麗灣客運 NR338S 班表",
        "sourceUrl": "http://www.pitcl.com.hk/attachment/bus/pdf/1777455439nJNoi.pdf",
        "fareUrl": PITCL_BUS,
        "notes": [SCHEDULE_NOTE, "經香港站（民祥街）。班表摘要行寫中環二號碼頭，站位圖及巴士頁寫近三號碼頭，上車站採用後者", "往挪亞方舟的乘客在臨海廣場落車"],
        "directions": {
            "to-mawan": {
                "originId": "central",
                "boardStop": "中環碼頭（近三號碼頭）",
                "destination": "珀麗灣（沙灘臨海廣場）",
                "weekday": clock(["08:05", "08:10", "09:05", "09:10", "11:30", "13:30", "15:30", "16:00", "17:00", "21:00", "22:30", "23:30"]),
                "weekend": clock(["09:30", "11:30", "13:30", "15:30", "17:30", "19:30", "21:30", "22:30", "23:30"]),
            },
            "from-mawan": {
                "originId": "mawan",
                "boardStop": "珀麗灣",
                "destination": "中環碼頭（近三號碼頭）",
                "weekday": clock(["07:35", "07:40", "08:35", "08:40", "11:00", "13:00", "15:00", "15:30", "16:30", "20:30", "22:00", "23:00"]),
                "weekend": clock(["09:00", "11:00", "13:00", "15:00", "17:00", "19:00", "21:00", "22:00", "23:00"]),
            },
        },
    },
    {
        "id": "nr331",
        "route": "NR331",
        "operator": "陽光巴士",
        "mode": "bus",
        "grade": "官方班表",
        "timeLabel": "表定開出",
        "effectiveDate": "2024-12-15",
        "capturedOn": "2026-11-21",
        "sourceName": "陽光巴士 NR331 班表",
        "sourceUrl": "http://sunbus.com.hk/chi/pdf/SB_BBS_331_S003.pdf",
        "fareUrl": SUNBUS,
        "notes": [SCHEDULE_NOTE, "每日服務"],
        "directions": {
            "to-mawan": {
                "originId": "tsuen-wan",
                "boardStop": "港鐵荃灣站",
                "destination": "馬灣（珀欣路）",
                "daily": every("06:20", "06:50", 30) + every("07:20", "21:20", 20) + every("21:50", "00:20", 30),
            },
            "from-mawan": {
                "originId": "mawan",
                "boardStop": "馬灣（珀欣路）",
                "destination": "港鐵荃灣站",
                "daily": every("06:00", "07:00", 30) + every("07:20", "21:00", 20) + every("21:30", "00:00", 30),
            },
        },
    },
    {
        "id": "nr331s",
        "route": "NR331S",
        "operator": "陽光巴士",
        "mode": "bus",
        "grade": "官方班表",
        "timeLabel": "表定開出",
        "effectiveDate": "2024-12-15",
        "capturedOn": "2026-11-21",
        "sourceName": "陽光巴士 NR331S 班表",
        "sourceUrl": "http://sunbus.com.hk/chi/pdf/SB_BBS_331S_S003.pdf",
        "fareUrl": SUNBUS,
        "notes": [SCHEDULE_NOTE, "每日服務", "途經基慧小學"],
        "directions": {
            "to-mawan": {
                "originId": "tsuen-wan",
                "boardStop": "港鐵荃灣西站",
                "destination": "馬灣（珀欣路）",
                "daily": every("07:10", "22:40", 30) + clock(["23:40"]),
            },
            "from-mawan": {
                "originId": "mawan",
                "boardStop": "馬灣（珀欣路）",
                "destination": "港鐵荃灣西站",
                "daily": every("06:45", "22:15", 30) + clock(["23:15"]),
            },
        },
    },
]

NOTICES = [
    {
        "id": "pitcl-ferry-20260408",
        "grade": "服務通告",
        "title": "珀麗灣渡輪服務臨時調整",
        "effectiveFrom": "2026-04-08",
        "capturedOn": "2026-11-21",
        "sourceName": "珀麗灣客運首頁通告",
        "sourceUrl": "http://www.pitcl.com.hk/tc/",
        "body": "由2026年4月8日起，平日渡輪實施臨時安排；星期六、星期日及公眾假期不受影響。中環線由珀麗灣巴士總站開出的 17:00、19:30，以及由中環二號碼頭開出的 17:30、20:00，改由 NR338S 替代。通告未公布替代巴士的新開出時間，請改看 NR338S 的表定開出時間。荃灣線取消珀麗灣開出的 08:10 及荃灣開出的 08:30，可在基慧小學乘 NR331S 往荃灣西。",
        "weekdayOnly": True,
        "suppress": [
            {"routeId": "ferry-central", "direction": "from-mawan", "times": ["17:00", "19:30"]},
            {"routeId": "ferry-central", "direction": "to-mawan", "times": ["17:30", "20:00"]},
            {"routeId": "ferry-tsuen-wan", "direction": "from-mawan", "times": ["08:10"]},
            {"routeId": "ferry-tsuen-wan", "direction": "to-mawan", "times": ["08:30"]},
        ],
    }
]

CAMERAS = [
    {"id": "TC560F", "name": "青馬大橋", "road": "青馬大橋"},
    {"id": "TC551F", "name": "汲水門橋", "road": "汲水門大橋"},
    {"id": "TC573F", "name": "青嶼幹線近收費廣場", "road": "青嶼幹線"},
    {"id": "TC302F", "name": "長青公路近金竹角", "road": "長青公路"},
]

NEWS_KEYWORDS = [
    "馬灣", "珀麗", "青嶼幹線", "青馬大橋", "汲水門大橋", "馬灣路", "北大嶼山公路",
    "長青公路", "青衣西北交匯處", "青沙公路", "西九龍公路", "紅磡海底隧道",
    "Ma Wan", "Park Island", "Lantau Link", "Tsing Ma", "Kap Shui Mun",
    "North Lantau", "Cheung Tsing", "Tsing Sha", "West Kowloon Highway",
    "Cross Harbour Tunnel",
]


@dataclass(frozen=True)
class DayKind:
    key: str
    label: str
    is_sunday: bool
    is_holiday: bool

    @property
    def table(self) -> str:
        if self.key in {"saturday", "sunday", "holiday"}:
            return "weekend"
        if self.key == "unknown":
            return "unknown"
        return "weekday"


def day_kind(day: date) -> DayKind:
    if day.weekday() == 6:
        return DayKind("sunday", "星期日", True, True)
    holidays = HOLIDAYS_BY_YEAR.get(day.year)
    if holidays is None:
        return DayKind("unknown", "假期表未涵蓋", False, False)
    if day in holidays:
        return DayKind("holiday", "公眾假期", False, True)
    if day.weekday() == 5:
        return DayKind("saturday", "星期六", False, False)
    return DayKind("weekday", "平日", False, False)


def _times_for(direction: dict, kind: DayKind) -> list[dict]:
    if "daily" in direction:
        return direction["daily"]
    table = direction.get(kind.table) or direction.get("weekday") or []
    return table


def _suppressed(route_id: str, direction: str, when: datetime, token: str) -> str | None:
    kind = day_kind(when.date())
    if kind.key != "weekday":
        return None
    for notice in NOTICES:
        if not notice.get("weekdayOnly"):
            continue
        if when.date().isoformat() < notice["effectiveFrom"]:
            continue
        for rule in notice["suppress"]:
            if rule["routeId"] == route_id and rule["direction"] == direction and token in rule["times"]:
                return notice["id"]
    return None


def upcoming(route: dict, direction_name: str, now: datetime, limit: int = 3) -> list[dict]:
    direction = route["directions"][direction_name]
    found = []
    start_day = now.date()
    for offset in range(0, 3):
        day = start_day + timedelta(days=offset)
        kind = day_kind(day)
        if kind.key == "unknown":
            continue
        for item in _times_for(direction, kind):
            hour, minute = map(int, item["time"].split(":"))
            moment = datetime(day.year, day.month, day.day, hour, minute, tzinfo=HK)
            if moment < now.replace(second=0, microsecond=0):
                continue
            if item.get("skipSundayHoliday") and (kind.is_sunday or kind.is_holiday):
                continue
            notice_id = _suppressed(route["id"], direction_name, moment, item["time"])
            if notice_id:
                continue
            found.append({
                "time": moment.isoformat(),
                "clock": item["time"],
                "note": item.get("note") or "",
                "dayLabel": kind.label,
                "grade": route["grade"],
                "timeLabel": route["timeLabel"],
            })
    found.sort(key=lambda item: item["time"])
    return found[:limit]


def service_view(route: dict, now: datetime) -> dict:
    directions = {}
    for name, direction in route["directions"].items():
        directions[name] = {
            "originId": direction["originId"],
            "boardStop": direction["boardStop"],
            "destination": direction["destination"],
            "upcoming": upcoming(route, name, now),
        }
    return {
        "id": route["id"],
        "route": route["route"],
        "operator": route["operator"],
        "mode": route["mode"],
        "grade": route["grade"],
        "timeLabel": route["timeLabel"],
        "effectiveDate": route["effectiveDate"],
        "capturedOn": route["capturedOn"],
        "sourceName": route["sourceName"],
        "sourceUrl": route["sourceUrl"],
        "fareUrl": route["fareUrl"],
        "fareText": "票價見官網",
        "notes": route["notes"],
        "directions": directions,
        "live": False,
    }


def notice_views(now: datetime) -> list[dict]:
    kind = day_kind(now.date())
    views = []
    for notice in NOTICES:
        applies = kind.key == "weekday" and now.date().isoformat() >= notice["effectiveFrom"]
        text = notice["body"]
        if kind.key == "unknown":
            text += " 假期表未涵蓋今日，這項平日調整未套用。"
        elif applies:
            text += " 今日是平日，受影響的表定班次已從下一班剔除。"
        else:
            text += " 今日不是受影響的平日，班表不套用這項調整。"
        views.append({
            "id": notice["id"],
            "grade": notice["grade"],
            "title": notice["title"],
            "body": text,
            "appliesToday": applies,
            "sourceName": notice["sourceName"],
            "sourceUrl": notice["sourceUrl"],
            "capturedOn": notice["capturedOn"],
            "effectiveFrom": notice["effectiveFrom"],
        })
    return views


def board(now: datetime | None = None) -> dict:
    now = now or datetime.now(HK)
    if now.tzinfo is None:
        now = now.replace(tzinfo=HK)
    kind = day_kind(now.date())
    gaps = [
        (now.date() + timedelta(days=offset)).isoformat()
        for offset in range(3)
        if day_kind(now.date() + timedelta(days=offset)).key == "unknown"
    ]
    return {
        "now": now.isoformat(),
        "dayLabel": kind.label,
        "calendarGaps": gaps,
        "origins": ORIGINS,
        "notices": notice_views(now),
        "services": [service_view(route, now) for route in ROUTES],
        "cameras": CAMERAS,
    }


def static_grades() -> set[str]:
    return {route["grade"] for route in ROUTES}
