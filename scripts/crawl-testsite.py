#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
采集引擎 e2e 测试站（scripts/crawl-testsite.py）

用法:
  python scripts/crawl-testsite.py gen  --root <siteDir>     # 用 PIL 生成站点文件
  python scripts/crawl-testsite.py serve --root <siteDir> --port 8090  # 起本地服务

站点结构:
  robots.txt        禁止 /private.html
  index.html        a1..a3.png（内容图）+ icon.png(16px) + 外域图 + 链到 page2/private/locked
  page2.html        b1..b4.png + icon2.png(24px)
  private.html      c1..c3.png（robots 禁采，必须零请求）
  locked/index.html d1..d3.png（服务端对 /locked/ 下的图片回 403，验证熔断）

服务端（SimpleHTTPRequestHandler 子类）额外行为:
  * /locked/ 下的图片请求 → 403（页面 HTML 正常，只 403 图片）
  * 每个请求记一行 JSON（path/referer/ua/cookie）到 <siteDir>/.rc-requests.jsonl，
    供测试断言：诚实 UA / 带 Referer / 不带 Cookie / robots 已读取 / private 零请求
"""
import argparse
import json
import os
import sys

IMAGES = {
    # name: (w, h, rgb)
    "a1.png": (512, 384, (196, 84, 66)),
    "a2.png": (384, 512, (66, 132, 196)),
    "a3.png": (600, 400, (88, 168, 92)),
    "b1.png": (480, 480, (168, 96, 200)),
    "b2.png": (512, 320, (200, 160, 60)),
    "b3.png": (320, 512, (60, 160, 170)),
    "b4.png": (560, 420, (120, 120, 140)),
    "icon.png": (16, 16, (220, 220, 220)),
    "icon2.png": (24, 24, (230, 230, 230)),
    "c1.png": (500, 400, (90, 60, 60)),
    "c2.png": (400, 500, (60, 90, 60)),
    "c3.png": (450, 450, (60, 60, 90)),
    "d1.png": (500, 400, (150, 40, 40)),
    "d2.png": (400, 400, (40, 150, 40)),
    "d3.png": (420, 380, (40, 40, 150)),
}

PAGE = """<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{title}</title></head>
<body>
<h1>{title}</h1>
{imgs}
{links}
</body></html>
"""

IMG_TAGS = {
    # 相对地址 + data-src + srcset 混着用，全都是「页面里原样出现」的写法
    "a1.png": '<img src="a1.png" alt="a1">',
    "a2.png": '<img data-src="a2.png" alt="a2">',
    "a3.png": '<img src="a3_thumb.png" srcset="a3.png 640w" alt="a3">',
    "b1.png": '<img src="b1.png" alt="b1">',
    "b2.png": '<img src="b2.png" alt="b2">',
    "b3.png": '<img data-src="b3.png" alt="b3">',
    "b4.png": '<img src="b4.png" srcset="b4.png 560w, b4_small.png 280w" alt="b4">',
    "icon.png": '<img src="icon.png" alt="site icon">',
    "icon2.png": '<img src="icon2.png" alt="page icon">',
    "c1.png": '<img src="c1.png" alt="c1">',
    "c2.png": '<img src="c2.png" alt="c2">',
    "c3.png": '<img src="c3.png" alt="c3">',
    "d1.png": '<img src="d1.png" alt="d1">',
    "d2.png": '<img src="d2.png" alt="d2">',
    "d3.png": '<img src="d3.png" alt="d3">',
}

PAGES = {
    "index.html": {
        "title": "测试站首页",
        "imgs": ["a1.png", "a2.png", "a3.png", "icon.png"],
        "extra": '<img src="http://external.example/imgs/ext.png" alt="外域图">',
        "links": ["page2.html", "private.html", "a1.png"],
    },
    "page2.html": {
        "title": "测试站第二页",
        "imgs": ["b1.png", "b2.png", "b3.png", "b4.png", "icon2.png"],
        "extra": "",
        "links": ["index.html"],
    },
    "private.html": {
        "title": "robots 禁采页",
        "imgs": ["c1.png", "c2.png", "c3.png"],
        "extra": "",
        "links": ["index.html"],
    },
    os.path.join("locked", "index.html"): {
        "title": "403 锁定页",
        "imgs": ["d1.png", "d2.png", "d3.png"],
        "extra": "",
        "links": [],
    },
}

ROBOTS = "User-agent: *\nDisallow: /private.html\n"


def gen(root):
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        print("PIL not available", file=sys.stderr)
        return 1
    os.makedirs(root, exist_ok=True)
    os.makedirs(os.path.join(root, "locked"), exist_ok=True)
    for name, (w, h, rgb) in IMAGES.items():
        img = Image.new("RGB", (w, h), rgb)
        d = ImageDraw.Draw(img)
        d.rectangle([w // 4, h // 4, w * 3 // 4, h * 3 // 4], fill=tuple(min(255, c + 70) for c in rgb))
        img.save(os.path.join(root, name))
    # srcset 的小尺寸变体：b4_small.png（<300px，会被尺寸闸跳过——但 srcset 只挑 560w 的原样地址，
    # small 根本不该被请求；放一张在这里是为了证明「没拼接更高质量 URL、也没乱下小图」）
    img = Image.new("RGB", (280, 210), (240, 200, 120))
    img.save(os.path.join(root, "b4_small.png"))
    with open(os.path.join(root, "robots.txt"), "w", encoding="utf-8") as f:
        f.write(ROBOTS)
    for rel, spec in PAGES.items():
        imgs = "\n".join(IMG_TAGS[n] for n in spec["imgs"])
        links = "\n".join(f'<a href="{h}">{h}</a>' for h in spec["links"])
        html = PAGE.format(title=spec["title"], imgs=imgs + spec["extra"], links=links)
        with open(os.path.join(root, rel), "w", encoding="utf-8") as f:
            f.write(html)
    print("site generated at", root)
    return 0


def serve(root, port, host="127.0.0.1"):
    import functools
    from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

    root = os.path.abspath(root)
    log_path = os.path.join(root, ".rc-requests.jsonl")
    IMAGE_RE = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif")

    class Handler(SimpleHTTPRequestHandler):
        def do_GET(self):
            p = self.path.split("?")[0]
            if p.startswith("/locked/") and p.lower().endswith(IMAGE_RE):
                self.send_error(403, "Locked for test")
                return
            super().do_GET()

        def end_headers(self):
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

        def log_message(self, fmt, *args):
            # 每个请求记一行 JSON，测试据此断言合规护栏
            try:
                rec = {
                    "path": self.path.split("?")[0],
                    "referer": self.headers.get("Referer"),
                    "ua": self.headers.get("User-Agent"),
                    "cookie": self.headers.get("Cookie"),
                    "status": 403 if (self.path.split("?")[0].startswith("/locked/") and self.path.lower().endswith(IMAGE_RE)) else 200,
                }
                with open(log_path, "a", encoding="utf-8") as f:
                    f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            except Exception:
                pass

    # directory=root：让服务进程不用 chdir 也能对准站点目录
    srv = ThreadingHTTPServer((host, port), functools.partial(Handler, directory=root))
    print(f"serving {root} at http://{host}:{port}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("gen")
    g.add_argument("--root", required=True)
    s = sub.add_parser("serve")
    s.add_argument("--root", required=True)
    s.add_argument("--port", type=int, default=8090)
    args = ap.parse_args()
    if args.cmd == "gen":
        sys.exit(gen(args.root))
    sys.exit(serve(args.root, args.port))


if __name__ == "__main__":
    main()
