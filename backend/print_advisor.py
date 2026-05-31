import numpy as np
from PIL import Image
from sklearn.cluster import MiniBatchKMeans


# --------------- File Preparation Requirements ---------------

_FILE_PREP = {
    "screen": {
        "method": "Screen Printing",
        "color_mode": "Spot colors (indexed)",
        "file_format": "PSD/TIFF with separated layers per color",
        "resolution": "300 DPI at print size",
        "notes": "Each color needs a separate screen. Provide color separations as individual layers. "
                 "No gradients — all fills must be flat/solid. Specify Pantone references for each color.",
        "max_colors": 8,
    },
    "rotary": {
        "method": "Rotary Printing",
        "color_mode": "Spot colors (indexed)",
        "file_format": "TIFF/PSD with seamless repeat defined",
        "resolution": "300 DPI at print size",
        "notes": "Pattern must tile seamlessly in the print direction. Each color requires an engraved roller. "
                 "Provide exact repeat dimensions (width × height). Max 16 colors typical.",
        "max_colors": 16,
    },
    "digital": {
        "method": "Digital Printing",
        "color_mode": "CMYK or RGB (full color)",
        "file_format": "TIFF (preferred) or high-quality PNG",
        "resolution": "150–300 DPI at print size",
        "notes": "No color separation needed. Supports photorealistic imagery, gradients, and unlimited colors. "
                 "Ensure color profile is embedded (sRGB or Adobe RGB). Larger files = sharper output.",
        "max_colors": None,
    },
    "sublimation": {
        "method": "Sublimation Printing",
        "color_mode": "CMYK",
        "file_format": "TIFF or PNG, mirrored horizontally",
        "resolution": "200–300 DPI at print size",
        "notes": "Works ONLY on synthetic fabrics (polyester, nylon) or poly-coated substrates. "
                 "Colors appear slightly more vibrant after transfer. White areas = fabric color (no white ink). "
                 "Provide artwork mirrored for transfer.",
        "max_colors": None,
    },
    "block": {
        "method": "Block Printing",
        "color_mode": "Spot colors (1–4 max)",
        "file_format": "Vector (SVG/AI) or high-contrast TIFF",
        "resolution": "300+ DPI or vector",
        "notes": "Design should have bold, simple shapes — fine lines below 1 mm may not transfer. "
                 "Each color is a separate block carved by hand. Slight registration offsets are expected "
                 "and part of the artisanal character.",
        "max_colors": 4,
    },
    "discharge": {
        "method": "Discharge Printing",
        "color_mode": "Spot colors (indexed)",
        "file_format": "PSD/TIFF with separated layers",
        "resolution": "300 DPI at print size",
        "notes": "Best on dark-colored natural fabrics (cotton, linen). The discharge agent removes fabric dye "
                 "and can simultaneously apply new color. Not all dyes are dischargeable — test with fabric mill. "
                 "Provide halftone-ready artwork for tonal effects.",
        "max_colors": 6,
    },
}


def get_file_prep_requirements(method):
    """Return file preparation requirements for each print method.

    Parameters
    ----------
    method : str
        One of 'screen', 'rotary', 'digital', 'sublimation', 'block', 'discharge'.

    Returns
    -------
    dict or None
        File prep info dict, or None if the method key is unrecognised.
    """
    return _FILE_PREP.get(method.lower())


# --------------- Image Analysis Helpers ---------------

def _count_effective_colors(img_rgb, max_sample=100000):
    """Quantize the image and count effective distinct colors."""
    img_np = np.array(img_rgb)
    h, w, _ = img_np.shape
    pixels = img_np.reshape(-1, 3).astype(np.float32)

    # Sub-sample for speed
    if len(pixels) > max_sample:
        rng = np.random.RandomState(42)
        indices = rng.choice(len(pixels), max_sample, replace=False)
        pixels = pixels[indices]

    # Try increasing cluster counts until inertia flattens (elbow method)
    best_k = 2
    prev_inertia = None
    for k in range(2, 33):
        km = MiniBatchKMeans(n_clusters=k, random_state=42, n_init=3, max_iter=50)
        km.fit(pixels)
        inertia = km.inertia_
        if prev_inertia is not None:
            ratio = inertia / prev_inertia
            # When adding another cluster gives < 15 % improvement, stop
            if ratio > 0.85:
                best_k = k - 1
                break
        prev_inertia = inertia
        best_k = k

    return best_k


def _detect_gradients(img_rgb, sample_stride=2):
    """Measure gradient presence by computing local color variance between adjacent pixels.

    Returns (has_gradients: bool, gradient_score: float 0–1).
    """
    img_np = np.array(img_rgb).astype(np.float32)
    # Sub-sample for speed
    sub = img_np[::sample_stride, ::sample_stride]

    # Horizontal and vertical differences
    h_diff = np.abs(sub[:, 1:, :] - sub[:, :-1, :])
    v_diff = np.abs(sub[1:, :, :] - sub[:-1, :, :])

    # Mean per-channel difference
    mean_diff = (h_diff.mean() + v_diff.mean()) / 2.0

    # Standard deviation of differences — high std means some smooth + some sharp = gradient regions
    std_diff = (h_diff.std() + v_diff.std()) / 2.0

    # Normalise to 0-1 range (empirically tuned for 8-bit images)
    gradient_score = float(np.clip(mean_diff / 40.0, 0.0, 1.0))

    # If mean diff is moderate AND std is high, there are likely gradient areas
    has_gradients = gradient_score > 0.15 or std_diff > 20.0

    return has_gradients, round(gradient_score, 3)


def _measure_min_feature_size(img_rgb, threshold_size=500):
    """Estimate the smallest significant connected component in pixels.

    Uses a grayscale threshold + simple flood-fill approximation via labelling.
    Returns (min_feature_px, image_total_px).
    """
    try:
        from scipy import ndimage
    except ImportError:
        # Fallback when scipy is unavailable — return a rough estimate
        return 10, img_rgb.size[0] * img_rgb.size[1]

    gray = np.array(img_rgb.convert("L"))
    # Binary threshold (Otsu-like: use median)
    med = np.median(gray)
    binary = gray < med

    labelled, num_features = ndimage.label(binary)
    if num_features == 0:
        return gray.size, gray.size

    component_sizes = ndimage.sum(binary, labelled, range(1, num_features + 1))
    # Filter tiny noise components (< 4 px)
    significant = [s for s in component_sizes if s >= 4]
    if not significant:
        return gray.size, gray.size

    min_feature = int(min(significant))
    return min_feature, gray.size


def _classify_detail_level(color_count, has_gradients, gradient_score, min_feature_px, total_px):
    """Classify into low / medium / high / photorealistic."""
    feature_ratio = min_feature_px / max(total_px, 1)

    if has_gradients and gradient_score > 0.45 and color_count > 20:
        return "photorealistic"
    if color_count > 12 or (has_gradients and gradient_score > 0.3):
        return "high"
    if color_count > 5 or gradient_score > 0.15 or feature_ratio < 0.001:
        return "medium"
    return "low"


def _has_transparency(image_path):
    """Check if the image file has an alpha channel with actual transparency."""
    with Image.open(image_path) as img:
        if img.mode in ("RGBA", "LA", "PA"):
            alpha = np.array(img.getchannel("A"))
            return bool(np.any(alpha < 255))
        return False


# --------------- Scoring Engine ---------------

_SYNTHETIC_FABRICS = {"polyester", "nylon", "spandex", "lycra", "poly-blend", "synthetic"}
_DARK_FABRICS = {"black", "navy", "dark", "charcoal", "indigo"}


def _score_screen(color_count, has_gradients, detail_level, fabric_type, production_volume):
    score = 60
    reasoning = []

    # Color count is the primary driver
    if color_count <= 4:
        score += 25
        reasoning.append(f"Excellent — only {color_count} colors, ideal for screen separation")
    elif color_count <= 8:
        score += 15
        reasoning.append(f"{color_count} colors is within the practical screen limit")
    elif color_count <= 12:
        score -= 10
        reasoning.append(f"{color_count} colors is at the upper limit — costs increase per screen")
    else:
        score -= 35
        reasoning.append(f"Too many colors ({color_count}) — each needs a separate screen")

    if has_gradients:
        score -= 20
        reasoning.append("Gradients require halftone simulation, reducing quality")

    if detail_level in ("high", "photorealistic"):
        score -= 15
        reasoning.append("High detail is hard to reproduce with flat screen inks")

    if production_volume and production_volume >= 500:
        score += 10
        reasoning.append(f"Volume of {production_volume} yds makes screen setup cost-effective")
    elif production_volume and production_volume < 100:
        score -= 15
        reasoning.append("Low volume — screen setup cost will be amortized over too few yards")

    return max(0, min(100, score)), "; ".join(reasoning)


def _score_rotary(color_count, has_gradients, detail_level, fabric_type, production_volume):
    score = 55
    reasoning = []

    if color_count <= 8:
        score += 15
        reasoning.append(f"{color_count} colors fits well within rotary engraving limits")
    elif color_count <= 16:
        score += 5
        reasoning.append(f"{color_count} colors is feasible but adds roller cost")
    else:
        score -= 25
        reasoning.append(f"Too many colors ({color_count}) for rotary — each needs an engraved roller")

    if has_gradients:
        score -= 10
        reasoning.append("Gradients are partially reproducible via engraving line density")

    if production_volume and production_volume >= 1000:
        score += 20
        reasoning.append(f"High volume ({production_volume} yds) is where rotary excels — lowest per-yard cost")
    elif production_volume and production_volume >= 500:
        score += 5
        reasoning.append("Moderate volume can justify roller engraving cost")
    elif production_volume and production_volume < 200:
        score -= 20
        reasoning.append("Low volume makes roller engraving cost-prohibitive")

    return max(0, min(100, score)), "; ".join(reasoning)


def _score_digital(color_count, has_gradients, detail_level, fabric_type, production_volume):
    score = 65
    reasoning = []

    if color_count > 12:
        score += 20
        reasoning.append(f"Unlimited color capability handles {color_count}+ colors effortlessly")
    elif color_count > 6:
        score += 10
        reasoning.append(f"Handles {color_count} colors with no extra cost per color")
    else:
        score += 0
        reasoning.append(f"Only {color_count} colors — digital works but simpler methods may be cheaper")

    if has_gradients:
        score += 15
        reasoning.append("Excellent gradient reproduction — no halftoning needed")

    if detail_level == "photorealistic":
        score += 15
        reasoning.append("Best method for photorealistic imagery")
    elif detail_level == "high":
        score += 10
        reasoning.append("High detail prints crisply with digital inkjet")

    if production_volume and production_volume > 2000:
        score -= 15
        reasoning.append(f"Per-yard cost at {production_volume} yds is significantly higher than rotary/screen")
    elif production_volume and production_volume <= 100:
        score += 10
        reasoning.append("No minimum order — perfect for sampling and short runs")

    return max(0, min(100, score)), "; ".join(reasoning)


def _score_sublimation(color_count, has_gradients, detail_level, fabric_type, production_volume):
    score = 50
    reasoning = []

    fabric_lower = (fabric_type or "").lower()
    is_synthetic = any(f in fabric_lower for f in _SYNTHETIC_FABRICS) if fabric_lower else False

    if is_synthetic:
        score += 25
        reasoning.append(f"'{fabric_type}' is synthetic — sublimation bonds perfectly")
    elif fabric_lower and not is_synthetic:
        score -= 30
        reasoning.append(f"'{fabric_type}' is likely natural fiber — sublimation requires polyester/synthetic")
    else:
        reasoning.append("Fabric type unknown — sublimation requires synthetic fabrics (polyester/nylon)")

    if has_gradients or detail_level in ("high", "photorealistic"):
        score += 10
        reasoning.append("Great for gradients and vibrant, all-over prints")

    if color_count > 8:
        score += 5
        reasoning.append(f"Handles {color_count} colors with full CMYK process")

    if production_volume and production_volume >= 50:
        score += 5
        reasoning.append("Minimum order of ~50 yards is met")
    elif production_volume and production_volume < 50:
        score -= 5
        reasoning.append("Below typical 50-yard minimum for sublimation")

    return max(0, min(100, score)), "; ".join(reasoning)


def _score_block(color_count, has_gradients, detail_level, fabric_type, production_volume):
    score = 40
    reasoning = []

    if color_count <= 2:
        score += 30
        reasoning.append(f"Only {color_count} color(s) — ideal for hand-carved blocks")
    elif color_count <= 4:
        score += 15
        reasoning.append(f"{color_count} colors is within practical block printing range")
    else:
        score -= 25
        reasoning.append(f"{color_count} colors is too many — block printing works best with ≤4 colors")

    if has_gradients:
        score -= 25
        reasoning.append("Gradients cannot be reproduced with block printing")

    if detail_level in ("high", "photorealistic"):
        score -= 20
        reasoning.append("Fine details are lost in the hand-printing process")
    elif detail_level == "low":
        score += 10
        reasoning.append("Simple, bold design is perfect for block printing's artisanal aesthetic")

    if production_volume and production_volume <= 50:
        score += 10
        reasoning.append("Small batch is where block printing's handmade value shines")
    elif production_volume and production_volume > 200:
        score -= 15
        reasoning.append(f"Volume of {production_volume} yds is too high — block printing is slow and manual")

    return max(0, min(100, score)), "; ".join(reasoning)


def _score_discharge(color_count, has_gradients, detail_level, fabric_type, production_volume):
    score = 45
    reasoning = []

    fabric_lower = (fabric_type or "").lower()
    is_dark = any(f in fabric_lower for f in _DARK_FABRICS) if fabric_lower else False

    if is_dark:
        score += 20
        reasoning.append(f"Dark fabric '{fabric_type}' is ideal for discharge — removes dye for soft hand-feel")
    elif fabric_lower:
        reasoning.append(f"Discharge works best on dark fabrics — '{fabric_type}' may not be ideal")
    else:
        reasoning.append("Fabric color unknown — discharge printing is best on dark-dyed natural fabrics")

    if color_count <= 4:
        score += 15
        reasoning.append(f"{color_count} colors works well with discharge + pigment overprint")
    elif color_count <= 8:
        score += 5
        reasoning.append(f"{color_count} colors is feasible with discharge")
    else:
        score -= 15
        reasoning.append(f"Too many colors ({color_count}) for discharge process")

    if has_gradients:
        score -= 10
        reasoning.append("Gradients require halftone techniques with discharge")

    if production_volume and production_volume >= 200:
        score += 10
        reasoning.append(f"Volume of {production_volume} yds justifies discharge setup")
    elif production_volume and production_volume < 50:
        score -= 10
        reasoning.append("Low volume may not justify discharge setup and testing")

    return max(0, min(100, score)), "; ".join(reasoning)


# --------------- Main Analysis Function ---------------

_METHOD_COST = {
    "screen":      {"cost_estimate": "$2–5 / yard",  "min_order": "500 yards"},
    "rotary":      {"cost_estimate": "$1.5–4 / yard", "min_order": "1,000 yards"},
    "digital":     {"cost_estimate": "$8–20 / yard",  "min_order": "No minimum"},
    "sublimation": {"cost_estimate": "$5–12 / yard",  "min_order": "50 yards"},
    "block":       {"cost_estimate": "$15–40 / yard", "min_order": "10 yards"},
    "discharge":   {"cost_estimate": "$3–8 / yard",   "min_order": "200 yards"},
}


def analyze_pattern_for_printing(image_path, fabric_type=None, production_volume=None):
    """Analyze a pattern image and recommend print methods.

    Parameters
    ----------
    image_path : str
        Absolute path to the pattern image file.
    fabric_type : str or None
        Optional fabric type (e.g. 'cotton', 'polyester', 'silk', 'black cotton').
    production_volume : int or None
        Optional expected production in yards.

    Returns
    -------
    dict
        Keys: color_count, has_gradients, gradient_score, min_feature_size,
        detail_level, has_transparency,
        recommendations (list of dicts sorted by score descending, each with:
            method, method_key, score, reasoning, cost_estimate, min_order, file_prep).
    """
    with Image.open(image_path) as img:
        img_rgb = img.convert("RGB")

    # --- Image analysis ---
    color_count = _count_effective_colors(img_rgb)
    has_gradients, gradient_score = _detect_gradients(img_rgb)
    min_feature_px, total_px = _measure_min_feature_size(img_rgb)
    detail_level = _classify_detail_level(color_count, has_gradients, gradient_score, min_feature_px, total_px)
    transparency = _has_transparency(image_path)

    # --- Score each method ---
    scorers = {
        "screen": _score_screen,
        "rotary": _score_rotary,
        "digital": _score_digital,
        "sublimation": _score_sublimation,
        "block": _score_block,
        "discharge": _score_discharge,
    }

    recommendations = []
    for key, scorer in scorers.items():
        score, reasoning = scorer(color_count, has_gradients, detail_level, fabric_type, production_volume)
        prep = get_file_prep_requirements(key) or {}
        cost_info = _METHOD_COST.get(key, {})
        recommendations.append({
            "method": prep.get("method", key.title()),
            "method_key": key,
            "score": score,
            "reasoning": reasoning,
            "cost_estimate": cost_info.get("cost_estimate", "N/A"),
            "min_order": cost_info.get("min_order", "N/A"),
            "file_prep": {
                "color_mode": prep.get("color_mode", ""),
                "file_format": prep.get("file_format", ""),
                "resolution": prep.get("resolution", ""),
                "notes": prep.get("notes", ""),
            },
        })

    # Sort by score descending
    recommendations.sort(key=lambda r: r["score"], reverse=True)

    return {
        "color_count": color_count,
        "has_gradients": has_gradients,
        "gradient_score": gradient_score,
        "min_feature_size": min_feature_px,
        "detail_level": detail_level,
        "has_transparency": transparency,
        "recommendations": recommendations,
    }
