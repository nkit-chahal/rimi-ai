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
    assert by_id["black-forest-labs/flux-schnell"]["supports_image"] is False


def test_new_pro_model_credits_in_registry():
    assert MODEL_TO_CREDITS["openai/gpt-image-2"] == 148
    assert MODEL_TO_CREDITS["black-forest-labs/flux-2-pro"] == 35


def test_run_single_extract_builds_image_conditioned_input(monkeypatch, tmp_path):
    """Ensure Replicate is called with the source image, not text-only.

    Writes into pytest's tmp_path rather than a folder inside the repo. The result
    filename carries a fresh uuid, so pointing RESULTS_DIR at backend/tests left one
    more file in the working tree on every single run.
    """
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

    monkeypatch.setattr("routes.generation.run_model", fake_run)
    monkeypatch.setattr(
        "routes.generation.http_requests.get",
        lambda *a, **k: FakeResp(),
    )
    monkeypatch.setattr("routes.generation.log_replicate_call", lambda *a, **k: None)
    monkeypatch.setattr("routes.generation.log_export", lambda *a, **k: None)
    monkeypatch.setattr("routes.generation.storage.sync_to_s3", lambda *a, **k: None)
    monkeypatch.setattr("routes.generation.RESULTS_DIR", str(tmp_path))

    model = next(m for m in EXTRACT_MODELS if m["id"] == "google/nano-banana-2")
    data_uri = "data:image/png;base64,aaa"
    result = _run_single_extract(model, data_uri, project_id=1, filename="src.png")

    assert result["error"] is None
    assert result["resultUrl"]
    assert captured["model_id"] == "google/nano-banana-2"
    assert captured["input"]["image_input"] == [data_uri]
    assert "prompt" in captured["input"]
    assert "image_input" in captured["input"]


def test_retired_models_are_not_selectable():
    """A retired model left in a picker is a card the user can click that always fails.

    google/imagen-4-fast and google/imagen-4-ultra were verified dead on 2026-09-14: both return
    404 from us-central1-aiplatform.googleapis.com for imagen-4.0-*-generate-001, while their
    Replicate pages still show "Warm". google/upscaler went the same way earlier.

    This checks selectability, not mere mention. MODEL_TO_CREDITS deliberately keeps a
    google/upscaler entry so historical replicate_logs rows still resolve to a credit value;
    that is a lookup, not an offer.
    """
    import re
    from pathlib import Path

    import plan_tiers

    retired = {"google/imagen-4-fast", "google/imagen-4-ultra", "google/upscaler"}
    offenders = []

    for model in retired & {m["id"] for m in EXTRACT_MODELS}:
        offenders.append(f"EXTRACT_MODELS offers {model}")

    for name in ("NORMAL_INSPIRE_MODELS", "PRO_INSPIRE_MODELS",
                 "NORMAL_EXTRACT_MODELS", "PRO_EXTRACT_MODELS"):
        for model in retired & set(getattr(plan_tiers, name)):
            offenders.append(f"plan_tiers.{name} offers {model}")

    # Frontend pickers declare their models as `id: '<model>'` entries.
    root = Path(__file__).resolve().parents[2]
    for path in (root / "src").rglob("*.js*"):
        if "node_modules" in str(path):
            continue
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            for model in retired:
                if re.search(rf"id:\s*['\"]{re.escape(model)}['\"]", line):
                    offenders.append(f"{path.relative_to(root)}:{n} offers {model}")

    assert not offenders, "retired models are still selectable:\n  " + "\n  ".join(offenders)


def test_every_offered_extract_model_has_a_credit_price():
    """A model in the picker with no price would be generated for free."""
    missing = [m["id"] for m in EXTRACT_MODELS
               if not m.get("credits") and m["id"] not in MODEL_TO_CREDITS]
    assert not missing, missing
