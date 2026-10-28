"""Generate the Dev Studio monochrome app icon (terminal prompt mark)."""
from PIL import Image, ImageDraw
import os

SIZE = 1024
img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# Rounded-square tile, near-black (matches the app's black rail)
TILE = (11, 11, 11, 255)
radius = 200
d.rounded_rectangle([24, 24, SIZE - 24, SIZE - 24], radius=radius, fill=TILE)

# Hairline inner edge for crispness on light taskbars
d.rounded_rectangle(
    [24, 24, SIZE - 24, SIZE - 24],
    radius=radius,
    outline=(255, 255, 255, 38),
    width=4,
)

WHITE = (246, 245, 242, 255)
STROKE = 96

# Chevron ">" — the shell prompt
chevron = [(300, 292), (508, 512), (300, 732)]
d.line(chevron, fill=WHITE, width=STROKE, joint="curve")
# Round the chevron ends
for pt in chevron:
    d.ellipse(
        [pt[0] - STROKE / 2, pt[1] - STROKE / 2, pt[0] + STROKE / 2, pt[1] + STROKE / 2],
        fill=WHITE,
    )

# Underscore cursor bar
bar = [(596, 726), (824, 726)]
d.line(bar, fill=WHITE, width=STROKE)
for pt in bar:
    d.ellipse(
        [pt[0] - STROKE / 2, pt[1] - STROKE / 2, pt[0] + STROKE / 2, pt[1] + STROKE / 2],
        fill=WHITE,
    )

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out_dir = os.path.join(PROJECT_ROOT, "resources")
os.makedirs(out_dir, exist_ok=True)
master = os.path.join(out_dir, "icon.png")
img.save(master, "PNG")
print("wrote", master, img.size)

# Common raster sizes alongside the master (useful for Linux/preview)
for s in (512, 256, 128, 64, 32, 16):
    p = os.path.join(out_dir, f"icon_{s}.png")
    img.resize((s, s), Image.LANCZOS).save(p, "PNG")
    print("wrote", p)
