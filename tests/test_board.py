import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

import catalog
import live

HK = ZoneInfo("Asia/Hong_Kong")


def at(text: str) -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=HK)


def route(route_id: str) -> dict:
    return next(item for item in catalog.ROUTES if item["id"] == route_id)


class ScheduleTests(unittest.TestCase):
    def test_static_rows_are_not_realtime(self):
        self.assertEqual(catalog.static_grades(), {"官方班表"})

    def test_saturday_central_ferry_keeps_1600(self):
        times = catalog.upcoming(route("ferry-central"), "from-mawan", at("2026-11-21T15:28:00"))
        self.assertEqual(times[0]["clock"], "16:00")
        self.assertEqual(times[0]["grade"], "官方班表")
        self.assertFalse(catalog.notice_views(at("2026-11-21T15:28:00"))[0]["appliesToday"])

    def test_weekday_central_ferry_skips_cancelled_sailings(self):
        times = catalog.upcoming(route("ferry-central"), "from-mawan", at("2026-11-25T16:01:00"))
        clocks = [item["clock"] for item in times]
        self.assertEqual(clocks[0], "17:30")
        self.assertNotIn("17:00", clocks)
        self.assertNotIn("19:30", clocks)
        self.assertTrue(catalog.notice_views(at("2026-11-25T16:01:00"))[0]["appliesToday"])

    def test_weekday_tsuen_wan_ferry_skips_0830(self):
        times = catalog.upcoming(route("ferry-tsuen-wan"), "to-mawan", at("2026-11-25T08:00:00"))
        self.assertEqual([item["clock"] for item in times[:2]], ["09:30", "16:30"])
        self.assertNotIn("08:30", [item["clock"] for item in times])

    def test_public_holiday_monday_uses_weekend_table(self):
        times = catalog.upcoming(route("ferry-central"), "to-mawan", at("2026-04-06T16:00:00"))
        self.assertEqual(times[0]["clock"], "16:30")
        self.assertFalse(catalog.notice_views(at("2026-04-06T16:00:00"))[0]["appliesToday"])

    def test_saturday_keeps_starred_nr330_unless_it_is_a_holiday(self):
        saturday = catalog.upcoming(route("nr330"), "from-mawan", at("2026-11-21T07:32:00"))
        holiday_saturday = catalog.upcoming(route("nr330"), "from-mawan", at("2026-04-04T07:32:00"))
        sunday = catalog.upcoming(route("nr330"), "from-mawan", at("2026-11-22T07:32:00"))
        self.assertEqual(saturday[0]["clock"], "07:35")
        self.assertEqual(holiday_saturday[0]["clock"], "07:40")
        self.assertEqual(sunday[0]["clock"], "07:40")

    def test_nr331s_keeps_the_last_hour_gap(self):
        times = catalog.upcoming(route("nr331s"), "to-mawan", at("2026-11-21T22:40:00"))
        self.assertEqual([item["clock"] for item in times[:2]], ["22:40", "23:40"])

    def test_overnight_trips_follow_the_clock(self):
        afternoon = catalog.upcoming(route("nr338"), "from-mawan", at("2026-11-21T15:37:00"))
        late = catalog.upcoming(route("nr338"), "from-mawan", at("2026-11-21T23:55:00"))
        self.assertEqual([item["clock"] for item in afternoon], ["23:50", "01:05", "02:20"])
        self.assertEqual(late[0]["clock"], "01:05")
        self.assertEqual(late[0]["dayLabel"], "星期日")

    def test_current_minute_still_counts(self):
        times = catalog.upcoming(route("ferry-central"), "from-mawan", at("2026-11-21T16:00:40"))
        self.assertEqual(times[0]["clock"], "16:00")

    def test_tsing_yi_towards_mawan_is_only_nr330(self):
        payload = catalog.board(at("2026-11-21T12:00:00"))
        matches = []
        for service in payload["services"]:
            direction = service["directions"]["to-mawan"]
            if direction["originId"] == "tsing-yi":
                matches.append(service["route"])
        self.assertEqual(matches, ["NR330"])


class LiveParseTests(unittest.TestCase):
    def test_timeout_with_no_previous_value_is_stale(self):
        slot = live.Slot(60)

        def boom():
            raise TimeoutError("upstream")

        packed = slot.read(boom)
        self.assertEqual(packed["status"], "暫時未能更新")
        self.assertIsNone(packed["value"])
        self.assertTrue(packed["stale"])

    def test_speed_parser_picks_named_detectors_only(self):
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
        self.assertEqual(parsed["roads"], [{
            "road": "北大嶼山公路",
            "detector": "北大嶼山公路近欣澳 西行",
            "speed": 90,
            "unit": "公里/小時",
        }])
        self.assertIn("青馬大橋", parsed["omitted"])

    def test_journey_parser_keeps_k07_airport_only(self):
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
        parsed = live.parse_journey(xml)
        self.assertEqual(parsed["rows"], [{
            "from": "西九龍公路西行近港鐵南昌站",
            "to": "機場經三號幹線",
            "minutes": "21",
        }])

    def test_tai_po_golf_club_is_not_the_ma_wan_corridor(self):
        self.assertFalse(live.corridor_match("大埔珀麗高爾夫球會附近封路"))
        self.assertTrue(live.corridor_match("珀麗灣碼頭附近有交通意外"))
        self.assertTrue(live.corridor_match("青馬大橋實施強風管制"))

    def test_cancelled_weather_warning_stays_off_the_card(self):
        parsed = live.parse_weather({
            "WTCSGNL": {"name": "三號強風信號", "code": "TC3", "actionCode": "CANCEL", "issueTime": "2026-11-21T12:00:00+08:00"},
            "WTS": {"name": "雷暴警告", "code": "WTS", "actionCode": "ISSUE", "issueTime": "2026-11-21T13:00:00+08:00"},
            "WFIRE": {"name": "紅色火災危險警告", "code": "WFIRER", "actionCode": "ISSUE"},
        })
        self.assertEqual([item["code"] for item in parsed["warnings"]], ["WTS"])
        self.assertIsNotNone(parsed["wind"])


if __name__ == "__main__":
    unittest.main()
