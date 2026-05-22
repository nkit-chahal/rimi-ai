import os
import time
import base64
import requests
import numpy as np
from io import BytesIO
from PIL import Image, ImageDraw, ImageChops, ImageFilter
import replicate
from groq import Groq

# Load .env file for API keys
env_path = os.path.join(os.path.dirname(__file__), ".env")
if os.path.exists(env_path):
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())

groq_client = Groq()

INPUT_DIR = os.path.join(os.path.dirname(__file__), "test_images")
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "test_results", "reddit_methodology")
os.makedirs(OUTPUT_DIR, exist_ok=True)

def img_to_data_uri(pil_img):
    buf = BytesIO()
    pil_img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
    return f"data:image/png;base64,{b64}"

def compute_seam_score(img):
    """Boundary-gradient seam score: compares edge jumps to internal gradients."""
    arr = np.array(img.convert("RGB"), dtype=np.float32)
    diff_x = np.mean(np.abs(arr[:, 1:, :] - arr[:, :-1, :]))
    diff_y = np.mean(np.abs(arr[1:, :, :] - arr[:-1, :, :]))
    seam_x = np.mean(np.abs(arr[:, 0, :] - arr[:, -1, :]))
    seam_y = np.mean(np.abs(arr[0, :, :] - arr[-1, :, :]))

    ratio_x = seam_x / max(1e-5, diff_x)
    ratio_y = seam_y / max(1e-5, diff_y)

    sc_x = max(0.0, 1.0 - (ratio_x - 1.0) / 2.0) if ratio_x > 1.0 else 1.0
    sc_y = max(0.0, 1.0 - (ratio_y - 1.0) / 2.0) if ratio_y > 1.0 else 1.0
    return (sc_x + sc_y) / 2.0

def make_repeat(tile, n=3):
    w, h = tile.size
    out = Image.new("RGB", (w * n, h * n))
    for r in range(n):
        for c in range(n):
            out.paste(tile, (c * w, r * h))
    return out

def get_style_description(img):
    uri = img_to_data_uri(img)
    completion = groq_client.chat.completions.create(
        model="meta-llama/llama-4-scout-17b-16e-instruct",
        messages=[{
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": uri}},
                {"type": "text", "text": (
                    "Describe this fabric pattern in detail. Specify motifs, colors, background, "
                    "and the exact artistic style (e.g. flat vector, watercolor). Keep under 2 sentences."
                )}
            ]
        }],
        temperature=0.2,
        max_completion_tokens=150,
    )
    return completion.choices[0].message.content.strip()

def process_image(filepath, name, brush_pct=25, prompt_strength=0.75, num_candidates=4):
    print(f"\n--- Processing: {name} ---")
    img = Image.open(filepath).convert("RGB")
    orig_w, orig_h = img.size

    # 1. Style description
    desc = get_style_description(img)
    print(f"  [Style]: {desc[:100]}...")

    # 2. Aspect-ratio preserving resize (multiples of 64)
    max_dim = 1024
    if orig_w > orig_h:
        new_w, new_h = max_dim, int(max_dim * (orig_h / orig_w))
    else:
        new_w, new_h = int(max_dim * (orig_w / orig_h)), max_dim
        
    new_w, new_h = max(64, (new_w // 64) * 64), max(64, (new_h // 64) * 64)
    img_resized = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
    x_offset, y_offset = new_w // 2, new_h // 2

    # ==========================================
    # PASS 1: HORIZONTAL SEAM
    # ==========================================
    print("  [Pass 1] Fixing horizontal seam...")
    img_pass1_offset = ImageChops.offset(img_resized, 0, y_offset)
    
    mask_h = Image.new('L', (new_w, new_h), 0)
    draw_h = ImageDraw.Draw(mask_h)
    v_brush = max(4, int(new_h * (brush_pct / 100.0)))
    draw_h.rectangle([0, y_offset - v_brush // 2, new_w, y_offset + v_brush // 2], fill=255)
    mask_h = mask_h.filter(ImageFilter.GaussianBlur(radius=max(3, v_brush // 6)))
    
    print(f"    Requesting {num_candidates} candidates (denoise={prompt_strength}, brush={brush_pct}%)...")
    t0 = time.time()
    outputs_h = replicate.run(
        "replicate/seamless-texture:9a59c0dce189bfe8a7fcb379c497713500ff959652c4e7874023f15983dec839",
        input={
            "model": "dev",
            "image": img_to_data_uri(img_pass1_offset),
            "mask": img_to_data_uri(mask_h),
            "prompt": f"FSTL {desc}, seamless repeating pattern, tileable",
            "prompt_strength": prompt_strength,
            "guidance_scale": 3.0,
            "num_outputs": num_candidates,
            "num_inference_steps": 30,
            "output_format": "png",
        }
    )
    print(f"    Received in {time.time() - t0:.1f}s")

    best_p1_img = None
    best_p1_score = -1.0
    
    for idx, out_url in enumerate(outputs_h):
        filled_resp = requests.get(str(out_url), timeout=60)
        candidate = Image.open(BytesIO(filled_resp.content)).convert("RGB")
        score = compute_seam_score(candidate)
        print(f"    P1 Candidate {idx+1} Score: {score:.3f}")
        if score > best_p1_score:
            best_p1_score = score
            best_p1_img = candidate
            
    print(f"    Pass 1 Best Score: {best_p1_score:.3f}")
    
    # Re-align Pass 1 result
    img_pass1_fixed = ImageChops.offset(best_p1_img, 0, -y_offset)

    # ==========================================
    # PASS 2: VERTICAL SEAM
    # ==========================================
    print("  [Pass 2] Fixing vertical seam...")
    img_pass2_offset = ImageChops.offset(img_pass1_fixed, x_offset, 0)
    
    mask_v = Image.new('L', (new_w, new_h), 0)
    draw_v = ImageDraw.Draw(mask_v)
    h_brush = max(4, int(new_w * (brush_pct / 100.0)))
    draw_v.rectangle([x_offset - h_brush // 2, 0, x_offset + h_brush // 2, new_h], fill=255)
    mask_v = mask_v.filter(ImageFilter.GaussianBlur(radius=max(3, h_brush // 6)))
    
    print(f"    Requesting {num_candidates} candidates (denoise={prompt_strength}, brush={brush_pct}%)...")
    t0 = time.time()
    outputs_v = replicate.run(
        "replicate/seamless-texture:9a59c0dce189bfe8a7fcb379c497713500ff959652c4e7874023f15983dec839",
        input={
            "model": "dev",
            "image": img_to_data_uri(img_pass2_offset),
            "mask": img_to_data_uri(mask_v),
            "prompt": f"FSTL {desc}, seamless repeating pattern, tileable",
            "prompt_strength": prompt_strength,
            "guidance_scale": 3.0,
            "num_outputs": num_candidates,
            "num_inference_steps": 30,
            "output_format": "png",
        }
    )
    print(f"    Received in {time.time() - t0:.1f}s")

    best_p2_img = None
    best_p2_score = -1.0
    
    for idx, out_url in enumerate(outputs_v):
        filled_resp = requests.get(str(out_url), timeout=60)
        candidate = Image.open(BytesIO(filled_resp.content)).convert("RGB")
        score = compute_seam_score(candidate)
        print(f"    P2 Candidate {idx+1} Score: {score:.3f}")
        if score > best_p2_score:
            best_p2_score = score
            best_p2_img = candidate
            
    print(f"    Pass 2 Best Score: {best_p2_score:.3f}")

    # ==========================================
    # FINALIZE
    # ==========================================
    final_resized = ImageChops.offset(best_p2_img, -x_offset, 0)
    final_tile = final_resized.resize((orig_w, orig_h), Image.Resampling.LANCZOS)
    
    safe = name.replace(" ", "_").replace("(", "").replace(")", "")
    final_tile.save(os.path.join(OUTPUT_DIR, f"{safe}_tile.png"))
    
    repeat = make_repeat(final_tile, 3)
    repeat.save(os.path.join(OUTPUT_DIR, f"{safe}_BEST_3x3_repeat.png"))
    print(f"  [Done] Saved to {OUTPUT_DIR}")

if __name__ == "__main__":
    print("=" * 70)
    print("  RIMI AI - Clean Two-Pass + Multi-Candidate (No Eraser)")
    print("  Settings: brush=25%, denoise=0.75, candidates=4")
    print("=" * 70)

    targets = [
        "WhatsApp Image 2026-05-19 at 10.21.23 AM.jpeg", # Lemons
    ]

    for t in targets:
        name = t.split(".")[0]
        try:
            process_image(os.path.join(INPUT_DIR, t), name)
        except Exception as e:
            print(f"  ERROR: {e}")
