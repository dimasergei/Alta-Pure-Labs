"""Build the PURE tab/touch icons from one parallel-bar construction.

Run with Python and Pillow. Supersampling keeps the same geometry at 16px,
32px and larger sizes; the ICO contains native small sizes for browser tabs.
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
BARS = ((0, 4, 4, 10), (6, 0, 4, 18), (12, 2, 4, 14))
TRANSLATE_X, TRANSLATE_Y, SKEW = 32 / 3, 7, -1 / 3

svg = '''<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 32 32" role="img" aria-labelledby="title">
  <title id="title">PURE</title>
  <rect width="32" height="32" rx="5.333333" fill="#111"/>
  <g fill="#fff" transform="matrix(1 0 -0.3333333333 1 10.6666666667 7)">
    <rect x="0" y="4" width="4" height="10"/>
    <rect x="6" y="0" width="4" height="18"/>
    <rect x="12" y="2" width="4" height="14"/>
  </g>
</svg>
'''
(ASSETS / "pure-icon.svg").write_text(svg)


def render(size):
    scale = size * 8 / 32
    image = Image.new("RGBA", (size * 8, size * 8), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((0, 0, size * 8 - 1, size * 8 - 1),
                           radius=32 / 6 * scale, fill="#111111")
    for x, y, width, height in BARS:
        corners = ((x, y), (x + width, y),
                   (x + width, y + height), (x, y + height))
        points = [((px + SKEW * py + TRANSLATE_X) * scale,
                   (py + TRANSLATE_Y) * scale) for px, py in corners]
        draw.polygon(points, fill="#ffffff")
    return image.resize((size, size), Image.Resampling.LANCZOS)


sizes = (16, 32, 48, 64, 96, 128, 180, 256)
images = {size: render(size) for size in sizes}
for size in (16, 32, 48, 96, 180):
    images[size].save(ASSETS / f"pure-icon-{size}.png", optimize=True)
ico_sizes = (16, 32, 48, 64, 96, 128, 256)
images[256].save(ASSETS / "pure-icon.ico", format="ICO",
                 sizes=[(size, size) for size in ico_sizes],
                 append_images=[images[size] for size in ico_sizes[:-1]])
print("Built PURE SVG, native 16/32px tab icons, PNGs, and multi-size ICO.")
