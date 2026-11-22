import fs from "node:fs";

import {
  corridorMatch,
  describeCamera,
  markKmbFreshness,
  parseJourney,
  parseSpeeds,
  parseWeather,
  snapshotKind,
} from "../src/live.js";

const mode = process.argv[2];
const extra = process.argv[3];
const input = fs.readFileSync(0);

function emit(value) {
  process.stdout.write(JSON.stringify(value));
}

if (mode === "speeds") emit(parseSpeeds(input, JSON.parse(extra)));
else if (mode === "journey") emit(parseJourney(input));
else if (mode === "weather") emit(parseWeather(JSON.parse(new TextDecoder().decode(input))));
else if (mode === "corridor") emit(corridorMatch(new TextDecoder().decode(input)));
else if (mode === "kind") emit(snapshotKind(input));
else if (mode === "kmb") emit(markKmbFreshness(JSON.parse(extra).slot, new Date(JSON.parse(extra).now)));
else if (mode === "camera") emit(describeCamera(null, input));
else throw new Error(`未知模式 ${mode}`);
