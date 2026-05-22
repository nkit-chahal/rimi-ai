"""
RIMI AI - Full Seamless Pipeline Validation
=============================================
Tests ALL images in test_images/ through the style-aware
replicate/seamless-texture pipeline and generates:
  1. The seamless base tile
  2. A 3x3 repeat preview
  3. Seam quality scores

Results saved to: test_results/pipeline_validation/

Run:
    python test_seamless_pipeline.py
"""

import os
import time
import base64
import replicate
import numpy as np
from io import BytesIO
from PIL import Image, ImageDraw, ImageChops, ImageFilter, ImageFont
from groq import Groq
import requests

# Load .env file for API keys
env_path = os.path.join(os.path.dirname(__file__), ".env")
if os.path.exists(env_path):
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())

groq_client = Groq()

INPUT_DIR = os.path.join(os.path.dirname(__file__), "test_images")
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "test_results", "pipeline_validation")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Only test actual pattern images (skip the banner and already-processed files)
SKIP_FILES = {"Pattern-Observer_BANNER_03.jpg.jpeg", "repeat_inpainted_3x3_fe2e0434.png"}


def img_to_data_uri(pil_img):
    buf = BytesIO()
    pil_img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
    return f"data:image/png;base64,{b64}"


def compute_seam_score(img):
    """Boundary-gradient seam score: compares edge jumps to internal gradients."""
    arr = np.array(img.convert("RGB"), dtype=np.float32)
    diff_x = np.mean(np.abs(arr[:, 1:, :] - arr[:, :-1, :]))
    diff_y = np.mean(np.abs(arr[1:, :, :] - arr[:-1, :, :]))
    seam_x = np.mean(np.abs(arr[:, 0, :] - arr[:, -1, :]))
    seam_y = np.mean(np.abs(arr[0, :, :] - arr[-1, :, :]))

    ratio_x = seam_x / max(1e-5, diff_x)
    ratio_y = seam_y / max(1e-5, diff_y)

    sc_x = max(0.0, 1.0 - (ratio_x - 1.0) / 2.0) if ratio_x > 1.0 else 1.0
    sc_y = max(0.0, 1.0 - (ratio_y - 1.0) / 2.0) if ratio_y > 1.0 else 1.0
    return (sc_x + sc_y) / 2.0, ratio_x, ratio_y


def make_repeat(tile, n=3):
    w, h = tile.size
    out = Image.new("RGB", (w * n, h * n))
    for r in range(n):
        for c in range(n):
            out.paste(tile, (c * w, r * h))
    return out


def create_cross_mask(w, h, h_pct=16, v_pct=16):
    mask = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(mask)
    mid_x, mid_y = w // 2, h // 2
    h_brush = max(4, int(w * h_pct / 100))
    v_brush = max(4, int(h * v_pct / 100))
    draw.rectangle([0, mid_y - v_brush // 2, w, mid_y + v_brush // 2], fill=255)
    draw.rectangle([mid_x - h_brush // 2, 0, mid_x + h_brush // 2, h], fill=255)
    # Feather
    mask = mask.filter(ImageFilter.GaussianBlur(radius=max(3, min(h_brush, v_brush) // 6)))
    arr = np.array(mask, dtype=np.float32)
    arr = np.clip(arr * 1.5, 0, 255).astype(np.uint8)
    return Image.fromarray(arr)


def get_style_description(img):
    uri = img_to_data_uri(img)
    completion = groq_client.chat.completions.create(
        model="meta-llama/llama-4-scout-17b-16e-instruct",
        messages=[{
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": uri}},
                {"type": "text", "text": (
                    "Describe this fabric pattern in detail. "
                    "Specify the motifs, colors, background, and crucially, the artistic style "
                    "(e.g. flat 2D vector graphic, minimalist digital illustration, watercolor painting, "
                    "hand-drawn sketch, photographic pattern). Keep it under 2 sentences."
                )}
            ]
        }],
        temperature=0.2,
        max_completion_tokens=150,
    )
    return completion.choices[0].message.content.strip()


def process_image(filepath, name, brush_pct=16):
    img = Image.open(filepath).convert("RGB")
    orig_w, orig_h = img.size

    # Original seam score
    orig_score, orig_rx, orig_ry = compute_seam_score(img)

    # 1. Style description
    desc = get_style_description(img)
    print(f"    Style: {desc[:100]}...")

    # 2. Aspect-ratio preserving resize (multiples of 64)
    max_dim = 1024
    if orig_w > orig_h:
        new_w = max_dim
        new_h = int(max_dim * (orig_h / orig_w))
    else:
        new_h = max_dim
        new_w = int(max_dim * (orig_w / orig_h))
        
    new_w = max(64, (new_w // 64) * 64)
    new_h = max(64, (new_h // 64) * 64)

    img_resized = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
    x_offset, y_offset = new_w // 2, new_h // 2

    # PASS 1: Horizontal
    img_pass1_offset = ImageChops.offset(img_resized, 0, y_offset)
    mask_h = Image.new('L', (new_w, new_h), 0)
    draw_h = ImageDraw.Draw(mask_h)
    v_brush = max(4, int(new_h * (brush_pct / 100.0)))
    draw_h.rectangle([0, y_offset - v_brush // 2, new_w, y_offset + v_brush // 2], fill=255)
    mask_h = mask_h.filter(ImageFilter.GaussianBlur(radius=max(3, v_brush // 6)))
    arr_h = np.array(mask_h, dtype=np.float32)
    arr_h = np.clip(arr_h * 1.5, 0, 255).astype(np.uint8)
    mask_h = Image.fromarray(arr_h)

    t0 = time.time()
    output_h = replicate.run(
        "replicate/seamless-texture:9a59c0dce189bfe8a7fcb379c497713500ff959652c4e7874023f15983dec839",
        input={
            "model": "dev",
            "image": img_to_data_uri(img_pass1_offset),
            "mask": img_to_data_uri(mask_h),
            "prompt": f"FSTL {desc}, seamless repeating pattern, tileable",
            "prompt_strength": 0.80,
            "guidance_scale": 3.0,
            "num_outputs": 1,
            "num_inference_steps": 30,
            "output_format": "png",
        }
    )
    filled_url_h = str(output_h[0]) if isinstance(output_h, list) else str(output_h)
    filled_resp_h = requests.get(filled_url_h, timeout=60)
    img_pass1_fixed = Image.open(BytesIO(filled_resp_h.content)).convert('RGB')

    # PASS 2: Vertical
    img_pass2_offset = ImageChops.offset(img_pass1_fixed, x_offset, 0)
    mask_v = Image.new('L', (new_w, new_h), 0)
    draw_v = ImageDraw.Draw(mask_v)
    h_brush = max(4, int(new_w * (brush_pct / 100.0)))
    draw_v.rectangle([x_offset - h_brush // 2, 0, x_offset + h_brush // 2, new_h], fill=255)
    mask_v = mask_v.filter(ImageFilter.GaussianBlur(radius=max(3, h_brush // 6)))
    arr_v = np.array(mask_v, dtype=np.float32)
    arr_v = np.clip(arr_v * 1.5, 0, 255).astype(np.uint8)
    mask_v = Image.fromarray(arr_v)

    output_v = replicate.run(
        "replicate/seamless-texture:9a59c0dce189bfe8a7fcb379c497713500ff959652c4e7874023f15983dec839",
        input={
            "model": "dev",
            "image": img_to_data_uri(img_pass2_offset),
            "mask": img_to_data_uri(mask_v),
            "prompt": f"FSTL {desc}, seamless repeating pattern, tileable",
            "prompt_strength": 0.80,
            "guidance_scale": 3.0,
            "num_outputs": 1,
            "num_inference_steps": 30,
            "output_format": "png",
        }
    )
    elapsed = time.time() - t0

    filled_url_v = str(output_v[0]) if isinstance(output_v, list) else str(output_v)
    filled_resp_v = requests.get(filled_url_v, timeout=60)
    inpainted = Image.open(BytesIO(filled_resp_v.content)).convert("RGB")

    # 5. Shift back + resize
    fixed_resized = ImageChops.offset(inpainted, -x_offset, -y_offset)
    fixed = fixed_resized.resize((orig_w, orig_h), Image.Resampling.LANCZOS)

    # 6. Score
    new_score, new_rx, new_ry = compute_seam_score(fixed)

    # 7. Save tile + 3x3 repeat
    safe = name.replace(" ", "_").replace("(", "").replace(")", "")
    fixed.save(os.path.join(OUTPUT_DIR, f"{safe}_tile.png"))
    repeat = make_repeat(fixed, 3)
    repeat.save(os.path.join(OUTPUT_DIR, f"{safe}_3x3_repeat.png"))

    # Also save original 3x3 for comparison
    orig_repeat = make_repeat(img, 3)
    orig_repeat.save(os.path.join(OUTPUT_DIR, f"{safe}_original_3x3.png"))

    return {
        "name": name,
        "size": f"{orig_w}x{orig_h}",
        "orig_score": orig_score,
        "orig_rx": orig_rx,
        "orig_ry": orig_ry,
        "new_score": new_score,
        "new_rx": new_rx,
        "new_ry": new_ry,
        "time": elapsed,
        "desc": desc[:80],
    }


def main():
    print("=" * 70)
    print("  RIMI AI - Full Seamless Pipeline Validation")
    print("=" * 70)

    files = sorted([
        f for f in os.listdir(INPUT_DIR)
        if f.lower().endswith((".png", ".jpg", ".jpeg"))
        and f not in SKIP_FILES
    ])

    print(f"\n  Found {len(files)} test images in {INPUT_DIR}\n")

    results = []
    for i, f in enumerate(files):
        name = os.path.splitext(f)[0]
        short = name[-30:] if len(name) > 30 else name
        print(f"  [{i+1}/{len(files)}] {short}")
        try:
            r = process_image(os.path.join(INPUT_DIR, f), name)
            results.append(r)
            label = "EXCELLENT" if r["new_score"] >= 0.90 else "GOOD" if r["new_score"] >= 0.75 else "FAIR" if r["new_score"] >= 0.60 else "POOR"
            print(f"    Original: {r['orig_score']:.3f}  →  New: {r['new_score']:.3f}  [{label}]  ({r['time']:.1f}s)")
        except Exception as e:
            print(f"    ERROR: {e}")

    # Summary table
    print("\n" + "=" * 70)
    print("  SUMMARY")
    print("=" * 70)
    print(f"  {'Image':<35} {'Size':<12} {'Before':>8} {'After':>8} {'Grade':>10}")
    print(f"  {'-'*35} {'-'*12} {'-'*8} {'-'*8} {'-'*10}")

    excellent = good = fair = poor = 0
    for r in results:
        grade = "EXCELLENT" if r["new_score"] >= 0.90 else "GOOD" if r["new_score"] >= 0.75 else "FAIR" if r["new_score"] >= 0.60 else "POOR"
        if grade == "EXCELLENT": excellent += 1
        elif grade == "GOOD": good += 1
        elif grade == "FAIR": fair += 1
        else: poor += 1
        short = r["name"][-35:] if len(r["name"]) > 35 else r["name"]
        print(f"  {short:<35} {r['size']:<12} {r['orig_score']:>7.3f} {r['new_score']:>7.3f} {grade:>10}")

    total = len(results)
    print(f"\n  Total: {total}  |  Excellent: {excellent}  Good: {good}  Fair: {fair}  Poor: {poor}")
    print(f"  Results saved to: {OUTPUT_DIR}")
    print("=" * 70)


if __name__ == "__main__":
    main()
