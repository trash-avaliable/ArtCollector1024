# -*- coding: utf-8 -*-
"""
CLIP 分类基准集生成器：10 个可视分类 × 10 张 = 100 张 512×512 合成图。
用法：python scripts/clip-benchmark-gen.py [输出目录]（默认 <仓库>/../.rc-clip-bench）

设计原则：
- 每个分类的图都对齐该分类在真实库里的语义（线条练习=抽象笔触练习，人体结构=身体部位，
  场景与背景=满版风景……），类内做布局/配色变化，类间保持可区分。
- 「待分类」不生成：它是收件箱兜底而不是视觉类别，但仍是分类候选之一（判进去算错）。
"""
import math
import os
import random
import sys
from PIL import Image, ImageDraw, ImageFont

W = H = 512
CATS = [
    "人体结构", "动态与透视", "线条练习", "色彩与光影", "美术风格",
    "教程与拆解", "服饰与道具", "场景与背景", "表情与情绪", "灵感碎片",
]
N_PER = 10


def font(size):
    for p in ("C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/arialbd.ttf"):
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            pass
    return ImageFont.load_default()


def outline_shape(d, shapes, fill="#ffffff", stroke="#111111", inset=9):
    """双层法描轮廓：先画整组形状的外扩层，再画内缩层，得到统一粗细的描边"""
    for fn in shapes:
        fn(d, 0, stroke)
    for fn in shapes:
        fn(d, inset, fill)


def rr(d, box, rad, inset, fill):
    # box 已由调用方按 inset 收缩过，这里不再重复收缩（否则小尺寸会算出负宽高）
    d.rounded_rectangle([box[0], box[1], box[2], box[3]], radius=max(2, min(rad, (box[2] - box[0]) // 2, (box[3] - box[1]) // 2)), fill=fill)


# ---------------- 人体结构：手 / 足 / 眼 / 颅 / 耳 线稿 ----------------

def hand_v2(size=512):
    """成熟的五指手线稿（与冒烟测试图 h1.png 同源）：四指胶囊 + 掌 + 拇指，双层描边"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def shapes(dw, ins, f):
        for (x0, y0, x1, y1) in [(200, 92, 252, 250), (254, 62, 306, 250), (308, 86, 360, 250), (362, 130, 410, 252)]:
            dw.rounded_rectangle([x0 + ins, y0 + ins, x1 - ins, y1 + 40 - ins], radius=max(4, 18 - ins), fill=f)
        dw.rounded_rectangle([190 + ins, 210 + ins, 416 - ins, 402 - ins], radius=max(4, 18 - ins), fill=f)
        dw.line([(214, 330), (108, 268)], fill=f, width=64 - ins * 2)
        dw.ellipse([108 - (32 - ins), 268 - (32 - ins), 108 + (32 - ins), 268 + (32 - ins)], fill=f)

    shapes(d, 0, "#111111")
    shapes(d, 9, "#ffffff")
    for x in (253, 307, 361):  # 指缝
        d.line([(x, 176), (x, 236)], fill="#111111", width=5)
    d.line([(214, 330), (108, 268)], fill="#111111", width=8)
    d.line([(258, 402), (252, 452)], fill="#111111", width=6)  # 手腕
    d.line([(340, 402), (348, 452)], fill="#111111", width=6)
    return img


def paste_hand(base, ox, oy, s=1.0, rot=0):
    h = hand_v2()
    if s != 1.0:
        h = h.resize((max(1, int(512 * s)), max(1, int(512 * s))), Image.LANCZOS)
    if rot:
        h = h.rotate(rot, resample=Image.BICUBIC, expand=True)
    base.alpha_composite(h, (int(ox), int(oy)))


def gen_anatomy(i):
    img = Image.new("RGBA", (W, H), "#ffffff")
    d = ImageDraw.Draw(img)
    kind = i % 5
    if kind == 0 or kind == 1:  # 手：整幅居中，微调大小与旋转
        paste_hand(img, 0, 0, s=0.98 + 0.02 * (i % 3), rot=(10 if kind else 0))
    elif kind == 2:  # 小号手（偏左上，模拟手部特写参考）
        paste_hand(img, 24 + (i % 3) * 16, 40 + (i % 4) * 18, s=0.68, rot=-8)
    else:  # 躯干解剖：胸腔肋骨 + 骨盆，明确的人体结构研究
        d.rounded_rectangle([170, 110, 350, 300], radius=60, outline="#111111", width=8, fill="#ffffff")
        d.line([(260, 120), (260, 300)], fill="#111111", width=6)  # 胸骨
        for k in range(6):  # 肋骨
            y0 = 148 + k * 26
            d.arc([176, y0, 346, y0 + 40], 15, 165, fill="#111111", width=5)
        d.polygon([(180, 330), (340, 330), (310, 412), (210, 412)], outline="#111111", width=7)  # 骨盆
        d.ellipse([236, 340, 284, 396], outline="#111111", width=5)
    return img.convert("RGB")


# ---------------- 动态与透视：奔跑剪影 / 透视网格 ----------------

def gen_dynamic(i):
    img = Image.new("RGB", (W, H), "#fbfaf7")
    d = ImageDraw.Draw(img)
    if i % 2 == 0:  # 奔跑剪影 + 速度线（更大更粗更有冲劲）
        cx, cy, s = 250 + (i % 5) * 12, 250 + (i % 3) * 12, 1.25 + 0.12 * (i % 4)
        col = "#2f333b"
        d.ellipse([cx - 26 * s, cy - 150 * s, cx + 26 * s, cy - 100 * s], fill=col)
        d.line([(cx, cy - 104 * s), (cx + 12 * s, cy - 16 * s)], fill=col, width=int(34 * s))
        d.line([(cx + 6 * s, cy - 90 * s), (cx - 100 * s, cy - 44 * s)], fill=col, width=int(20 * s))   # 后臂
        d.line([(cx + 8 * s, cy - 86 * s), (cx + 108 * s, cy - 126 * s)], fill=col, width=int(20 * s))  # 前臂
        d.line([(cx + 12 * s, cy - 20 * s), (cx - 80 * s, cy + 26 * s)], fill=col, width=int(26 * s))
        d.line([(cx - 80 * s, cy + 26 * s), (cx - 126 * s, cy + 108 * s)], fill=col, width=int(20 * s))
        d.line([(cx + 12 * s, cy - 20 * s), (cx + 94 * s, cy + 38 * s)], fill=col, width=int(26 * s))
        d.line([(cx + 94 * s, cy + 38 * s), (cx + 142 * s, cy + 118 * s)], fill=col, width=int(20 * s))
        for k in range(3):  # 速度线 + 运动弧
            d.line([(cx - 236 * s, cy - 120 * s + k * 52), (cx - 130 * s, cy - 120 * s + k * 52)], fill="#8a9098", width=9)
        d.arc([cx - 150 * s, cy + 90 * s, cx + 60 * s, cy + 170 * s], 190, 330, fill="#b3b9c0", width=6)
    else:  # 一点透视：消失点 + 彩色地面格 + 进深方块
        vpx, vpy = 256 + (i % 3) * 30, 190 + (i % 4) * 22
        d.rectangle([0, vpy, W, H], fill="#e8e2d4")   # 地面色块
        d.rectangle([0, 0, W, vpy], fill="#dfe8f0")   # 天空色块
        d.line([(0, vpy), (W, vpy)], fill="#20242c", width=5)
        for k in range(-6, 7):  # 收敛射线
            d.line([(vpx, vpy), (k * 110, H)], fill="#5b6472", width=3)
        for t in (0.28, 0.52, 0.78):  # 进深横线
            y = vpy + (H - vpy) * t
            d.line([(0, y), (W, y)], fill="#5b6472", width=3)
        for k, t in [(1, 0.1), (2, 0.32), (-2, 0.2)]:  # 透视方块
            y0 = vpy + (H - vpy) * t
            half = 60 + 90 * t
            d.polygon([(vpx + k * 55 - 30, y0 - 8), (vpx + k * 55 + 30, y0 - 8),
                       (vpx + k * 55 + half, min(H, y0 + 80 * (0.5 + t))), (vpx + k * 55 - half, min(H, y0 + 80 * (0.5 + t)))],
                      fill="#a8785a", outline="#20242c")
        d.ellipse([vpx - 8, vpy - 8, vpx + 8, vpy + 8], fill="#c8392f")
    return img


# ---------------- 线条练习：纯抽象笔触，不带可辨识物体 ----------------

def gen_lines(i):
    img = Image.new("RGB", (W, H), "#fdfdfb")
    d = ImageDraw.Draw(img)
    ink = ["#4a4a4a", "#565656", "#3d3d3d"][i % 3]
    mode = i % 5
    if mode == 0:  # 成排斜排线块
        for b in range(4):
            x0 = 60 + b * 105
            for k in range(16):
                d.line([(x0 + k * 6, 70), (x0 - 24 + k * 6, 210)], fill=ink, width=3)
        for b in range(4):
            x0 = 60 + b * 105
            for k in range(16):
                d.line([(x0 + k * 6, 300), (x0 + 30 + k * 6, 450)], fill=ink, width=3)
    elif mode == 1:  # 波浪 / 之字
        for r in range(6):
            y0 = 60 + r * 70
            pts = [(x, y0 + (14 if (x // 26) % 2 else -14)) for x in range(40, 480, 26)]
            d.line(pts, fill=ink, width=4, joint="curve")
    elif mode == 2:  # 螺旋
        for c, (ccx, ccy) in enumerate([(150, 150), (370, 150), (150, 380), (370, 380)]):
            pts = []
            for t in range(0, 340, 4):
                r0 = 4 + t * 0.28
                a = math.radians(t + c * 30)
                pts.append((ccx + r0 * math.cos(a), ccy + r0 * math.sin(a)))
            d.line(pts, fill=ink, width=4, joint="curve")
    elif mode == 3:  # 交叉排线补块
        boxes = [(50, 60, 240, 230), (270, 60, 460, 230), (50, 290, 240, 460), (270, 290, 460, 460)]
        for bi, (x0, y0, x1, y1) in enumerate(boxes):
            for k in range(-20, 220, 14):
                d.line([(x0 + k, y0), (x0 + k - 170, y1)], fill=ink, width=3)
                d.line([(x0 + k, y1), (x0 + k + 170, y0)], fill=ink, width=3)
    else:  # 散乱涂鸦（勾/弧/钩随机散布，刻意不成网格）
        rnd = random.Random(7 + i)
        for k in range(26):
            ccx, ccy = rnd.randint(60, W - 60), rnd.randint(60, H - 60)
            kind2 = rnd.randint(0, 2)
            if kind2 == 0:  # 短排线簇
                ang = rnd.randint(-40, 40)
                for m in range(6):
                    x0 = ccx + m * 9
                    d.line([(x0, ccy - 30), (x0 - 18 + ang, ccy + 30)], fill=ink, width=3)
            elif kind2 == 1:  # 锯齿
                pts = [(ccx + m * 12, ccy + (14 if (m % 2) else -14)) for m in range(-5, 6)]
                d.line(pts, fill=ink, width=4, joint="curve")
            else:  # 十字交叉排线
                for m in range(-3, 4):
                    d.line([(ccx + m * 10, ccy - 26), (ccx + m * 10 + 44, ccy + 26)], fill=ink, width=3)
                    d.line([(ccx + m * 10, ccy + 26), (ccx + m * 10 + 44, ccy - 26)], fill=ink, width=3)
    return img


# ---------------- 色彩与光影：色卡 / 球体光影 / 明度条 ----------------

PALS = [
    ["#e63946", "#f4a261", "#e9c46a", "#2a9d8f", "#264653"],
    ["#8ecae6", "#219ebc", "#023047", "#ffb703", "#fb8500"],
    ["#cdb4db", "#ffc8dd", "#bde0fe", "#a2d2ff", "#ffffff"],
    ["#606c38", "#283618", "#fefae0", "#dda15e", "#bc6c25"],
    ["#22223b", "#4a4e69", "#9a8c98", "#c9ada7", "#f2e9e4"],
]


def gen_color(i):
    img = Image.new("RGB", (W, H), "#ffffff")
    d = ImageDraw.Draw(img)
    mode = i % 5
    if mode < 3:  # 色卡行
        pal = PALS[i % len(PALS)]
        rows = 2 + i % 2
        n = len(pal)
        for r in range(rows):
            for c in range(n):
                x0 = 46 + c * ((W - 92) // n)
                y0 = 120 + r * 150 + (i % 3) * 30
                col = pal[(c + r) % n]
                d.rounded_rectangle([x0, y0, x0 + (W - 92) // n - 18, y0 + 110], radius=8, fill=col, outline="#22252b", width=3)
    elif mode == 3:  # 球体光影 + 同色系明度阶梯（经典 shading study 版式）
        cx, cy, R = 256, 190, 118
        d.ellipse([cx - 170, cy + 104, cx + 170, cy + 156], fill="#c9d2d8")  # 投影
        for k in range(16):  # 同心圆近似：受光面 → 暗面
            t = k / 15
            col = _lerp3((252, 240, 214), (140, 84, 44), t)
            rx = R * (1 - 0.055 * k)
            off = int(R * 0.5 * (1 - t))
            d.ellipse([cx - rx - off * 0.45, cy - rx + off * 0.25, cx + rx - off * 0.45, cy + rx + off * 0.25], fill=col)
        d.ellipse([cx - 74 - 36, cy - 78 - 20, cx - 74 + 36, cy - 78 + 20], fill="#ffffff")  # 高光
        steps = ["#f2e2c4", "#e0c49a", "#c49a6a", "#9a6a44", "#6a4428"]
        for c, col in enumerate(steps):  # 同色明度阶梯
            x0 = 60 + c * ((W - 120) // len(steps))
            d.rectangle([x0, 360, x0 + (W - 120) // len(steps) - 12, 452], fill=col, outline="#22252b", width=3)
    else:  # 彩虹渐变色条：离散色块，强调"颜色"本身
        strips = [["#e63946", "#f4a261", "#e9c46a", "#8ab84a", "#2a9d8f", "#457b9d", "#5a4a8a"],
                  ["#5a4a8a", "#457b9d", "#3a9aa8", "#7ab86a", "#e9c46a", "#f08a4a", "#d84a5a"]]
        for r, cols in enumerate(strips):
            for c, col in enumerate(cols):
                x0 = 34 + c * ((W - 68) // len(cols))
                y0 = 150 + r * 150 + (i % 2) * 24
                d.rectangle([x0, y0, x0 + (W - 68) // len(cols) - 10, y0 + 118], fill=col, outline="#22252b", width=3)
    return img


def _lerp3(a, b, t):
    return tuple(int(a[k] + (b[k] - a[k]) * t) for k in range(3))


# ---------------- 美术风格：像素画 ----------------

PIX = {
    "heart": ["..RR..RR..", "RRRRRRRRR.", "RRRRRRRRR.", "RRRRRRRRR.", ".RRRRRRR..", "..RRRRR...", "...RRR....", "....R....."],
    "sword": [".....W....", "....WWW...", "...WWW....", "..WWW.....", ".WWW......", "BB........", "HBB.......", "HH........"],
    "ghost": ["...GGGG...", "..GGGGGG..", ".GGGGGGGG.", ".GGKGGKGG.", ".GGKGGKGG.", ".GGGGGGGG.", ".G.GG.GG..", "G..GG..G.."],
    "star": ["....YY....", "....YY....", "...YYYY...", "YYYYYYYYYY", ".YYYYYYYY.", "..YYYYYY..", "..YYYYYY..", ".YY....YY."],
    "cat": ["M..M..M..M", ".MMMMMMMM.", "MMMMMMMMMM", "MMKMMMMKMM", "MMMMMMMMMM", "MMNMMMNMMM", ".MMMMMMMM.", "..MM..MM.."],
    "gem": ["...CCCC...", "..CWCCCC..", ".CCCCCCCC.", "CCCCCCCCCC", ".CCCCCCCC.", "..CCCCCC..", "...CCCC...", "....CC...."],
    "tree": ["...GGG....", "..GGGGG...", ".GGGGGGG..", "GGGGGGGGG.", "...TTT....", "...TTT....", "...TTT....", "..TTTTT..."],
    "mush": ["..RRRRRR..", ".RRWWRRWR.", "RRWWRRRWRR", "RRRRRRRRRR", ".SSSSSSSS.", ".SSKSSKSS.", ".SSSSSSSS.", "..SSSSSS.."],
    "ship": ["....BB....", "....BB....", "...BBBB...", ".BBBBBBBB.", "BBBBBBBBBB", ".RRRRRRRR.", "..RRRRRR..", "...RRRR..."],
}
PIXC = {"R": "#c05656", "W": "#f3ede1", "B": "#6b7f9e", "H": "#7a5a3a", "G": "#8fbf9f", "K": "#2c2c31",
        "Y": "#e5b83a", "M": "#5a6270", "N": "#e58fb1", "C": "#4fa3a5", "T": "#8a623c"}


def gen_style(i):
    names = list(PIX.keys())
    name = names[i % len(names)]
    grid = PIX[name]
    cell = 512 // 13
    ox, oy = (W - len(grid[0]) * cell) // 2, (H - len(grid) * cell) // 2
    img = Image.new("RGB", (W, H), ["#f4f1e9", "#eef2ee", "#f7f0ea", "#eef0f4"][i % 4])
    d = ImageDraw.Draw(img)
    for ry, row in enumerate(grid):
        for rx, ch in enumerate(row):
            if ch in PIXC:
                x0, y0 = ox + rx * cell, oy + ry * cell
                d.rectangle([x0, y0, x0 + cell - 2, y0 + cell - 2], fill=PIXC[ch])
    return img


# ---------------- 教程与拆解：分步骤面板 + 数字 ----------------

def gen_tutorial(i):
    img = Image.new("RGB", (W, H), "#ffffff")
    d = ImageDraw.Draw(img)
    f = font(44)
    panels = [(56, 56), (268, 56), (56, 268), (268, 268)]
    style = i % 3
    for pi, (px, py) in enumerate(panels):
        d.rectangle([px, py, px + 190, py + 190], outline="#26292e", width=5)
        d.text((px + 8, py + 4), str(pi + 1), fill="#c8392f", font=f)
        cx, cy = px + 95, py + 104
        if style == 0:  # 房子步骤
            if pi >= 0: d.rectangle([cx - 56, cy - 20, cx + 56, cy + 62], outline="#26292e", width=5)
            if pi >= 1: d.polygon([(cx - 70, cy - 20), (cx, cy - 76), (cx + 70, cy - 20)], outline="#26292e", width=5)
            if pi >= 2:
                d.rectangle([cx - 16, cy + 8, cx + 16, cy + 62], outline="#26292e", width=4)
                d.rectangle([cx - 40, cy - 4, cx - 20, cy + 16], outline="#26292e", width=4)
            if pi >= 3:
                d.ellipse([cx + 30, cy - 46, cx + 62, cy - 14], outline="#26292e", width=4)
                d.arc([cx - 44, cy - 64, cx + 44, cy - 30], 180, 360, fill="#26292e", width=4)
        elif style == 1:  # 花步骤
            if pi >= 0: d.ellipse([cx - 10, cy + 18, cx + 10, cy + 78], outline="#26292e", width=5)
            if pi >= 1:
                for ang in range(0, 360, 72):
                    a = math.radians(ang)
                    d.ellipse([cx + 34 * math.cos(a) - 22, cy - 34 - 34 * math.sin(a) - 22,
                               cx + 34 * math.cos(a) + 22, cy - 34 - 34 * math.sin(a) + 22], outline="#26292e", width=4)
            if pi >= 2: d.ellipse([cx - 20, cy - 54, cx + 20, cy - 14], fill="#e5b83a")
            if pi >= 3:
                d.arc([cx - 60, cy + 6, cx - 6, cy + 40], 180, 300, fill="#26292e", width=4)
                d.arc([cx + 6, cy + 24, cx + 60, cy + 58], 120, 300, fill="#26292e", width=4)
        else:  # 树步骤
            if pi >= 0: d.rectangle([cx - 14, cy + 10, cx + 14, cy + 70], outline="#26292e", width=5)
            if pi >= 1: d.polygon([(cx - 60, cy + 16), (cx, cy - 60), (cx + 60, cy + 16)], outline="#26292e", width=5)
            if pi >= 2:
                d.polygon([(cx - 70, cy + 22), (cx, cy - 44), (cx + 70, cy + 22)], outline="#26292e", width=5)
                d.polygon([(cx - 70, cy - 6), (cx, cy - 72), (cx + 70, cy - 6)], outline="#26292e", width=5)
            if pi >= 3:
                d.rectangle([cx - 14, cy + 10, cx + 14, cy + 70], fill="#8a623c")
                d.polygon([(cx - 70, cy - 6), (cx, cy - 72), (cx + 70, cy - 6)], fill="#6a9a5a")
                d.polygon([(cx - 70, cy + 22), (cx, cy - 44), (cx + 70, cy + 22)], fill="#7fae6a")
    # 面板之间的步骤箭头（教学感）
    for (ax, ay) in [(246, 151), (458, 151), (246, 363), (458, 363)]:
        d.line([(ax - 26, ay), (ax + 14, ay)], fill="#c8392f", width=5)
        d.polygon([(ax + 14, ay - 9), (ax + 14, ay + 9), (ax + 26, ay)], fill="#c8392f")
    for (ax, ay) in [(151, 246), (363, 246)]:
        d.line([(ax, ay - 26), (ax, ay + 14)], fill="#c8392f", width=5)
        d.polygon([(ax - 9, ay + 14), (ax + 9, ay + 14), (ax, ay + 26)], fill="#c8392f")
    return img


# ---------------- 服饰与道具：衣物剪影 / 武器道具 ----------------

def gen_clothes(i):
    img = Image.new("RGB", (W, H), "#f7f6f2")
    d = ImageDraw.Draw(img)
    kind = i % 5
    col = ["#5b7ea3", "#a35b5b", "#5ba36b", "#b08a4a", "#7a5ba3"][i % 5]
    dark = "#33363c"
    if kind == 0:  # T 恤（带领口缝线 / 袖口 / 虚线缝份，更像服装设计稿）
        d.polygon([(180, 130), (230, 100), (282, 100), (332, 130), (368, 200), (316, 226), (306, 190), (306, 410), (206, 410), (206, 190), (196, 226), (144, 200)], fill=col, outline=dark)
        d.arc([230, 96, 282, 136], 0, 180, fill=dark, width=5)
        d.line([(230, 104), (256, 124), (282, 104)], fill=dark, width=4)
        for seg in range(6):  # 肩部虚线缝份
            x0 = 208 + seg * 17
            d.line([(x0, 236), (x0 + 8, 236)], fill=dark, width=3)
            d.line([(x0, 386), (x0 + 8, 386)], fill=dark, width=3)
        d.rectangle([236, 250, 276, 300], outline=dark, width=4)
    elif kind == 1:  # 连衣裙（上色 + 腰带 + 实线褶裥，服装设计稿）
        d.polygon([(206, 110), (306, 110), (292, 220), (356, 420), (156, 420), (220, 220)], fill=col, outline=dark)
        d.line([(206, 110), (306, 110)], fill=dark, width=5)
        d.rectangle([212, 210, 300, 228], fill="#c9b48a", outline=dark, width=3)
        for k in range(3):  # 裙摆褶裥实线
            d.line([(240 + k * 32, 232), (226 + k * 44, 414)], fill=dark, width=3)
    elif kind == 2:  # 连帽衫（帽兜抽绳 + 口袋）
        d.polygon([(180, 150), (150, 210), (188, 240), (196, 205), (196, 400), (316, 400), (316, 205), (324, 240), (362, 210), (332, 150), (280, 130), (256, 156), (232, 130)], fill=col, outline=dark)
        d.arc([224, 96, 288, 160], 0, 180, fill=dark, width=6)
        d.line([(242, 152), (240, 214)], fill=dark, width=5)
        d.line([(270, 152), (272, 214)], fill=dark, width=5)
        d.polygon([(216, 310), (296, 310), (306, 366), (206, 366)], outline=dark, width=4)
    elif kind == 3:  # 剑 + 小盾（武器设计组合，金属质感分面）
        d.polygon([(242, 56), (270, 56), (270, 296), (256, 326), (242, 296)], fill="#c2cad4", outline=dark)
        d.line([(256, 64), (256, 290)], fill=dark, width=4)
        d.polygon([(242, 150), (222, 180), (242, 210)], fill="#9aa4b0", outline=dark)   # 刃面分色
        d.rectangle([196, 296, 316, 320], fill="#8a623c", outline=dark, width=3)
        d.rectangle([240, 320, 272, 404], fill="#6e4a2a", outline=dark, width=3)
        d.ellipse([240, 400, 272, 432], fill="#c8a24a", outline=dark, width=3)
        d.polygon([(352, 250), (428, 282), (428, 360), (390, 420), (352, 368)], fill="#a35b5b", outline=dark, width=3)
        d.ellipse([372, 306, 408, 342], fill="#e0cfa8", outline=dark, width=3)
    else:  # 药水瓶 + 盾
        d.rectangle([160, 150, 220, 200], fill="#c8a24a", outline=dark)
        d.polygon([(160, 200), (220, 200), (250, 300), (250, 380), (130, 380), (130, 300)], fill="#7fc8c9", outline=dark)
        d.ellipse([168, 280, 212, 340], fill="#e8f4f4")
        d.polygon([(340, 140), (420, 170), (420, 280), (380, 360), (340, 300)], fill="#a35b5b", outline=dark)
        d.ellipse([360, 220, 400, 260], fill="#e0cfa8", outline=dark)
    return img


# ---------------- 场景与背景：满版风景 ----------------

SCENES = [
    ("day", [(0xae, 0xe3, 0xf7), (0xe8, 0xf7, 0xfd)], "#7d9bbf", "#8fbf6f", "#ffd94a"),
    ("sunset", [(0xff, 0xb4, 0x6b), (0xff, 0xe3, 0xb0)], "#8a5a7a", "#4e6a4a", "#ff8a3a"),
    ("night", [(0x1a, 0x22, 0x3e), (0x2e, 0x3a, 0x5e)], "#2c3a52", "#243028", "#e8e8d0"),
    ("sea", [(0x9a, 0xd8, 0xe8), (0xe0, 0xf7, 0xfd)], "#5a8aa3", "#3a9a9a", "#f7e05a"),
    ("winter", [(0xc8, 0xda, 0xea), (0xf0, 0xf8, 0xfd)], "#9ab0c2", "#dfe8ee", "#f2e8c8"),
]


def gen_scene(i):
    _, pal, m1, g, sun = SCENES[i % len(SCENES)]
    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)], fill=_lerp3(pal[0], pal[1], min(1, t * 1.6)))
    d.ellipse([350, 60 + (i % 3) * 20, 450, 160 + (i % 3) * 20], fill=sun)
    if i % 5 == 2:  # 夜里用月亮代替星星（星星点阵容易读成像素画）
        d.ellipse([120, 70, 190, 140], fill="#f2f0dc")
    d.polygon([(-40, 400), (150, 190 + (i % 3) * 24), (340, 400)], fill=m1)
    d.polygon([(200, 400), (390, 150 + (i % 4) * 28), (560, 400)], fill=_lerp3((0x7d, 0x9b, 0xbf), (0x40, 0x50, 0x60), 0.35))
    d.rectangle([0, 372, W, H], fill=g)
    if i % 3 == 0:
        d.ellipse([-90, 402, 240, 530], fill=_lerp3((0x8f, 0xbf, 0x6f), (0x30, 0x40, 0x30), 0.25))
    if i % 4 == 1:
        d.rectangle([70, 320, 86, 382], fill="#6e4a2a")
        d.polygon([(36, 330), (78, 254), (120, 330)], fill="#4e8a4a")
    for cx, cy, s in [(110 + (i % 2) * 40, 110, 1.0), (250, 84, 0.75)]:
        d.ellipse([cx - 46 * s, cy - 16 * s, cx + 46 * s, cy + 16 * s], fill="#ffffff")
        d.ellipse([cx - 22 * s, cy - 30 * s, cx + 26 * s, cy + 6 * s], fill="#ffffff")
    return img


# ---------------- 表情与情绪：彩色表情脸阵 ----------------

EMOS = [
    ("happy", lambda d, cx, cy, s: d.arc([cx - 34 * s, cy - 20 * s, cx + 34 * s, cy + 30 * s], 20, 160, fill="#26292e", width=int(6 * s))),
    ("angry", lambda d, cx, cy, s: (d.line([(cx - 40 * s, cy - 8 * s), (cx + 40 * s, cy + 4 * s)], fill="#26292e", width=int(6 * s)),
                                    d.arc([cx - 30 * s, cy + 24 * s, cx + 30 * s, cy + 50 * s], 200, 340, fill="#26292e", width=int(6 * s)))),
    ("sad", lambda d, cx, cy, s: d.arc([cx - 30 * s, cy + 20 * s, cx + 30 * s, cy + 56 * s], 200, 340, fill="#26292e", width=int(6 * s))),
    ("shock", lambda d, cx, cy, s: d.ellipse([cx - 14 * s, cy + 14 * s, cx + 14 * s, cy + 46 * s], outline="#26292e", width=int(5 * s))),
]

FACE_COLS = ["#f2cf63", "#f2a48f", "#a8d8a8", "#9ac2e8", "#d8a8e0", "#f2e2a8"]


def gen_faces(i):
    img = Image.new("RGB", (W, H), "#f4f2ec")
    d = ImageDraw.Draw(img)
    cols = 2 + i % 2
    rows = 2 + (i // 2) % 2
    cw, chh = W // cols, H // rows
    for r in range(rows):
        for c in range(cols):
            cx, cy = cw // 2 + c * cw, chh // 2 + r * chh
            s = min(cw, chh) / 210
            face = FACE_COLS[(r * cols + c + i) % len(FACE_COLS)]
            d.ellipse([cx - 80 * s, cy - 80 * s, cx + 80 * s, cy + 80 * s], fill=face, outline="#26292e", width=int(5 * s))
            eye = EMOS[(r * cols + c + i) % 4]
            d.ellipse([cx - 40 * s, cy - 34 * s, cx - 12 * s, cy - 6 * s], fill="#26292e")
            d.ellipse([cx + 12 * s, cy - 34 * s, cx + 40 * s, cy - 6 * s], fill="#26292e")
            eye[1](d, cx, cy, s)
            if eye[0] == "sad":
                d.ellipse([cx + 20 * s, cy + 2 * s, cx + 34 * s, cy + 26 * s], fill="#7fb8e8")
    return img


# ---------------- 灵感碎片：拼贴情绪板 ----------------

def gen_mood(i):
    img = Image.new("RGB", (W, H), "#e9e2d2")
    d = ImageDraw.Draw(img)
    rnd = random.Random(100 + i)
    pal = PALS[i % len(PALS)] + ["#e63946", "#2a9d8f", "#f4a261"]
    for k in range(9):  # 更多卡片、内容更满、互相叠压
        pw, ph = rnd.randint(130, 210), rnd.randint(110, 180)
        cx, cy = rnd.randint(100, W - 100), rnd.randint(95, H - 95)
        card = Image.new("RGB", (pw, ph), "#ffffff")
        cd = ImageDraw.Draw(card)
        inner = pal[(k * 2 + i) % len(pal)]
        if k % 3 == 0:  # 迷你风景照卡
            cd.rectangle([8, 8, pw - 8, ph - 8], fill=inner)
            cd.rectangle([8, ph // 2, pw - 8, ph - 8], fill="#7ea88a")
            cd.ellipse([pw - pw // 3, ph // 4 - 10, pw - pw // 5, ph // 4 + 10], fill="#ffd94a")
        elif k % 3 == 1:  # 多碎片拼贴
            for m in range(4):
                x0, y0 = 8 + (m % 2) * (pw // 2 - 6), 8 + (m // 2) * (ph // 2 - 6)
                cd.rectangle([x0, y0, x0 + pw // 2 - 12, y0 + ph // 2 - 12], fill=pal[(k * 2 + m + i) % len(pal)])
        else:  # 拍立得叠放（白框照片 + 内芯风景条纹）
            cd.rectangle([0, 0, pw, ph], fill="#ffffff")
            cd.rectangle([10, 10, pw - 10, ph - 44], fill=inner)
            cd.rectangle([14, 14, pw - 14, int((ph - 44) * 0.55)], fill="#bfe0ea")
            cd.polygon([(14, ph - 48), (pw // 2 - 10, 18 + 14), (pw - 14, ph - 48)], fill="#7ea88a")
            cd.rectangle([10, ph - 40, pw - 10, ph - 10], fill="#ffffff")
        card = card.rotate(rnd.randint(-18, 18), expand=True, resample=Image.BICUBIC, fillcolor="#ffffff")
        x, y = cx - card.width // 2, cy - card.height // 2
        img.paste(card, (x, y))
        d.rectangle([x, y, x + card.width, y + card.height], outline="#a89f8d", width=2)
        # 胶带
        tx, ty = x + card.width // 2, y - 4
        d.polygon([(tx - 26, ty - 8), (tx + 26, ty - 2), (tx + 22, ty + 14), (tx - 22, ty + 8)], fill="#d8cfa8")
    return img


GENS = {
    "人体结构": gen_anatomy,
    "动态与透视": gen_dynamic,
    "线条练习": gen_lines,
    "色彩与光影": gen_color,
    "美术风格": gen_style,
    "教程与拆解": gen_tutorial,
    "服饰与道具": gen_clothes,
    "场景与背景": gen_scene,
    "表情与情绪": gen_faces,
    "灵感碎片": gen_mood,
}


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".rc-clip-bench")
    out = os.path.abspath(out)
    for cat in CATS:
        d = os.path.join(out, cat)
        os.makedirs(d, exist_ok=True)
        for i in range(N_PER):
            GENS[cat](i).save(os.path.join(d, f"img_{i:02d}.png"))
        print(f"{cat}: {N_PER} 张")
    total = len(CATS) * N_PER
    print(f"done: {total} images -> {out}")


if __name__ == "__main__":
    main()
