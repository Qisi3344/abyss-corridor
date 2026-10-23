# 本地开发服务器：带 no-cache 头，改完代码刷新即见效。
# 用法：python serve.py [端口]   （默认 8000）
import http.server
import sys

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"serving on http://localhost:{port} (no-cache)")
    http.server.test(HandlerClass=NoCacheHandler, port=port)
