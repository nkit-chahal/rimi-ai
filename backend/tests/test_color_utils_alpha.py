"""Palette extraction and recolor must respect transparency for cut-out motifs."""
from PIL import Image

from color_utils import extract_palette, recolor_image


def _rgba_motif(path):
    img = Image.new('RGBA', (20, 20), (0, 0, 0, 0))
    for x in range(10):
        for y in range(20):
            img.putpixel((x, y), (200, 20, 20, 255))
    img.save(path, 'PNG')


def test_extract_palette_ignores_transparent_pixels(tmp_path):
    path = tmp_path / 'motif.png'
    _rgba_motif(str(path))
    palette = extract_palette(str(path), 1)
    assert len(palette) == 1
    r, g, b = palette[0]['rgb']
    assert r > 150 and g < 60 and b < 60


def test_recolor_preserves_alpha(tmp_path):
    src = tmp_path / 'motif.png'
    out = tmp_path / 'out.png'
    _rgba_motif(str(src))
    recolor_image(str(src), [{'old': '#c81414', 'new': '#1414c8'}], str(out))
    with Image.open(str(out)) as result:
        rgba = result.convert('RGBA')
        assert rgba.getpixel((5, 5)) == (20, 20, 200, 255)
        assert rgba.getpixel((15, 15))[3] == 0


def test_recolor_rgb_input_unchanged_mode(tmp_path):
    src = tmp_path / 'flat.jpg'
    out = tmp_path / 'out.jpg'
    Image.new('RGB', (8, 8), (10, 200, 10)).save(str(src), 'JPEG')
    recolor_image(str(src), [{'old': '#0ac80a', 'new': '#ffffff'}], str(out))
    with Image.open(str(out)) as result:
        assert result.mode == 'RGB'
        r, g, b = result.getpixel((4, 4))
        assert min(r, g, b) > 240
