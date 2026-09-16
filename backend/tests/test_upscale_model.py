"""Super Resolution depends on a hosted Replicate model, and those get retired.

google/upscaler was a thin wrapper over Google's imagen-4.0-upscale-preview. Google removed
that model, so the Replicate page still resolved but every run failed with a 404 from Vertex
AI. These tests keep the model name in one configurable place and give a live check that names
a dead upscaler before users hit it.
"""
import re
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]


def test_upscale_route_does_not_hardcode_a_model():
    """The upscale call must go through config.REPLICATE_UPSCALE_MODEL."""
    source = (BACKEND / 'routes' / 'vectorize.py').read_text(encoding='utf-8')
    calls = re.findall(r'replicate\.run\(\s*([^,\n]+)', source)
    hardcoded = [c.strip() for c in calls if c.strip().startswith(('"', "'"))]
    assert 'REPLICATE_UPSCALE_MODEL' in source
    assert not any('upscaler' in c for c in hardcoded), f'hardcoded upscaler model: {hardcoded}'


def test_config_exposes_an_overridable_upscale_model():
    from config import REPLICATE_UPSCALE_MODEL
    assert REPLICATE_UPSCALE_MODEL
    assert '/' in REPLICATE_UPSCALE_MODEL


def test_upscale_factor_is_converted_to_an_integer_scale():
    """The UI sends 'x2'/'x4'; real-esrgan wants an int. Guard the conversion."""
    source = (BACKEND / 'routes' / 'vectorize.py').read_text(encoding='utf-8')
    assert "lstrip('x')" in source, 'upscale_factor is no longer converted to an int scale'
    assert '"scale": scale' in source


def _replicate_token():
    try:
        from config import os as _os  # noqa: F401
        import os
        return bool(os.getenv('REPLICATE_API_TOKEN'))
    except Exception:
        return False


@pytest.mark.live
@pytest.mark.skipif(not _replicate_token(), reason='needs a live REPLICATE_API_TOKEN')
def test_configured_upscaler_is_live():
    """Smoke test: the configured model must actually run, not just exist as a page.

    google/upscaler would pass an existence check and still fail here, which is exactly the
    failure mode this guards against.
    """
    import base64
    import io

    import replicate
    from PIL import Image

    from config import REPLICATE_UPSCALE_MODEL

    image = Image.new('RGB', (64, 64), (200, 120, 90))
    buffer = io.BytesIO()
    image.save(buffer, format='PNG')
    uri = 'data:image/png;base64,' + base64.b64encode(buffer.getvalue()).decode()

    output = replicate.run(REPLICATE_UPSCALE_MODEL, input={'image': uri, 'scale': 2})
    url = str(output[0]) if isinstance(output, list) and output else str(output)
    assert url.startswith('http'), f'unexpected output from {REPLICATE_UPSCALE_MODEL}: {url[:100]}'
