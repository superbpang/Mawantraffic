import { atHk, board } from "../src/board.js";

const [date, time] = process.argv[2].split("T");
const [year, month, day] = date.split("-").map(Number);
const [hour, minute, second = 0] = time.split(":").map(Number);
process.stdout.write(JSON.stringify(board(atHk(year, month, day, hour, minute, second))));
