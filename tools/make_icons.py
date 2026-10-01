"""Generate the PWA icons (a padel ball on a dark court color) with no dependencies."""
import struct
import zlib
from pathlib import Path

BG = (12, 23, 18)
BALL = (215, 242, 92)
SEAM = (245, 250, 240)
OUT = Path(__file__).resolve().parent.parent / "web" / "icons"


def color_at(x: float, y: float, size: int, ball_ratio: float):
    c = size / 2
    r = size * ball_ratio
    dx, dy = x - c, y - c
    if dx * dx + dy * dy > r * r:
        return BG
    # two curved seams: arcs of circles centered outside the ball
    seam_r, off, width = r * 0.95, r * 1.25, r * 0.07
    for sx in (c - off, c + off):
        d = ((x - sx) ** 2 + dy * dy) ** 0.5
        if abs(d - seam_r) < width:
            return SEAM
    return BALL


def render(size: int, ball_ratio: float) -> bytes:
    rows = []
    offsets = (0.25, 0.75)  # 2x2 supersampling for smooth edges
    for y in range(size):
        row = bytearray([0])  # PNG filter: none
        for x in range(size):
            acc = [0, 0, 0]
            for oy in offsets:
                for ox in offsets:
                    for i, v in enumerate(color_at(x + ox, y + oy, size, ball_ratio)):
                        acc[i] += v
            row += bytes(v // 4 for v in acc)
        rows.append(bytes(row))
    return b"".join(rows)


def png(size: int, raw: bytes) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, size, ratio in (("icon-192.png", 192, 0.38), ("icon-512.png", 512, 0.38), ("icon-maskable-512.png", 512, 0.28)):
        (OUT / name).write_bytes(png(size, render(size, ratio)))
        print("ok", name)


if __name__ == "__main__":
    main()
