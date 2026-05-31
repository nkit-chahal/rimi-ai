import numpy as np
from PIL import Image
from sklearn.cluster import MiniBatchKMeans

def hex_to_rgb(hex_str):
    hex_str = hex_str.lstrip('#')
    return tuple(int(hex_str[i:i+2], 16) for i in (0, 2, 4))

def rgb_to_hex(rgb_tuple):
    return '#{:02x}{:02x}{:02x}'.format(int(rgb_tuple[0]), int(rgb_tuple[1]), int(rgb_tuple[2]))

def extract_palette(image_path, num_colors=5):
    """
    Extract dominant colors from an image using MiniBatchKMeans.
    """
    with Image.open(image_path) as img:
        img = img.convert('RGB')
        # Resize for speed
        img.thumbnail((300, 300))
        img_np = np.array(img)
        
    pixels = img_np.reshape(-1, 3)
    
    kmeans = MiniBatchKMeans(n_clusters=num_colors, random_state=42, n_init=3)
    kmeans.fit(pixels)
    
    colors = kmeans.cluster_centers_
    labels = kmeans.labels_
    
    # Calculate weights/proportions
    counts = np.bincount(labels)
    total = len(labels)
    
    palette = []
    for count, color in zip(counts, colors):
        weight = count / total
        palette.append({
            'hex': rgb_to_hex(color),
            'rgb': [int(c) for c in color],
            'weight': float(weight)
        })
        
    # Sort by weight descending
    palette.sort(key=lambda x: x['weight'], reverse=True)
    return palette

def recolor_image(image_path, color_mapping, output_path):
    """
    Recolor an image by replacing old colors with new colors.
    color_mapping is a list of dicts: [{'old': '#ff0000', 'new': '#00ff00'}, ...]
    """
    with Image.open(image_path) as img:
        img = img.convert('RGB')
        img_np = np.array(img, dtype=np.float32)
        
    original_shape = img_np.shape
    pixels = img_np.reshape(-1, 3)
    
    old_colors = np.array([hex_to_rgb(m['old']) for m in color_mapping])
    new_colors = np.array([hex_to_rgb(m['new']) for m in color_mapping])
    
    if len(old_colors) == 0:
        # No mapping, just save original
        Image.fromarray(img_np.astype(np.uint8)).save(output_path)
        return output_path
        
    # Compute distance from each pixel to each old_color
    # Shape of pixels: (N, 3), Shape of old_colors: (K, 3)
    # Using broadcasting to compute distances
    diff = pixels[:, np.newaxis, :] - old_colors[np.newaxis, :, :]
    dist = np.sum(diff**2, axis=2)
    
    # Find the index of the closest old color for each pixel
    closest_color_idx = np.argmin(dist, axis=1)
    
    # Replace pixel with the corresponding new color
    new_pixels = new_colors[closest_color_idx]
    
    # Optional: preserve original shading by applying ratio of luminance
    # L = 0.299*R + 0.587*G + 0.114*B
    # This might be needed if original has gradients, but for flat vector-like patterns
    # direct mapping is usually preferred by print designers. We will stick to flat mapping.
    
    new_img_np = new_pixels.reshape(original_shape).astype(np.uint8)
    Image.fromarray(new_img_np).save(output_path)
    
    return output_path
