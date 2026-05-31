import os
import io
import json
import zipfile
import numpy as np
from PIL import Image
from pantone_utils import quantize_image


def create_color_layers(image_path, n_colors=6):
    """
    Quantize image and create separate RGBA layers per color.
    Returns (layers, palette) where layers is a list of (PIL.Image RGBA, color_index).
    """
    with Image.open(image_path) as img:
        img = img.convert('RGB')
        img_np = np.array(img)

    quantized, palette, labels_2d = quantize_image(image_path, n_colors)
    h, w = labels_2d.shape

    layers = []
    for i in range(n_colors):
        mask = (labels_2d == i)

        rgba = np.zeros((h, w, 4), dtype=np.uint8)
        rgba[mask, 0] = img_np[mask, 0]
        rgba[mask, 1] = img_np[mask, 1]
        rgba[mask, 2] = img_np[mask, 2]
        rgba[mask, 3] = 255

        layer_img = Image.fromarray(rgba, 'RGBA')
        layers.append(layer_img)

    return layers, palette


def export_zip(image_path, n_colors, output_path):
    """
    Export color-separated layers as a ZIP of transparent PNGs + manifest.json.
    """
    layers, palette = create_color_layers(image_path, n_colors)

    with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        # Include original image
        with open(image_path, 'rb') as f:
            zf.writestr('original.png', f.read())

        # Include each color layer
        manifest_layers = []
        for i, layer_img in enumerate(layers):
            color_info = palette[i] if i < len(palette) else {}
            hex_color = color_info.get('hex', f'#{i:02x}{i:02x}{i:02x}')
            safe_hex = hex_color.replace('#', '')

            pantone_name = ''
            if color_info.get('pantoneMatches'):
                pantone_name = color_info['pantoneMatches'][0].get('name', '')
            safe_pantone = pantone_name.replace(' ', '_').replace('/', '-')

            filename = f"layer_{i+1}_{safe_hex}"
            if safe_pantone:
                filename += f"_{safe_pantone}"
            filename += ".png"

            buf = io.BytesIO()
            layer_img.save(buf, format='PNG')
            buf.seek(0)
            zf.writestr(filename, buf.getvalue())

            manifest_layers.append({
                'index': i + 1,
                'hex': hex_color,
                'rgb': color_info.get('rgb', []),
                'weight': color_info.get('weight', 0),
                'pantone': color_info.get('pantoneMatches', []),
                'filename': filename,
            })

        manifest = {
            'source': os.path.basename(image_path),
            'numColors': n_colors,
            'layers': manifest_layers,
        }
        zf.writestr('manifest.json', json.dumps(manifest, indent=2))

    return palette


def export_tiff(image_path, n_colors, output_path, dpi=300):
    """
    Export color-separated layers as a multi-page TIFF.
    Each page is one color separation plate.
    """
    layers, palette = create_color_layers(image_path, n_colors)

    if not layers:
        return palette

    first = layers[0]
    rest = layers[1:]

    first.save(
        output_path,
        save_all=True,
        append_images=rest,
        compression='tiff_deflate',
        dpi=(dpi, dpi),
    )

    return palette
