"""Watermark utilities for free-tier exports and public shares."""
import io

from PIL import Image, ImageDraw, ImageFont


FREE_PLANS = {"free trial", "free", "trial"}


def is_free_plan(plan):
    if not plan:
        return True
    return plan.strip().lower() in FREE_PLANS


def apply_watermark(image_bytes, text="RIMI AI"):
    """Apply a subtle diagonal watermark. Returns PNG bytes."""
    img = Image.open(io.BytesIO(image_bytes))
    if img.mode != "RGBA":
        img = img.convert("RGBA")

    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    w, h = img.size
    font_size = max(18, min(w, h) // 18)

    try:
        font = ImageFont.truetype("arial.ttf", font_size)
    except Exception:
        font = ImageFont.load_default()

    spacing_x = font_size * 6
    spacing_y = font_size * 4
    for y in range(-h, h * 2, spacing_y):
        for x in range(-w, w * 2, spacing_x):
            draw.text((x, y), text, fill=(255, 255, 255, 55), font=font)
            draw.text((x + 1, y + 1), text, fill=(0, 0, 0, 35), font=font)

    rotated = overlay.rotate(30, expand=True)
    rx, ry = rotated.size
    overlay = rotated.crop(((rx - w) // 2, (ry - h) // 2, (rx + w) // 2, (ry + h) // 2))

    out = Image.alpha_composite(img, overlay)
    if out.mode == "RGBA":
        background = Image.new("RGB", out.size, (255, 255, 255))
        background.paste(out, mask=out.split()[3])
        out = background

    buf = io.BytesIO()
    out.save(buf, format="PNG", optimize=True)
    return buf.getvalue()
