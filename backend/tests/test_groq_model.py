"""The Groq vision model is a moving target: hosted models get retired without notice.

meta-llama/llama-4-scout-17b-16e-instruct was removed and every Groq-backed feature
(seamless, mockups, layer captions, OCR, semantic select) started returning
404 model_not_found. These tests keep the model name in one configurable place and
provide a live check that names a dead model before users hit it.
"""
import re
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
SOURCE_DIRS = ['routes', 'services']


def _python_sources():
    for folder in SOURCE_DIRS:
        for path in (BACKEND / folder).rglob('*.py'):
            if '__pycache__' not in str(path):
                yield path
    yield BACKEND / 'config.py'


def test_no_module_hardcodes_a_groq_model():
    """Every Groq call must go through config.GROQ_VISION_MODEL."""
    offenders = []
    for path in _python_sources():
        if path.name == 'config.py':
            continue
        text = path.read_text(encoding='utf-8')
        for match in re.finditer(r'model\s*=\s*["\']([^"\']+)["\']', text):
            name = match.group(1)
            # Replicate model ids are vendor/name and handled separately; Groq calls are the
            # ones made through groq_client, and those must use the shared constant.
            if 'groq_client' in text and ('llama' in name or 'qwen' in name or 'gpt-oss' in name):
                offenders.append(f'{path.name}: {name}')
    assert offenders == [], f'hardcoded Groq model names found: {offenders}'


def test_config_exposes_an_overridable_model():
    from config import GROQ_VISION_MODEL
    assert GROQ_VISION_MODEL
    assert '/' in GROQ_VISION_MODEL  # vendor-qualified id


def _groq_key_available():
    # config.py loads backend/.env, so check after import rather than trusting the process env.
    try:
        from config import groq_client
        return bool(groq_client.api_key)
    except Exception:
        return False


@pytest.mark.skipif(not _groq_key_available(), reason='needs a live GROQ_API_KEY')
def test_configured_model_is_live_and_accepts_images():
    """Smoke test against the real API so a retired model is caught here, not in production."""
    import base64
    import io as _io

    from PIL import Image

    from config import GROQ_VISION_MODEL, groq_client

    image = Image.new('RGB', (64, 64), (220, 30, 30))
    buffer = _io.BytesIO()
    image.save(buffer, format='PNG')
    uri = 'data:image/png;base64,' + base64.b64encode(buffer.getvalue()).decode()

    completion = groq_client.chat.completions.create(
        model=GROQ_VISION_MODEL,
        messages=[{'role': 'user', 'content': [
            {'type': 'image_url', 'image_url': {'url': uri}},
            {'type': 'text', 'text': 'Name the dominant colour in one word.'},
        ]}],
        temperature=0.1,
        max_completion_tokens=10,
    )
    reply = completion.choices[0].message.content.strip()
    assert reply, 'model returned an empty reply'
    # Reasoning traces would break the JSON parsing in layer OCR / semantic select.
    assert '<think>' not in reply, f'{GROQ_VISION_MODEL} emits reasoning blocks; pick a non-reasoning model'
