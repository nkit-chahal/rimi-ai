import os
import sys
import base64
import uuid
import requests
from io import BytesIO
from PIL import Image, ImageDraw, ImageChops
import replicate
from dotenv import load_dotenv

load_dotenv()
os.environ.setdefault("REPLICATE_API_TOKEN", os.getenv("REPLICATE_API_TOKEN", ""))

TEST_DIR = os.path.join(os.path.dirname(__file__), 'test_images')
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), 'test_results')
os.makedirs(OUTPUT_DIR, exist_ok=True)

def img_to_data_uri(pil_img):
    buf = BytesIO()
    pil_img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode('utf-8')
    return f"data:image/png;base64,{b64}"

def offset_image(img, x_offset, y_offset):
    """Offsets the image with wrap-around"""
    # ImageChops.offset wraps around perfectly
    return ImageChops.offset(img, x_offset, y_offset)

def create_center_cross_mask(size, brush_size):
    """Creates a black mask with a white cross in the center"""
    width, height = size
    mask = Image.new('L', size, 0)
    draw = ImageDraw.Draw(mask)
    
    center_x = width // 2
    center_y = height // 2
    half_brush = brush_size // 2
    
    # Horizontal line
    draw.rectangle([0, center_y - half_brush, width, center_y + half_brush], fill=255)
    # Vertical line
    draw.rectangle([center_x - half_brush, 0, center_x + half_brush, height], fill=255)
    
    return mask

def create_2x2_grid(img):
    """Creates a 2x2 grid of the image to test seamlessness"""
    w, h = img.size
    grid = Image.new('RGB', (w * 2, h * 2))
    grid.paste(img, (0, 0))
    grid.paste(img, (w, 0))
    grid.paste(img, (0, h))
    grid.paste(img, (w, h))
    return grid

def validate_offset_technique(image_name, description="A beautiful pattern"):
    image_path = os.path.join(TEST_DIR, image_name)
    if not os.path.exists(image_path):
        print(f"File not found: {image_path}")
        return

    print(f"\n--- Testing Offset & Inpaint Technique on {image_name} ---")
    
    # 1. Load and optionally resize image
    img = Image.open(image_path).convert('RGB')
    
    # To save processing time and API cost for testing, resize if larger than 768x768
    max_dim = 768
    if img.width > max_dim or img.height > max_dim:
        ratio = min(max_dim / img.width, max_dim / img.height)
        new_size = (int(img.width * ratio), int(img.height * ratio))
        img = img.resize(new_size, Image.Resampling.LANCZOS)
        print(f"Resized image to {new_size} for testing.")
        
    width, height = img.size
    
    # Save original 2x2 grid to see the problem
    orig_grid = create_2x2_grid(img)
    orig_grid.save(os.path.join(OUTPUT_DIR, f"1_original_2x2_{image_name}"))
    print("1. Saved original 2x2 grid (you can see the seams here).")

    # 2. Offset by 50%
    x_offset, y_offset = width // 2, height // 2
    offset_img = offset_image(img, x_offset, y_offset)
    offset_img.save(os.path.join(OUTPUT_DIR, f"2_offset_{image_name}"))
    print("2. Saved 50% offset image (seams are now in the center).")

    # 3. Create Mask
    brush_size = int(max(width, height) * 0.15) # 15% brush size
    mask_img = create_center_cross_mask((width, height), brush_size)
    mask_img.save(os.path.join(OUTPUT_DIR, f"3_mask_{image_name}"))
    print(f"3. Saved center cross mask (brush size: {brush_size}px).")

    # 4. Inpaint using flux-fill-pro
    print("4. Sending to flux-fill-pro via Replicate...")
    offset_uri = img_to_data_uri(offset_img)
    mask_uri = img_to_data_uri(mask_img)

    try:
        output = replicate.run(
            "black-forest-labs/flux-fill-pro",
            input={
                "image": offset_uri,
                "mask": mask_uri,
                "prompt": f"A perfectly seamless repeating pattern of {description}. Redraw and complete the motifs in the masked overlapping regions to connect them seamlessly. High quality texture.",
                "output_format": "png",
                "steps": 40,
                "guidance": 60
            }
        )
        filled_url = str(output)
        print(f"   Received filled image URL: {filled_url}")
        
        filled_resp = requests.get(filled_url)
        inpainted_offset = Image.open(BytesIO(filled_resp.content))
        inpainted_offset.save(os.path.join(OUTPUT_DIR, f"4_inpainted_offset_{image_name}"))
        print("   Saved inpainted offset image.")
        
        # 5. Offset back by 50% to get the fixed base tile
        fixed_tile = offset_image(inpainted_offset, -x_offset, -y_offset)
        fixed_tile.save(os.path.join(OUTPUT_DIR, f"5_fixed_base_{image_name}"))
        print("5. Saved fixed base tile (offset back by 50%).")
        
        # 6. Create 2x2 grid of the fixed tile to prove it's seamless
        fixed_grid = create_2x2_grid(fixed_tile)
        fixed_grid.save(os.path.join(OUTPUT_DIR, f"6_fixed_2x2_{image_name}"))
        print("6. Saved fixed 2x2 grid (should be perfectly seamless!).")
        
    except Exception as e:
        print(f"Error during Replicate API call: {e}")

if __name__ == "__main__":
    valid_extensions = {".png", ".jpg", ".jpeg"}
    
    for filename in os.listdir(TEST_DIR):
        ext = os.path.splitext(filename)[1].lower()
        if ext in valid_extensions:
            # We'll use a generic description since we are processing in bulk
            validate_offset_technique(filename, description="seamless pattern texture")

