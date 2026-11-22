import appJs from "../static/app.js" with { type: "text" };
import indexHtml from "../static/index.html" with { type: "text" };
import stylesCss from "../static/styles.css" with { type: "text" };
import { board } from "./board.js";
import { cameraFrame, snapshot } from "./live.js";

// 有 Workers 靜態資源時，這三個路徑由資源層回應。沒有資源層時，由這個模組送出同一份頁面。
const STATIC_FILES = new Map([
  ["/", { body: indexHtml, type: "text/html; charset=utf-8" }],
  ["/index.html", { body: indexHtml, type: "text/html; charset=utf-8" }],
  ["/styles.css", { body: stylesCss, type: "text/css; charset=utf-8" }],
  ["/app.js", { body: appJs, type: "text/javascript; charset=utf-8" }],
]);

function plain(body, status) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export default {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    try {
      if (path === "/api/board") {
        const payload = board(new Date());
        payload.live = await snapshot();
        return new Response(JSON.stringify(payload), {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      }
      if (path.startsWith("/cameras/") && path.endsWith(".jpg")) {
        const cameraId = decodeURIComponent(path.slice("/cameras/".length, -4));
        try {
          const frame = await cameraFrame(cameraId);
          if (!frame.body || frame.body.length === 0) {
            return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
          }
          return new Response(frame.body, {
            headers: {
              "content-type": "image/jpeg",
              "cache-control": "no-store",
              "x-camera-status": frame.meta.status,
            },
          });
        } catch (error) {
          if (error?.name === "KeyError") return plain("找不到鏡頭", 404);
          throw error;
        }
      }
    } catch {
      return plain("暫時未能更新", 500);
    }
    const file = STATIC_FILES.get(path);
    if (file) {
      return new Response(file.body, {
        headers: {
          "content-type": file.type,
          "cache-control": "no-cache",
        },
      });
    }
    return plain("找不到頁面", 404);
  },
};
