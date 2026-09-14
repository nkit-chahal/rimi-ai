"""Seam metrics shared by Make Seamless, Generate New and the seam_validator CLI.

Pure numpy; no app imports, so the diagnostics CLI can use it without loading the Flask app.
One module because three seam scorers drifted apart once already: the one the product used
compared mirrored edge strips against an absolute threshold and could not pass real artwork,
so Fix Existing threw away every healed tile and Generate New graded clean tiles "D - Poor".
"""
import numpy as np

# A seam is "invisible" when the wrap-around edge step is no bigger than the steps between
# neighbouring pixels elsewhere in the image. Ratio 1.0 = indistinguishable from the interior.
SEAMLESS_MAX_RATIO = 1.5

# Texture inside the healed band vs the artwork right next to it. A real continuation has about
# the same amount of detail as its surroundings; a model that gave up and painted flat colour
# (or a banner of text) over the seam comes in far below. Seen at 0.08 on a floral print.
FLAT_FILL_MAX_RATIO = 0.35


def seam_continuity(img):
    """Score how seamlessly a tile wraps, relative to its own texture.

    Compares the two wrap-adjacent edges (column 0 next to column w-1, row 0 next to row h-1)
    and divides by the mean adjacent-pixel difference inside the image. The previous scorer
    compared 3%-wide edge strips MIRRORED and against an absolute threshold, so any painterly or
    photographic artwork failed on its own continuous interior; nothing real could ever pass.
    """
    arr = np.asarray(img.convert("RGB"), dtype=np.float32)
    seam_x = float(np.mean(np.abs(arr[:, 0] - arr[:, -1])))
    seam_y = float(np.mean(np.abs(arr[0, :] - arr[-1, :])))
    base_x = max(1.0, float(np.mean(np.abs(arr[:, 1:] - arr[:, :-1]))))
    base_y = max(1.0, float(np.mean(np.abs(arr[1:, :] - arr[:-1, :]))))
    ratio_x, ratio_y = seam_x / base_x, seam_y / base_y

    def to_score(ratio):
        # 1.0 at ratio<=1, falling to 0 at ratio 5 (a hard cut on this kind of artwork is 4-6).
        return max(0.0, min(1.0, 1.0 - (ratio - 1.0) / 4.0))

    v_score, h_score = to_score(ratio_x), to_score(ratio_y)
    return {
        "v": round(v_score, 4),
        "h": round(h_score, 4),
        "overall": round((v_score + h_score) / 2.0, 4),
        "ratio_x": round(ratio_x, 3),
        "ratio_y": round(ratio_y, 3),
        "is_seamless": bool(ratio_x <= SEAMLESS_MAX_RATIO and ratio_y <= SEAMLESS_MAX_RATIO),
    }


def band_texture_ratio(tile, band_pct, arms=("h", "v")):
    """Detail inside the seam band (which sits on the tile's edges after the offset is undone)
    relative to the strip of original artwork immediately inside it. ~1.0 = the model continued
    the design; << 1 = it filled the band with something flat. "h" checks the top/bottom edges,
    "v" the left/right ones."""
    arr = np.asarray(tile.convert("RGB"), dtype=np.float32)
    h, w = arr.shape[:2]
    bh = max(2, int(h * band_pct / 100.0) // 2)
    bw = max(2, int(w * band_pct / 100.0) // 2)

    def texture(region):
        dx = np.abs(region[:, 1:] - region[:, :-1]).mean() if region.shape[1] > 1 else 0.0
        dy = np.abs(region[1:, :] - region[:-1, :]).mean() if region.shape[0] > 1 else 0.0
        return float(dx + dy) / 2.0

    band, inner = [], []
    if "h" in arms:
        band += [texture(arr[:bh]), texture(arr[-bh:])]
        inner += [texture(arr[bh:2 * bh]), texture(arr[-2 * bh:-bh])]
    if "v" in arms:
        band += [texture(arr[:, :bw]), texture(arr[:, -bw:])]
        inner += [texture(arr[:, bw:2 * bw]), texture(arr[:, -2 * bw:-bw])]
    return round((sum(band) / len(band)) / max(1.0, sum(inner) / len(inner)), 3)
