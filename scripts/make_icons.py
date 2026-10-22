"""Draw the site icon (three rising bars on navy) as SVG and PNG files.

Usage: python3 -I make_icons.py <output assets dir>
Pure Python: shapes are drawn with 2x supersampling and saved with zlib.
"""
import os
import struct
import sys
import zlib

NAVY = (11, 31, 58)
CYAN = (70, 195, 220)
WHITE = (238, 243, 251)
# bars as (x0, x1, top) in a 0..1 square; they share a baseline
BARS = [(0.22, 0.36, 0.56, CYAN), (0.43, 0.57, 0.40, CYAN), (0.64, 0.78, 0.22, WHITE)]
BASE = 0.78

SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100" height="100" rx="22" fill="#0b1f3a"/>
<rect x="22" y="56" width="14" height="22" rx="3" fill="#46c3dc"/>
<rect x="43" y="40" width="14" height="38" rx="3" fill="#46c3dc"/>
<rect x="64" y="22" width="14" height="56" rx="3" fill="#eef3fb"/>
</svg>
"""


def inside_round_rect(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def render(size, ss=2):
    n = size * ss
    acc = [[0.0, 0.0, 0.0] for _ in range(size * size)]
    for py in range(n):
        y = (py + 0.5) / n
        for px in range(n):
            x = (px + 0.5) / n
            col = NAVY
            for x0, x1, top, c in BARS:
                if inside_round_rect(x, y, x0, top, x1, BASE, 0.03):
                    col = c
                    break
            a = acc[(py // ss) * size + (px // ss)]
            a[0] += col[0]; a[1] += col[1]; a[2] += col[2]
    k = ss * ss
    raw = bytearray()
    for row in range(size):
        raw.append(0)
        for colx in range(size):
            a = acc[row * size + colx]
            raw += bytes((round(a[0] / k), round(a[1] / k), round(a[2] / k), 255))
    return bytes(raw)


def png(size, raw):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def main(out):
    os.makedirs(out, exist_ok=True)
    open(os.path.join(out, "icon.svg"), "w").write(SVG)
    for name, size in (("icon-512.png", 512), ("icon-192.png", 192), ("apple-touch-icon.png", 180)):
        open(os.path.join(out, name), "wb").write(png(size, render(size)))
    print("icons written to", out)


if __name__ == "__main__":
    main(sys.argv[1])
