"""Generate web-sized WebP copies of oversized PNGs in public/.

Run from the repo root:  python scripts/optimize-images.py [--check]

Why this exists: the login page's demo WebP files (commit 44a5725) were converted by hand with
no script and unrecorded encoder settings, so they cannot be regenerated or matched. Anything
added here stays reproducible.

The originals are never modified or deleted. Several are load-bearing:
  - /demo_geometric.png is written into projects.thumbnail_url and hero_image_url on every new
    project (backend/routes/projects.py, backend/routes/product.py), so production rows already
    contain that exact string.
  - backend/tests/test_make_seamless_logic.py reads public/demo_*.png off disk.
  - og-cover.png must stay PNG: several social crawlers handle a WebP og:image poorly.
"""
import argparse
import glob
import os
import sys

from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# (glob relative to repo root, max edge in px, quality)
# Product images render at ~150x120 CSS px inside a max-height:520px scroller, so 320px covers
# a 2x display with room to spare. They were 1024x1024 PNGs — roughly 47x the pixels shown.
TARGETS = [
    ("public/products/*.png", 320, 82),
]


def convert(pattern, max_edge, quality, check_only=False):
    rows, src_total, out_total, stale = [], 0, 0, []
    for src in sorted(glob.glob(os.path.join(REPO, pattern))):
        dst = os.path.splitext(src)[0] + ".webp"
        src_bytes = os.path.getsize(src)
        fresh = os.path.exists(dst) and os.path.getmtime(dst) >= os.path.getmtime(src)

        if not fresh:
            stale.append(os.path.relpath(dst, REPO))
            if not check_only:
                img = Image.open(src)
                img = img.convert("RGBA") if img.mode in ("RGBA", "LA", "P") else img.convert("RGB")
                img.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
                img.save(dst, "WEBP", quality=quality, method=6)

        out_bytes = os.path.getsize(dst) if os.path.exists(dst) else 0
        src_total += src_bytes
        out_total += out_bytes
        rows.append((os.path.basename(src), src_bytes, out_bytes))

    return rows, src_total, out_total, stale


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true",
                    help="report what is missing or out of date and exit 1; write nothing")
    args = ap.parse_args()

    grand_src = grand_out = 0
    all_stale = []
    for pattern, max_edge, quality in TARGETS:
        rows, src_total, out_total, stale = convert(pattern, max_edge, quality, args.check)
        if not rows:
            print(f"no files matched {pattern}")
            continue
        all_stale += stale
        grand_src += src_total
        grand_out += out_total

        print(f"\n{pattern}  ->  webp, max {max_edge}px, q{quality}")
        print(f"  {'file':<34}{'png':>12}{'webp':>12}")
        for name, s, o in rows:
            print(f"  {name:<34}{s/1024:>10.0f} K{o/1024:>10.0f} K")
        print(f"  {'-' * 58}")
        print(f"  {len(rows)} files{src_total/1024/1024:>26.1f} M{out_total/1024:>10.0f} K")

    if grand_src:
        print(f"\ntotal: {grand_src/1024/1024:.1f} MB -> {grand_out/1024:.0f} KB "
              f"({100 * (1 - grand_out / grand_src):.1f}% smaller)")

    if args.check and all_stale:
        print(f"\nout of date ({len(all_stale)}): " + ", ".join(all_stale[:6])
              + (" ..." if len(all_stale) > 6 else ""))
        print("run: python scripts/optimize-images.py")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
