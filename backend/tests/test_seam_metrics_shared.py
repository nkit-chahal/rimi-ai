"""One seam metric, used everywhere it is shown to a user.

Three scorers drifted apart once: Fix Existing, Generate New and the seam_validator CLI each had
their own, and the ones that mattered could not pass real artwork. These tests pin every consumer
to seam_metrics.seam_continuity.
"""
from pathlib import Path

import numpy as np
from PIL import Image

import seam_metrics
import services.make_seamless as ms

BACKEND = Path(__file__).resolve().parents[1]


def periodic_tile(w=256, h=192, seed=0):
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:h, 0:w]
    u, v = x / w, y / h
    chans = []
    for _ in range(3):
        img = np.zeros((h, w), dtype=np.float32)
        for fx, fy in [(2, 3), (5, 1), (3, 4)]:
            img += rng.uniform(0.5, 1.0) * np.sin(2 * np.pi * (fx * u + fy * v) + rng.uniform(0, 6.28))
        chans.append(img)
    arr = np.stack(chans, axis=2)
    arr = (arr - arr.min()) / (arr.max() - arr.min()) * 255 + rng.normal(0, 3, (h, w, 3))
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")


def test_make_seamless_reexports_the_shared_metric():
    assert ms.seam_continuity is seam_metrics.seam_continuity
    assert ms.band_texture_ratio is seam_metrics.band_texture_ratio
    assert ms.SEAMLESS_MAX_RATIO == seam_metrics.SEAMLESS_MAX_RATIO


def test_generate_new_route_uses_the_shared_metric():
    src = (BACKEND / "routes" / "seamless.py").read_text(encoding="utf-8")
    assert "seam_continuity(" in src
    # The old blend: absolute edge step weighted 70%, mirrored strips nowhere to be seen.
    assert "abs_score" not in src
    assert "[:, ::-1" not in src


def test_validator_cli_uses_the_shared_metric():
    src = (BACKEND / "seam_validator.py").read_text(encoding="utf-8")
    assert "seam_continuity(" in src
    assert "[:, ::-1" not in src and "[::-1, :" not in src


def test_validator_grades_a_seamless_tile_and_keeps_heatmap_shapes():
    import seam_validator

    tile = periodic_tile()
    s = seam_validator.compute_seam_score(tile)
    assert s["is_seamless"] is True
    assert s["grade"].startswith("A")
    w, h = tile.size
    assert s["v_heatmap"].shape == (h, s["strip_w"])
    assert s["h_heatmap"].shape == (s["strip_h"], w)


def test_validator_flags_a_cut_tile():
    import seam_validator

    cut = periodic_tile(340, 250).crop((0, 0, 256, 192))
    s = seam_validator.compute_seam_score(cut)
    assert s["is_seamless"] is False
    assert not s["grade"].startswith("A")
