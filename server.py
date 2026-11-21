"""本站伺服器。瀏覽器只向這裡取資料。"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

import catalog
import live

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
HOST = "127.0.0.1"
PORT = 8080


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        path = unquote(urlparse(self.path).path)
        started = __import__("time").perf_counter()
        try:
            if path == "/api/board":
                payload = catalog.board()
                payload["live"] = live.LIVE.snapshot()
                body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
                self._send(200, "application/json; charset=utf-8", body, "no-store")
            elif path.startswith("/cameras/") and path.endswith(".jpg"):
                camera_id = path.removeprefix("/cameras/").removesuffix(".jpg")
                try:
                    image, content_type, meta = live.LIVE.cameras.get(camera_id)
                except KeyError:
                    self._send(404, "text/plain; charset=utf-8", "找不到鏡頭".encode(), "no-store")
                    return
                if not image:
                    self._send(204, "text/plain; charset=utf-8", b"", "no-store")
                    return
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(image)))
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Camera-Status", meta["status"])
                self.end_headers()
                self.wfile.write(image)
            else:
                self._static(path)
        finally:
            elapsed = int((__import__("time").perf_counter() - started) * 1000)
            print(f"{self.command} {path} {getattr(self, '_status', '-')} {elapsed}ms", flush=True)

    def _static(self, path: str):
        relative = "index.html" if path in {"", "/"} else path.lstrip("/")
        file_path = (STATIC / relative).resolve()
        if not str(file_path).startswith(str(STATIC.resolve())) or not file_path.is_file():
            self._send(404, "text/plain; charset=utf-8", "找不到頁面".encode(), "no-store")
            return
        kind = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
        }.get(file_path.suffix, "application/octet-stream")
        self._send(200, kind, file_path.read_bytes(), "no-cache")

    def _send(self, status: int, content_type: str, body: bytes, cache: str):
        self._status = status
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.end_headers()
        if body:
            self.wfile.write(body)

    def log_message(self, fmt: str, *args):
        return


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"http://{HOST}:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
