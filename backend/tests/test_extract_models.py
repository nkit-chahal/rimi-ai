"""Guardrails for pattern extraction model config.

Regression: when all EXTRACT_MODELS had supports_image=False, the Pattern tool
ran text-to-image from a Groq caption and produced results "not even close"
to the uploaded artwork.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from routes.generation import EXTRACT_MODELS, EXTRACT_PROMPT, _run_single_extract, MODEL_TO_CREDITS


def test_image_models_receive_source_image():
    image_models = [m for m in EXTRACT_MODELS if m.get("supports_image")]
    assert image_models, "At least one extract model must support image input"
    for model in image_models:
        assert model.get("input_key"), f"{model['id']} needs input_key"
        assert model.get("prompt"), f"{model['id']} needs an extraction prompt"
        assert "input image" in model["prompt"].lower() or "extract" in model["prompt"].lower()


def test_extract_prompt_asks_for_faithful_motif():
    assert "exact fabric design" in EXTRACT_PROMPT.lower() or "extract" in EXTRACT_PROMPT.lower()
    assert "flat" in EXTRACT_PROMPT.lower()


def test_model_input_keys_match_replicate_apis():
    by_id = {m["id"]: m for m in EXTRACT_MODELS}
    assert by_id["google/nano-banana"]["input_key"] == "image_input"
    assert by_id["google/nano-banana"]["input_list"] is True
    assert by_id["google/nano-banana-2"]["input_key"] == "image_input"
    assert by_id["google/nano-banana-2"]["input_list"] is True
    assert by_id["bytedance/seedream-4.5"]["input_key"] == "image_input"
    assert by_id["bytedance/seedream-4.5"]["input_list"] is True
    assert by_id["xai/grok-imagine-image"]["input_key"] == "image"
    assert by_id["xai/grok-imagine-image"]["input_list"] is False
    assert by_id["openai/gpt-image-2"]["credits"] == 148
    assert by_id["black-forest-labs/flux-2-pro"]["credits"] == 52
    assert by_id["google/imagen-4-ultra"]["credits"] == 69
    assert by_id["google/imagen-4-fast"]["supports_image"] is False
    assert by_id["black-forest-labs/flux-schnell"]["supports_image"] is False


def test_new_pro_model_credits_in_registry():
    assert MODEL_TO_CREDITS["openai/gpt-image-2"] == 148
    assert MODEL_TO_CREDITS["google/imagen-4-ultra"] == 69
    assert MODEL_TO_CREDITS["black-forest-labs/flux-2-pro"] == 35


def test_run_single_extract_builds_image_conditioned_input(monkeypatch):
    """Ensure Replicate is called with the source image, not text-only."""
    captured = {}

    class FakeOutput(list):
        pass

    def fake_run(model_id, input=None):
        captured["model_id"] = model_id
        captured["input"] = input
        return FakeOutput(["https://example.com/out.png"])

    class FakeResp:
        content = b"fake-png-bytes"

        def raise_for_status(self):
            return None

    monkeypatch.setattr("routes.generation.replicate.run", fake_run)
    monkeypatch.setattr(
        "routes.generation.http_requests.get",
        lambda *a, **k: FakeResp(),
    )
    monkeypatch.setattr("routes.generation.log_replicate_call", lambda *a, **k: None)
    monkeypatch.setattr("routes.generation.log_export", lambda *a, **k: None)
    monkeypatch.setattr("routes.generation.storage.sync_to_s3", lambda *a, **k: None)
    monkeypatch.setattr(
        "routes.generation.RESULTS_DIR",
        os.path.join(os.path.dirname(__file__), "_tmp_extract_results"),
    )
    os.makedirs(os.path.join(os.path.dirname(__file__), "_tmp_extract_results"), exist_ok=True)

    model = next(m for m in EXTRACT_MODELS if m["id"] == "google/nano-banana-2")
    data_uri = "data:image/png;base64,aaa"
    result = _run_single_extract(model, data_uri, project_id=1, filename="src.png")

    assert result["error"] is None
    assert result["resultUrl"]
    assert captured["model_id"] == "google/nano-banana-2"
    assert captured["input"]["image_input"] == [data_uri]
    assert "prompt" in captured["input"]
    assert "image_input" in captured["input"]
