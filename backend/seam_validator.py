"""
RIMI AI — Seam Quality Validator
================================
Analyses every image in test_images/ for seamless-repeat quality.

For each image it:
  1. Computes vertical & horizontal seam scores (edge pixel similarity)
  2. Generates a 3x3 repeat preview
  3. Generates a seam heatmap (highlights problem edges)
  4. Classifies the pattern type (geometric / organic / illustration)
  5. Outputs everything into test_results/seam_report/

Run:
    cd D:\RIMI_AI\backend
    python seam_validator.py
"""

import os
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops
from pathlib import Path
import json
from datetime import datetime

# ── Paths ──────────────────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).parent
TEST_DIR   = SCRIPT_DIR / "test_images"
OUT_DIR    = SCRIPT_DIR / "test_results" / "seam_report"
OUT_DIR.mkdir(parents=True, exist_ok=True)


# ── 1. Seam Score Computation ──────────────────────────────────────
def compute_seam_score(img: Image.Image, strip_pct: float = 0.03) -> dict:
    """
    Compare edge strips to measure how seamless a tile is.
    
    - strip_pct: fraction of image width/height to use as the comparison strip
    - Returns dict with vertical, horizontal, overall scores (0–1) and diagnostics
    """
    arr = np.array(img.convert("RGB"), dtype=np.float32)
    h, w = arr.shape[:2]
    strip_w = max(3, int(w * strip_pct))
    strip_h = max(3, int(h * strip_pct))

    # Vertical seam: left edge vs right edge
    left_strip  = arr[:, :strip_w, :]
    right_strip = arr[:, -strip_w:, :]
    # Flip right strip so pixel rows align for comparison
    v_diff = np.abs(left_strip - right_strip[:, ::-1, :])
    v_mean_diff = np.mean(v_diff) / 255.0
    v_score = max(0.0, 1.0 - v_mean_diff * 6.0)

    # Horizontal seam: top edge vs bottom edge
    top_strip    = arr[:strip_h, :, :]
    bottom_strip = arr[-strip_h:, :, :]
    h_diff = np.abs(top_strip - bottom_strip[::-1, :, :])
    h_mean_diff = np.mean(h_diff) / 255.0
    h_score = max(0.0, 1.0 - h_mean_diff * 6.0)

    overall = (v_score + h_score) / 2.0

    # Per-pixel seam heatmaps (for visualization)
    v_heat = np.mean(v_diff, axis=2)  # H × strip_w
    h_heat = np.mean(h_diff, axis=2)  # strip_h × W

    return {
        "vertical_score": round(v_score, 4),
        "horizontal_score": round(h_score, 4),
        "overall_score": round(overall, 4),
        "is_seamless": v_score > 0.82 and h_score > 0.82,
        "grade": (
            "A — Excellent" if overall > 0.90 else
            "B — Good" if overall > 0.75 else
            "C — Fair" if overall > 0.55 else
            "D — Poor" if overall > 0.35 else
            "F — Failed"
        ),
        "v_raw_diff": round(v_mean_diff, 4),
        "h_raw_diff": round(h_mean_diff, 4),
        "v_heatmap": v_heat,
        "h_heatmap": h_heat,
        "strip_w": strip_w,
        "strip_h": strip_h,
    }


# ── 2. Generate 3×3 Repeat Preview ────────────────────────────────
def make_repeat_preview(img: Image.Image, grid: int = 3) -> Image.Image:
    """Tile the image into a grid×grid repeat."""
    w, h = img.size
    canvas = Image.new("RGB", (w * grid, h * grid))
    for row in range(grid):
        for col in range(grid):
            canvas.paste(img, (col * w, row * h))
    return canvas


# ── 3. Generate Seam Heatmap Overlay ──────────────────────────────
def make_seam_heatmap(img: Image.Image, scores: dict) -> Image.Image:
    """
    Create a version of the image with red overlays on the 4 edges
    showing where the seam mismatch is worst.
    """
    w, h = img.size
    overlay = img.copy().convert("RGBA")
    heat_layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(heat_layer)

    strip_w = scores["strip_w"]
    strip_h = scores["strip_h"]

    # Vertical seam intensity → paint left & right edges
    v_heat = scores["v_heatmap"]  # shape (H, strip_w)
    for y in range(h):
        for x in range(min(strip_w, v_heat.shape[1])):
            intensity = min(255, int(v_heat[y, x] * 3))
            if intensity > 30:
                # Left edge
                draw.point((x, y), fill=(255, 0, 0, intensity))
                # Right edge
                draw.point((w - 1 - x, y), fill=(255, 0, 0, intensity))

    # Horizontal seam intensity → paint top & bottom edges
    h_heat = scores["h_heatmap"]  # shape (strip_h, W)
    for y in range(min(strip_h, h_heat.shape[0])):
        for x in range(w):
            intensity = min(255, int(h_heat[y, x] * 3))
            if intensity > 30:
                # Top edge
                draw.point((x, y), fill=(255, 80, 0, intensity))
                # Bottom edge
                draw.point((x, h - 1 - y), fill=(255, 80, 0, intensity))

    result = Image.alpha_composite(overlay, heat_layer)
    return result.convert("RGB")


# ── 4. Pattern Type Classification ────────────────────────────────
def classify_pattern(img: Image.Image) -> str:
    """
    Simple heuristic classification:
    - High edge variance + low color count → Geometric
    - High color variance + organic shapes → Organic/Floral
    - Very high variance everywhere → Illustration (not a pattern)
    """
    arr = np.array(img.convert("RGB"), dtype=np.float32)
    h, w = arr.shape[:2]

    # Overall color variance
    color_std = np.std(arr)

    # Edge complexity: compare adjacent pixel differences
    dx = np.abs(np.diff(arr, axis=1))
    dy = np.abs(np.diff(arr, axis=0))
    edge_energy = (np.mean(dx) + np.mean(dy)) / 2.0

    # Unique color clusters (downsampled)
    small = img.resize((64, 64), Image.Resampling.LANCZOS)
    colors = small.getcolors(maxcolors=4096)
    unique_colors = len(colors) if colors else 4096

    if unique_colors > 3000 and edge_energy > 25:
        return "Illustration / Photo (NOT a repeat pattern)"
    elif unique_colors < 500 and edge_energy < 15:
        return "Geometric / Structured"
    elif edge_energy < 20:
        return "Geometric / Structured"
    else:
        return "Organic / Floral"


# ── 5. Draw Score Bar ─────────────────────────────────────────────
def draw_score_bar(draw: ImageDraw.Draw, x: int, y: int, w: int, h: int,
                   score: float, label: str):
    """Draw a colored progress bar with label."""
    # Background
    draw.rectangle([x, y, x + w, y + h], fill="#2a2a3e", outline="#444466")
    # Fill
    fill_w = int(w * score)
    if score > 0.82:
        color = "#22c55e"  # green
    elif score > 0.55:
        color = "#eab308"  # yellow
    else:
        color = "#ef4444"  # red
    if fill_w > 0:
        draw.rectangle([x, y, x + fill_w, y + h], fill=color)
    # Label
    draw.text((x + 4, y + 2), f"{label}: {score:.2f}", fill="white")


# ── 6. Generate Full Diagnostic Sheet ─────────────────────────────
def generate_diagnostic_sheet(img: Image.Image, name: str,
                              scores: dict, pattern_type: str) -> Image.Image:
    """
    Creates a single diagnostic image containing:
    - Original tile
    - 3×3 repeat preview
    - Seam heatmap
    - Score bars & metadata
    """
    # Normalize tile to max 512px on longest side
    w, h = img.size
    max_dim = 400
    if max(w, h) > max_dim:
        ratio = max_dim / max(w, h)
        img_small = img.resize((int(w * ratio), int(h * ratio)), Image.Resampling.LANCZOS)
    else:
        img_small = img.copy()

    sw, sh = img_small.size

    # Generate assets
    repeat = make_repeat_preview(img_small, 3)
    rw, rh = repeat.size
    # Scale repeat to fit ~400px
    repeat_max = 400
    if max(rw, rh) > repeat_max:
        ratio = repeat_max / max(rw, rh)
        repeat = repeat.resize((int(rw * ratio), int(rh * ratio)), Image.Resampling.LANCZOS)
    rw, rh = repeat.size

    heatmap = make_seam_heatmap(img_small, scores)

    # Canvas
    pad = 20
    col1_w = max(sw, sw) + pad
    col2_w = rw + pad
    total_w = pad + col1_w + col2_w + pad
    total_h = pad + 40 + sh + pad + sh + pad + 120 + pad  # title + orig + heatmap + scores
    total_h = max(total_h, pad + 40 + rh + pad + 120 + pad)

    canvas = Image.new("RGB", (total_w, total_h), "#1a1a2e")
    draw = ImageDraw.Draw(canvas)

    # Title
    short_name = name[:50] + "..." if len(name) > 50 else name
    draw.text((pad, pad), f"Seam Analysis: {short_name}", fill="white")

    # Column 1: Original + Heatmap
    y_cursor = pad + 40
    draw.text((pad, y_cursor - 16), "Original Tile", fill="#94a3b8")
    canvas.paste(img_small, (pad, y_cursor))
    y_cursor += sh + pad

    draw.text((pad, y_cursor - 16), "Seam Heatmap (red = mismatch)", fill="#94a3b8")
    canvas.paste(heatmap, (pad, y_cursor))
    y_cursor += sh + pad

    # Column 2: Repeat preview
    col2_x = pad + col1_w
    draw.text((col2_x, pad + 40 - 16), "3×3 Repeat Preview", fill="#94a3b8")
    canvas.paste(repeat, (col2_x, pad + 40))

    # Score section (below repeat)
    score_y = pad + 40 + rh + pad
    bar_w = rw - 10
    bar_h = 22

    draw.text((col2_x, score_y), "Seam Scores", fill="white")
    score_y += 24
    draw_score_bar(draw, col2_x, score_y, bar_w, bar_h,
                   scores["vertical_score"], "Vertical (L↔R)")
    score_y += bar_h + 8
    draw_score_bar(draw, col2_x, score_y, bar_w, bar_h,
                   scores["horizontal_score"], "Horizontal (T↔B)")
    score_y += bar_h + 8
    draw_score_bar(draw, col2_x, score_y, bar_w, bar_h,
                   scores["overall_score"], "Overall")
    score_y += bar_h + 16

    # Metadata
    grade_color = "#22c55e" if scores["overall_score"] > 0.75 else (
        "#eab308" if scores["overall_score"] > 0.55 else "#ef4444")
    draw.text((col2_x, score_y), f"Grade: {scores['grade']}", fill=grade_color)
    score_y += 20
    draw.text((col2_x, score_y), f"Type: {pattern_type}", fill="#94a3b8")
    score_y += 20
    seamless_label = "PASS - SEAMLESS" if scores["is_seamless"] else "FAIL - NOT SEAMLESS"
    seamless_color = "#22c55e" if scores["is_seamless"] else "#ef4444"
    draw.text((col2_x, score_y), seamless_label, fill=seamless_color)

    return canvas


# ── 7. Main ───────────────────────────────────────────────────────
def main():
    print("=" * 60)
    print("  RIMI AI — Seam Quality Validator")
    print("=" * 60)

    if not TEST_DIR.exists():
        print(f"\n  ERROR: {TEST_DIR} does not exist.")
        sys.exit(1)

    images = sorted([
        f for f in TEST_DIR.iterdir()
        if f.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp")
    ])

    if not images:
        print(f"\n  No images found in {TEST_DIR}")
        sys.exit(1)

    print(f"\n  Found {len(images)} images in {TEST_DIR}\n")

    results = []

    for i, img_path in enumerate(images, 1):
        name = img_path.name
        print(f"  [{i:2d}/{len(images)}] Analyzing: {name}")

        try:
            img = Image.open(img_path).convert("RGB")
        except Exception as e:
            print(f"         ⚠ Could not open: {e}")
            continue

        # Compute scores
        scores = compute_seam_score(img)
        pattern_type = classify_pattern(img)

        # Print summary
        v = scores["vertical_score"]
        h = scores["horizontal_score"]
        o = scores["overall_score"]
        status = "PASS" if scores["is_seamless"] else "FAIL"
        print(f"         V={v:.3f}  H={h:.3f}  Overall={o:.3f}  "
              f"[{scores['grade']}]  {status}  ({pattern_type})")

        # Generate diagnostic sheet
        sheet = generate_diagnostic_sheet(img, name, scores, pattern_type)
        safe_name = img_path.stem.replace(" ", "_")[:60]
        sheet_path = OUT_DIR / f"{i:02d}_{safe_name}_diagnostic.png"
        sheet.save(sheet_path, "PNG")

        # Generate standalone 3x3 repeat
        repeat = make_repeat_preview(img, 3)
        repeat_path = OUT_DIR / f"{i:02d}_{safe_name}_3x3_repeat.png"
        # Limit repeat size to avoid huge files
        rw, rh = repeat.size
        if max(rw, rh) > 2048:
            ratio = 2048 / max(rw, rh)
            repeat = repeat.resize((int(rw * ratio), int(rh * ratio)), Image.Resampling.LANCZOS)
        repeat.save(repeat_path, "PNG", quality=90)

        results.append({
            "filename": name,
            "width": img.size[0],
            "height": img.size[1],
            "vertical_score": scores["vertical_score"],
            "horizontal_score": scores["horizontal_score"],
            "overall_score": scores["overall_score"],
            "grade": scores["grade"],
            "is_seamless": bool(scores["is_seamless"]),
            "pattern_type": pattern_type,
            "diagnostic_file": sheet_path.name,
            "repeat_file": repeat_path.name,
        })

    # ── Summary Report ─────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("  SUMMARY REPORT")
    print("=" * 60)
    print(f"  {'#':>3}  {'Score':>6}  {'Grade':<15}  {'Seamless':>8}  {'Type':<30}  Name")
    print("  " + "-" * 100)

    for i, r in enumerate(results, 1):
        s = "  YES" if r["is_seamless"] else "   NO"
        print(f"  {i:3d}  {r['overall_score']:6.3f}  {r['grade']:<15}  {s:>8}  "
              f"{r['pattern_type']:<30}  {r['filename'][:40]}")

    # Stats
    seamless_count = sum(1 for r in results if r["is_seamless"])
    avg_score = np.mean([r["overall_score"] for r in results]) if results else 0
    print(f"\n  Seamless: {seamless_count}/{len(results)}  |  "
          f"Average Score: {avg_score:.3f}")

    # Save JSON report
    report_path = OUT_DIR / "seam_report.json"
    with open(report_path, "w") as f:
        json.dump({
            "generated_at": datetime.now().isoformat(),
            "total_images": len(results),
            "seamless_count": seamless_count,
            "average_score": round(avg_score, 4),
            "results": results,
        }, f, indent=2)

    print(f"\n  Results saved to: {OUT_DIR}")
    print(f"  JSON report:      {report_path}")
    print(f"  Diagnostic PNGs:  {len(results)} files")
    print("=" * 60)


if __name__ == "__main__":
    main()
