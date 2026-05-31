import os
import json
import numpy as np
from PIL import Image
from sklearn.cluster import MiniBatchKMeans

# Try to use colour-science for perceptual accuracy, fall back to simple RGB if unavailable
try:
    from colour import sRGB_to_XYZ, XYZ_to_Lab
    from colour.difference import delta_E_CIE2000
    HAS_COLOUR = True
except ImportError:
    HAS_COLOUR = False

# Load Pantone dataset once at module import
_PANTONE_DB = None
_PANTONE_LAB_CACHE = None

def _hex_to_rgb(hex_str):
    hex_str = hex_str.lstrip('#')
    return tuple(int(hex_str[i:i+2], 16) for i in (0, 2, 4))

def _rgb_to_hex(rgb):
    return '#{:02x}{:02x}{:02x}'.format(int(rgb[0]), int(rgb[1]), int(rgb[2]))

def _rgb_to_lab(rgb):
    """Convert RGB (0-255) to CIE L*a*b* using colour-science."""
    if HAS_COLOUR:
        rgb_norm = np.array(rgb, dtype=np.float64) / 255.0
        # Clip to valid range
        rgb_norm = np.clip(rgb_norm, 0.0, 1.0)
        xyz = sRGB_to_XYZ(rgb_norm)
        lab = XYZ_to_Lab(xyz)
        return lab
    else:
        # Fallback: simple normalized RGB (not perceptually uniform)
        return np.array(rgb, dtype=np.float64)

def _load_pantone_db():
    global _PANTONE_DB, _PANTONE_LAB_CACHE
    if _PANTONE_DB is not None:
        return _PANTONE_DB
    
    db_path = os.path.join(os.path.dirname(__file__), 'pantone_data.json')
    if not os.path.exists(db_path):
        print(f"[pantone_utils] Warning: pantone_data.json not found at {db_path}")
        _PANTONE_DB = []
        _PANTONE_LAB_CACHE = np.array([])
        return _PANTONE_DB
    
    with open(db_path, 'r', encoding='utf-8') as f:
        _PANTONE_DB = json.load(f)
    
    # Pre-compute LAB values for all Pantone colors
    lab_list = []
    for entry in _PANTONE_DB:
        rgb = _hex_to_rgb(entry['hex'])
        lab = _rgb_to_lab(rgb)
        lab_list.append(lab)
        entry['rgb'] = list(rgb)
        entry['lab'] = lab.tolist()
    
    _PANTONE_LAB_CACHE = np.array(lab_list)
    print(f"[pantone_utils] Loaded {len(_PANTONE_DB)} Pantone colors.")
    return _PANTONE_DB

def match_to_pantone(rgb, top_n=3):
    """
    Match an RGB color (0-255) to the nearest Pantone colors.
    Returns list of dicts: [{'name': str, 'hex': str, 'rgb': list, 'deltaE': float}, ...]
    """
    db = _load_pantone_db()
    if not db:
        return []
    
    target_lab = _rgb_to_lab(rgb)
    
    if HAS_COLOUR:
        # Vectorized Delta E 2000 calculation
        distances = np.array([
            float(delta_E_CIE2000(target_lab, np.array(entry['lab'])))
            for entry in db
        ])
    else:
        # Fallback: Euclidean distance in RGB
        pantone_rgbs = np.array([entry['rgb'] for entry in db], dtype=np.float64)
        target_arr = np.array(rgb, dtype=np.float64)
        distances = np.sqrt(np.sum((pantone_rgbs - target_arr) ** 2, axis=1))
    
    # Get top N closest
    top_indices = np.argsort(distances)[:top_n]
    
    results = []
    for idx in top_indices:
        entry = db[idx]
        results.append({
            'name': entry['name'],
            'hex': entry['hex'],
            'rgb': entry['rgb'],
            'deltaE': round(float(distances[idx]), 2)
        })
    
    return results

def quantize_image(image_path, n_colors=6, brand_palette=None):
    """
    Quantize an image. If brand_palette (list of hex strings) is provided, 
    pixels are mapped strictly to the nearest brand color.
    Otherwise, uses K-Means clustering.
    Returns (quantized_image_array, palette_list, labels_2d).
    """
    with Image.open(image_path) as img:
        img = img.convert('RGB')
        img_np = np.array(img)
    
    h, w, d = img_np.shape
    pixels = img_np.reshape((h * w, d)).astype(np.float32)
    
    if brand_palette and len(brand_palette) > 0:
        # Convert hex to RGB array
        from color_utils import _hex_to_rgb
        brand_colors = np.array([_hex_to_rgb(hx) for hx in brand_palette], dtype=np.float32)
        n_colors = len(brand_colors)
        
        # Find nearest brand color for each pixel
        from sklearn.metrics import pairwise_distances_argmin
        labels = pairwise_distances_argmin(pixels, brand_colors)
        palette = brand_colors.astype(np.uint8)
    else:
        kmeans = MiniBatchKMeans(n_clusters=n_colors, random_state=42, n_init=3)
        labels = kmeans.fit_predict(pixels)
        palette = kmeans.cluster_centers_.astype(np.uint8)
    
    quantized = palette[labels].reshape((h, w, d))
    labels_2d = labels.reshape((h, w))
    
    # Calculate weights
    counts = np.bincount(labels, minlength=n_colors)
    total = len(labels)
    weights = counts / total
    
    palette_list = []
    for i, (color, weight) in enumerate(zip(palette, weights)):
        r, g, b = int(color[0]), int(color[1]), int(color[2])
        pantone_matches = match_to_pantone((r, g, b), top_n=3)
        palette_list.append({
            'hex': _rgb_to_hex(color),
            'rgb': [r, g, b],
            'weight': round(float(weight), 4),
            'pantoneMatches': pantone_matches
        })
    
    # Sort by weight descending (but keep original index mapping)
    palette_list.sort(key=lambda x: x['weight'], reverse=True)
    
    return quantized, palette_list, labels_2d

def quantize_and_save(image_path, n_colors, output_path, brand_palette=None):
    """
    Quantize image and save result. Returns the palette with Pantone matches.
    """
    quantized_array, palette, labels_2d = quantize_image(image_path, n_colors, brand_palette)
    Image.fromarray(quantized_array).save(output_path)
    return palette

# Pre-load the database on import
_load_pantone_db()
