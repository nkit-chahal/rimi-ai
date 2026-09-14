"""Make Seamless must (a) measure seams in a way real artwork can pass, (b) return the healed
tile rather than the original, and (c) keep pixels outside the seam band untouched.

Found 2026-09-14: the old scorer graded every painterly tile 0, the selection kept the original
unless a healed tile scored strictly higher, so users paid for two flux-fill passes and received
their own upload back, labelled "D - Poor".
"""
import io
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

import services.make_seamless as ms

REPO = Path(__file__).resolve().parents[2]


def periodic_tile(w=256, h=192, seed=0):
    """Exactly periodic texture: wraps perfectly, so it is seamless by construction."""
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:h, 0:w]
    u, v = x / w, y / h
    chans = []
    for _ in range(3):
        img = np.zeros((h, w), dtype=np.float32)
        for fx, fy in [(2, 3), (5, 1), (3, 4), (7, 2)]:
            img += rng.uniform(0.5, 1.0) * np.sin(2 * np.pi * (fx * u + fy * v) + rng.uniform(0, 6.28))
        chans.append(img)
    arr = np.stack(chans, axis=2)
    arr = (arr - arr.min()) / (arr.max() - arr.min()) * 255
    arr += rng.normal(0, 3, arr.shape)  # sensor-like noise so interior steps are non-zero
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")


def hard_cut_tile(w=256, h=192):
    """Crop a periodic tile to a non-period size: the wrap edges no longer meet."""
    return periodic_tile(int(w * 1.37), int(h * 1.29)).crop((0, 0, w, h))


class TestSeamContinuity:
    def test_periodic_tile_is_seamless(self):
        s = ms.seam_continuity(periodic_tile())
        assert s["is_seamless"], s
        assert s["overall"] > 0.9

    def test_hard_cut_is_not_seamless(self):
        s = ms.seam_continuity(hard_cut_tile())
        assert not s["is_seamless"], s
        assert s["ratio_x"] > ms.SEAMLESS_MAX_RATIO or s["ratio_y"] > ms.SEAMLESS_MAX_RATIO

    def test_healed_scores_higher_than_cut(self):
        assert ms.seam_continuity(periodic_tile())["overall"] > ms.seam_continuity(hard_cut_tile())["overall"]

    @pytest.mark.parametrize("name", ["demo_floral.png", "demo_geometric.png", "demo_botanical.png"])
    def test_real_artwork_interior_passes(self, name):
        """The regression: the old scorer failed real prints on their OWN continuous interior."""
        path = REPO / "public" / name
        if not path.exists():
            pytest.skip("demo artwork not present")
        arr = np.array(Image.open(path).convert("RGB"))
        h, w = arr.shape[:2]
        rolled = Image.fromarray(np.roll(np.roll(arr, w // 2, axis=1), h // 2, axis=0))
        s = ms.seam_continuity(rolled)
        assert s["is_seamless"], f"{name}: {s}"

    def test_flat_colour_does_not_divide_by_zero(self):
        s = ms.seam_continuity(Image.new("RGB", (64, 64), (120, 40, 200)))
        assert s["is_seamless"] and s["overall"] == 1.0


class TestBandTextureRatio:
    """Catches the failure where flux-fill paints a flat colour (or a text banner) over the seam:
    the tile wraps perfectly, so continuity alone would grade it A."""

    def test_continued_artwork_is_near_one(self):
        r = ms.band_texture_ratio(periodic_tile(), band_pct=15)
        assert 0.7 <= r <= 1.3, r

    def test_flat_band_is_flagged(self):
        tile = np.array(periodic_tile())
        h, w = tile.shape[:2]
        bh, bw = int(h * 0.15) // 2, int(w * 0.15) // 2
        tile[:bh] = tile[-bh:] = (128, 128, 128)      # grey band on the wrap edges
        tile[:, :bw] = tile[:, -bw:] = (128, 128, 128)
        r = ms.band_texture_ratio(Image.fromarray(tile), band_pct=15)
        assert r < ms.FLAT_FILL_MAX_RATIO, r


class TestCrossMask:
    def test_white_on_seams_black_in_quadrants(self):
        m = np.array(ms.cross_mask(200, 100, band_pct=10, feather=False))
        assert m[50, 10] == 255 and m[10, 100] == 255      # centre row and centre column
        assert m[10, 10] == 0 and m[90, 190] == 0          # quadrant corners untouched

    def test_band_width_follows_percentage(self):
        m = np.array(ms.cross_mask(400, 400, band_pct=10, feather=False))
        assert 36 <= (m[:, 5] == 255).sum() <= 44            # ~10% of 400 rows are white

    def test_single_arm_has_no_junction(self):
        """One seam per pass: the horizontal band must not include a vertical band."""
        m = np.array(ms.cross_mask(200, 100, band_pct=10, feather=False, arms=("h",)))
        assert m[50, 10] == 255                              # centre row: white
        assert m[10, 100] == 0 and m[90, 100] == 0           # centre column outside the band: black


class TestCompositePatch:
    def test_keeps_original_outside_band_and_model_inside(self):
        rng = np.random.default_rng(1)
        original = Image.fromarray(rng.integers(0, 255, (120, 160, 3), dtype=np.uint8), "RGB")
        patched = Image.eval(original, lambda v: 255 - v)
        mask = ms.cross_mask(160, 120, band_pct=15, feather=False)
        out = np.array(ms.composite_patch(original, patched, mask))
        o, p = np.array(original), np.array(patched)
        assert np.array_equal(out[5:20, 5:20], o[5:20, 5:20])   # corner: byte-identical original
        assert np.array_equal(out[60, 80], p[60, 80])             # seam crossing: the model's pixel

    def test_absorbs_model_size_change(self):
        original = periodic_tile(160, 120)
        patched = periodic_tile(160, 120).resize((320, 240))
        out = ms.composite_patch(original, patched, ms.cross_mask(160, 120, 10))
        assert out.size == (160, 120)


class TestPipelineSelection:
    """Run execute_make_seamless with every external call faked. The one thing that matters:
    when the model returns a healed tile, the user gets THAT, not their upload."""

    def _run(self, monkeypatch, tmp_path, model_returns, input_tile=None):
        up, res = tmp_path / "up", tmp_path / "res"
        up.mkdir()
        res.mkdir()
        (input_tile or hard_cut_tile()).save(up / "in.png")
        monkeypatch.setattr(ms, "UPLOAD_DIR", str(up))
        monkeypatch.setattr(ms, "RESULTS_DIR", str(res))

        calls = {"replicate": 0, "refunds": 0, "prompts": []}

        def fake_run(model, input=None, **kw):
            calls["replicate"] += 1
            calls["prompts"].append(input["prompt"])
            return "https://fake/out.png"
        monkeypatch.setattr(ms, "run_model", fake_run)

        buf = io.BytesIO()
        model_returns.save(buf, format="PNG")
        monkeypatch.setattr(ms.http_requests, "get",
                            lambda *a, **k: type("R", (), {"content": buf.getvalue()})())

        class FakeChoice:
            message = type("M", (), {"content": "yellow and turquoise flowers on deep green"})()

        def fake_groq(**kw):
            calls["groq"] = calls.get("groq", 0) + 1
            return type("C", (), {"choices": [FakeChoice()]})()
        monkeypatch.setattr(ms.groq_client.chat.completions, "create", fake_groq)

        def fake_refund(*a, **k):
            calls["refunds"] += 1
        monkeypatch.setattr(ms, "reserve_credits_or_error", lambda *a, **k: (True, None))
        monkeypatch.setattr(ms, "refund_credits", fake_refund)
        monkeypatch.setattr(ms, "credit_requirement", lambda *a, **k: 58)
        monkeypatch.setattr(ms, "log_replicate_call", lambda *a, **k: None)
        monkeypatch.setattr(ms, "log_export", lambda *a, **k: None)
        monkeypatch.setattr(ms, "get_updated_credits", lambda *a, **k: {"credits": 1})
        monkeypatch.setattr(ms, "media_access_token", lambda *a, **k: "tok")
        monkeypatch.setattr(ms.storage, "sync_to_s3", lambda *a, **k: None)

        class FakeConn:
            def execute(self, *a, **k):
                return self

            def commit(self):
                pass

            def close(self):
                pass
        monkeypatch.setattr(ms, "db", lambda: FakeConn())

        result = ms.execute_make_seamless({"filename": "in.png", "projectId": 1, "userId": 1})
        out = Image.open(res / Path(result["resultUrl"]).name).convert("RGB")
        return result, out, np.array(Image.open(up / "in.png").convert("RGB")), calls

    def test_returns_the_healed_tile_not_the_upload(self, monkeypatch, tmp_path):
        result, out, original, calls = self._run(monkeypatch, tmp_path, periodic_tile())
        assert calls["replicate"] >= 1
        assert not np.array_equal(np.array(out), original), "user received their own upload back"
        assert "repainted by AI" in result["health"]["note"]

    def test_pixels_outside_the_seam_band_are_the_originals(self, monkeypatch, tmp_path):
        _, out, original, _ = self._run(monkeypatch, tmp_path, periodic_tile())
        # After offset-and-heal the band sits on the tile EDGES; the centre is far from any mask.
        h, w = original.shape[:2]
        c = (slice(int(h * .3), int(h * .7)), slice(int(w * .3), int(w * .7)))
        assert np.array_equal(np.array(out)[c], original[c])

    def test_one_model_call_per_seam(self, monkeypatch, tmp_path):
        # Two seams (top/bottom, left/right), one straight-band pass each, no refine pass.
        result, _, _, calls = self._run(monkeypatch, tmp_path, periodic_tile())
        assert calls["replicate"] == 2
        assert calls.get("groq", 0) == 1, "caption is fetched once and reused for both passes"
        # The flag the user sees must agree with the letter grade.
        assert result["health"]["label"].startswith(("A", "B"))
        assert result["health"]["tileSeamless"] is True

    def test_unhealed_seam_is_graded_honestly(self, monkeypatch, tmp_path):
        # In offset space the seam sits at the CENTRE of what the model returns. A model output
        # whose centre is still a hard cut means nothing was healed: textured, so not a "flat
        # fill", but the tile must not come back labelled seamless.
        from PIL import ImageChops
        cut = hard_cut_tile()
        still_cut = ImageChops.offset(cut, cut.width // 2, cut.height // 2)
        result, _, _, calls = self._run(monkeypatch, tmp_path, still_cut)
        assert calls["replicate"] == 2
        assert result["health"]["tileSeamless"] is False
        assert not result["health"]["label"].startswith("A")

    def test_prompt_describes_the_picture_not_the_task(self, monkeypatch, tmp_path):
        """flux-fill renders instruction words as text in the image ("MASKED IN ... TILE REGION")."""
        _, _, _, calls = self._run(monkeypatch, tmp_path, periodic_tile())
        import re
        for prompt in calls["prompts"]:
            low = prompt.lower()
            # Whole words only: "textile" is a fine noun, "tile" is an instruction word.
            for forbidden in ("mask", "masked", "seam", "seams", "seamless", "tile", "tiles",
                              "region", "repeat", "repeats", "repeating", "inpaint"):
                assert not re.search(rf"\b{forbidden}\b", low), f"'{forbidden}' in inpaint prompt: {prompt}"
            assert "yellow and turquoise" in low  # the Groq description is still the core

    def test_flat_fill_retries_once_then_grades_d(self, monkeypatch, tmp_path):
        # Model returns flat grey both times on the first seam: one retry, then stop (don't pay
        # for the second seam on a tile that is already a D) and grade honestly, never an A.
        grey = Image.new("RGB", (256, 192), (128, 128, 128))
        result, out, _, calls = self._run(monkeypatch, tmp_path, grey)
        assert calls["replicate"] == 2
        assert result["health"]["label"].startswith("D")
        assert result["health"]["tileSeamless"] is False
        assert "flat colour" in result["health"]["note"]

    def test_already_seamless_input_is_not_billed(self, monkeypatch, tmp_path):
        result, out, original, calls = self._run(
            monkeypatch, tmp_path, periodic_tile(), input_tile=periodic_tile(seed=7))
        assert calls["replicate"] == 0
        assert calls.get("groq", 0) == 0, "no healing, so no caption call either"
        assert calls["refunds"] == 1
        assert np.array_equal(np.array(out), original)
        assert result["health"]["tileSeamless"] is True
        assert "repainted" not in result["health"]["note"]  # nothing was painted
