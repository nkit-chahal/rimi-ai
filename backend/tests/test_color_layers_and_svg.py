"""Colour separation and SVG export: three defects that shipped silently.

1. Reducing colours against a brand palette always raised ImportError, so the feature
   could never have worked for anyone.
2. quantize_image sorts its palette by weight but returns labels keyed by cluster id, so
   every exported layer was labelled with a different colour's hex and Pantone match.
3. SVG export shelled out to a `vtracer` binary that is not installed, skipped every layer,
   and returned an empty document that the caller still charged credits for.
"""
import os

import numpy as np
import pytest
from PIL import Image

from layer_utils import create_color_layers
from pantone_utils import quantize_image

RED = (220, 30, 40)
BLUE = (30, 60, 200)


@pytest.fixture()
def two_tone_png(tmp_path):
    """70% red over 30% blue, so the weight sort really does reorder the palette."""
    height, width = 100, 60
    pixels = np.zeros((height, width, 3), dtype=np.uint8)
    pixels[:70, :] = RED
    pixels[70:, :] = BLUE
    path = tmp_path / "two_tone.png"
    Image.fromarray(pixels, "RGB").save(path)
    return str(path)


def _close(a, b, tolerance=40):
    return all(abs(int(x) - int(y)) <= tolerance for x, y in zip(a, b))


def test_palette_entries_carry_their_cluster_index(two_tone_png):
    _quantized, palette, labels_2d = quantize_image(two_tone_png, 2)

    assert len(palette) == 2
    assert palette[0]["weight"] > palette[1]["weight"], "palette should be heaviest-first"
    for entry in palette:
        assert "index" in entry, "consumers need the cluster label to split the image"
        assert entry["index"] in set(np.unique(labels_2d).tolist())
    assert palette[0]["index"] != palette[1]["index"]


def test_each_exported_layer_holds_the_colour_it_is_labelled_with(two_tone_png):
    """The regression: layer i was built from cluster i while palette i was sorted by weight."""
    layers, palette = create_color_layers(two_tone_png, 2)

    assert len(layers) == len(palette) == 2
    for layer_img, entry in zip(layers, palette):
        arr = np.array(layer_img)
        opaque = arr[arr[:, :, 3] > 0]
        assert opaque.size, "layer should contain pixels"
        mean_rgb = opaque[:, :3].mean(axis=0)
        assert _close(mean_rgb, entry["rgb"]), (
            f"layer pixels {mean_rgb} do not match the palette entry {entry['rgb']} "
            "they are exported under"
        )

    # The heaviest colour is the one that covers most of the image.
    dominant = np.array(layers[0])
    assert (dominant[:, :, 3] > 0).sum() > (np.array(layers[1])[:, :, 3] > 0).sum()
    assert _close(palette[0]["rgb"], RED)
    assert _close(palette[1]["rgb"], BLUE)


def test_brand_palette_reduction_runs(two_tone_png):
    """Previously raised ImportError before touching a single pixel."""
    _quantized, palette, labels_2d = quantize_image(
        two_tone_png, 2, brand_palette=["#dc1e28", "#1e3cc8"]
    )
    assert len(palette) == 2
    assert set(np.unique(labels_2d).tolist()) <= {0, 1}


def test_layer_vectorizes_to_real_svg_paths(two_tone_png):
    """vtracer ships as Python bindings; the old code looked for a CLI that is not there."""
    from services.qwen_export import _vectorize_layer_to_svg

    svg = _vectorize_layer_to_svg(two_tone_png)
    assert "<svg" in svg
    assert "<path" in svg, "a traced layer must contain path geometry, not an empty document"


def test_svg_export_refuses_to_bill_for_an_empty_document(monkeypatch, tmp_path):
    """If every layer fails to trace, the export must raise rather than return an empty file.

    The route records the credit charge only after this returns.
    """
    from services import qwen_export

    layer_path = tmp_path / "layer.png"
    Image.new("RGBA", (10, 10), (255, 0, 0, 255)).save(layer_path)
    monkeypatch.setattr(qwen_export, "_resolve_filepath", lambda *_a, **_k: str(layer_path))

    def explode(_path):
        raise RuntimeError("tracer unavailable")

    monkeypatch.setattr(qwen_export, "_vectorize_layer_to_svg", explode)

    document = {"layers": [{"filename": "layer.png", "visible": True, "name": "Layer 1"}]}
    with pytest.raises(RuntimeError, match="traced no layers"):
        qwen_export.export_session_svg(document, 64, 64)


def test_svg_export_escapes_layer_names(monkeypatch, tmp_path):
    """Layer names are user input and .svg is served as image/svg+xml."""
    from services import qwen_export

    layer_path = tmp_path / "layer.png"
    Image.new("RGBA", (10, 10), (0, 255, 0, 255)).save(layer_path)
    monkeypatch.setattr(qwen_export, "_resolve_filepath", lambda *_a, **_k: str(layer_path))
    monkeypatch.setattr(qwen_export, "_vectorize_layer_to_svg", lambda _p: "<svg><path d='M0 0'/></svg>")

    hostile = '"><script>alert(1)</script>'
    document = {"layers": [{"filename": "layer.png", "visible": True, "name": hostile}]}
    out = qwen_export.export_session_svg(document, 64, 64).decode("utf-8")

    assert "<script>" not in out
    assert "&lt;script&gt;" in out or "&quot;" in out
