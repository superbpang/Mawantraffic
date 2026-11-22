"""把 catalog.py 的班表寫成 Workers 用的 JSON。班次規則仍以 catalog.py 為準。"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import catalog

TARGET = ROOT / "src" / "schedule.json"


def payload() -> dict:
    return {
        "holidays": {
            str(year): sorted(day.isoformat() for day in days)
            for year, days in catalog.HOLIDAYS_BY_YEAR.items()
        },
        "origins": catalog.ORIGINS,
        "routes": catalog.ROUTES,
        "notices": catalog.NOTICES,
        "cameras": catalog.CAMERAS,
        "newsKeywords": catalog.NEWS_KEYWORDS,
    }


def main() -> None:
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(
        json.dumps(payload(), ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(TARGET)


if __name__ == "__main__":
    main()
