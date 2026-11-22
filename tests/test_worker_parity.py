"""Workers 的班表和解析必須跟 catalog.py、live.py 相同。"""

import importlib.util
import json
import subprocess
import unittest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import catalog
import live

HK = ZoneInfo("Asia/Hong_Kong")


def at(text: str) -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=HK)

ROOT = Path(__file__).resolve().parents[1]
MOMENTS = [
    "2026-11-21T15:28:00",
    "2026-11-25T16:01:00",
    "2026-11-25T08:00:00",
    "2026-04-06T16:00:00",
    "2026-11-21T07:32:00",
    "2026-04-04T07:32:00",
    "2026-11-22T07:32:00",
    "2026-11-22T00:20:00",
    "2026-11-21T22:40:00",
    "2026-11-21T15:37:00",
    "2026-11-21T23:55:00",
    "2026-11-21T16:00:40",
    "2027-01-01T08:01:00",
    "2027-02-06T07:32:00",
    "2028-01-03T08:01:00",
    "2026-11-21T12:00:00",
]


def node(script, *args, stdin=b""):
    return json.loads(subprocess.check_output(
        ["node", str(ROOT / "tests" / script), *args],
        input=stdin,
        cwd=ROOT,
    ))


def export_module():
    path = ROOT / "scripts" / "export_schedule.py"
    spec = importlib.util.spec_from_file_location("export_schedule", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class WorkerParityTests(unittest.TestCase):
    def test_exported_schedule_matches_catalog(self):
        saved = json.loads((ROOT / "src" / "schedule.json").read_text(encoding="utf-8"))
        fresh = json.loads(json.dumps(export_module().payload(), ensure_ascii=False))
        self.assertEqual(saved, fresh)

    def test_worker_board_matches_catalog(self):
        for moment in MOMENTS:
            with self.subTest(moment=moment):
                self.assertEqual(node("worker_board.mjs", moment), catalog.board(at(moment)))

    def test_worker_speed_parser_matches(self):
        xml = """
        <raw_speed_volume_list>
          <date>2026-11-21</date>
          <periods><period>
            <period_from>15:04:00</period_from><period_to>15:04:30</period_to>
            <detectors>
              <detector><detector_id>AID08101</detector_id><lanes>
                <lane><speed>40</speed><valid>Y</valid></lane>
                <lane><speed>80</speed><valid>Y</valid></lane>
                <lane><speed>10</speed><valid>N</valid></lane>
              </lanes></detector>
              <detector><detector_id>AID08102</detector_id><lanes>
                <lane><speed>90</speed><valid>Y</valid></lane>
              </lanes></detector>
              <detector><detector_id>AID99999</detector_id><lanes>
                <lane><speed>5</speed><valid>Y</valid></lane>
              </lanes></detector>
            </detectors>
          </period></periods>
        </raw_speed_volume_list>
        """.encode()
        detectors = [
            {"id": "AID08101", "name": "北大嶼山公路近欣澳灣 西行", "group": "nlh", "latitude": 22.30, "longitude": 114.02},
            {"id": "AID08102", "name": "北大嶼山公路近欣澳 西行", "group": "nlh", "latitude": 22.30, "longitude": 114.08},
        ]
        parsed = live.parse_speeds(xml, detectors)
        self.assertEqual(node("worker_parse.mjs", "speeds", json.dumps(detectors), stdin=xml), parsed)

    def test_worker_journey_parser_matches(self):
        xml = """
        <jtis_journey_list xmlns="http://data.one.gov.hk/td">
          <jtis_journey_time>
            <LOCATION_ID>K07</LOCATION_ID><DESTINATION_ID>ACTT</DESTINATION_ID>
            <CAPTURE_DATE>2026-11-21T15:11:00</CAPTURE_DATE>
            <JOURNEY_TYPE>1</JOURNEY_TYPE><JOURNEY_DATA>21</JOURNEY_DATA>
          </jtis_journey_time>
          <jtis_journey_time>
            <LOCATION_ID>K07</LOCATION_ID><DESTINATION_ID>CH</DESTINATION_ID>
            <JOURNEY_TYPE>1</JOURNEY_TYPE><JOURNEY_DATA>9</JOURNEY_DATA>
          </jtis_journey_time>
          <jtis_journey_time>
            <LOCATION_ID>N06</LOCATION_ID><DESTINATION_ID>ATSCA</DESTINATION_ID>
            <JOURNEY_TYPE>1</JOURNEY_TYPE><JOURNEY_DATA>5</JOURNEY_DATA>
          </jtis_journey_time>
        </jtis_journey_list>
        """.encode()
        self.assertEqual(node("worker_parse.mjs", "journey", stdin=xml), live.parse_journey(xml))

    def test_worker_weather_and_corridor_match(self):
        payload = {
            "WTCSGNL": {"name": "三號強風信號", "code": "TC3", "actionCode": "CANCEL", "issueTime": "2026-11-21T12:00:00+08:00"},
            "WTS": {"name": "雷暴警告", "code": "WTS", "actionCode": "ISSUE", "issueTime": "2026-11-21T13:00:00+08:00"},
            "WFIRE": {"name": "紅色火災危險警告", "code": "WFIRER", "actionCode": "ISSUE"},
        }
        self.assertEqual(
            node("worker_parse.mjs", "weather", stdin=json.dumps(payload).encode()),
            live.parse_weather(payload),
        )
        for text in ("大埔珀麗高爾夫球會附近封路", "珀麗灣碼頭附近有交通意外", "青馬大橋實施強風管制"):
            self.assertEqual(node("worker_parse.mjs", "corridor", stdin=text.encode()), live.corridor_match(text))

    def test_worker_kmb_freshness_matches(self):
        slot = {
            "value": {"dataTime": "2026-11-21T12:00:00+08:00", "sourceStale": False},
            "stale": False,
            "status": "已更新",
            "fetchedAt": "2026-11-21T12:01:55+08:00",
        }
        moment = "2026-11-21T12:02:45+08:00"
        live.mark_kmb_freshness(slot, at("2026-11-21T12:02:45"))
        worker_slot = {
            "value": {"dataTime": "2026-11-21T12:00:00+08:00", "sourceStale": False},
            "stale": False,
            "status": "已更新",
            "fetchedAt": "2026-11-21T12:01:55+08:00",
        }
        self.assertEqual(
            node("worker_parse.mjs", "kmb", json.dumps({"slot": worker_slot, "now": moment})),
            slot,
        )

    def test_worker_camera_kind_matches(self):
        gif = b"GIF89a" + b"\x00" * 16
        jpeg = b"\xff\xd8\xff" + b"\x00" * 16
        self.assertEqual(node("worker_parse.mjs", "kind", stdin=gif), live.snapshot_kind(gif))
        self.assertEqual(node("worker_parse.mjs", "kind", stdin=jpeg), live.snapshot_kind(jpeg))
        gif_view = node("worker_parse.mjs", "camera", stdin=gif)
        jpeg_view = node("worker_parse.mjs", "camera", stdin=jpeg)
        self.assertEqual(gif_view, {"status": "no-service", "message": "運輸署暫時未能提供服務", "hasBody": False})
        self.assertEqual(jpeg_view["status"], "ok")
        self.assertEqual(jpeg_view["message"], "")
        self.assertTrue(jpeg_view["hasBody"])


if __name__ == "__main__":
    unittest.main()
