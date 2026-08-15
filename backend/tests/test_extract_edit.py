from routes.generation import (
    EXTRACT_MODELS,
    _extract_image_basename,
    build_extract_edit_input,
    load_extract_image_bytes,
)


def _model(model_id):
    return next(m for m in EXTRACT_MODELS if m["id"] == model_id)


def test_basename_strips_host_and_query():
    assert _extract_image_basename("/results/extract_abc.png") == "extract_abc.png"
    assert _extract_image_basename("https://api.rimiai.pro/results/extract_abc.png?token=x") == "extract_abc.png"


def test_load_extract_image_bytes_from_storage(monkeypatch):
    monkeypatch.setattr(
        "routes.generation.storage.get_file",
        lambda kind, name: (b"png-bytes", "image/png") if kind == "results" and name == "tile.png" else (None, None),
    )
    assert load_extract_image_bytes("/results/tile.png") == b"png-bytes"
    assert load_extract_image_bytes("https://api.example.com/results/tile.png") == b"png-bytes"


def test_image_model_edit_includes_source_image():
    nano = _model("google/nano-banana")
    payload = build_extract_edit_input(nano, "make flowers smaller", "data:image/png;base64,AAA")
    assert payload["image_input"] == ["data:image/png;base64,AAA"]
    assert "make flowers smaller" in payload["prompt"]
    assert "image" not in payload


def test_text_only_edit_does_not_send_image_keys():
    flux = _model("black-forest-labs/flux-schnell")
    payload = build_extract_edit_input(
        flux,
        "shift to navy",
        "data:image/png;base64,AAA",
        image_description="rose motifs on cream",
    )
    assert "image" not in payload
    assert "image_input" not in payload
    assert "input_images" not in payload
    assert "rose motifs on cream" in payload["prompt"]
    assert "shift to navy" in payload["prompt"]


def test_gpt_image_edit_keeps_extra_input():
    gpt = _model("openai/gpt-image-2")
    payload = build_extract_edit_input(gpt, "cleaner background", "data:image/png;base64,AAA")
    assert payload["input_images"] == ["data:image/png;base64,AAA"]
    assert payload["quality"] == "high"
