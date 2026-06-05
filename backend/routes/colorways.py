"""Colorways routes: brand palettes CRUD, colorway generation, linecard export."""
import os
import uuid
import json
from flask import Blueprint, request, jsonify
from datetime import datetime, timezone

from config import UPLOAD_DIR, RESULTS_DIR
from db import db
from auth import (
    log_export, check_credits, get_updated_credits, record_activity,
)
from color_utils import recolor_image

bp = Blueprint('colorways', __name__)


# --------------- Brand Palettes CRUD ---------------
@bp.route('/api/brand-palettes', methods=['GET'])
def get_brand_palettes():
    project_id = request.args.get('projectId', type=int)
    if not project_id:
        return jsonify({'error': 'projectId is required'}), 400
    conn = db()
    try:
        rows = conn.execute("SELECT * FROM brand_palettes WHERE project_id = ? ORDER BY created_at DESC", (project_id,)).fetchall()
        palettes = [dict(r) for r in rows]
        for p in palettes:
            p['colors'] = json.loads(p.pop('colors_json'))
        return jsonify({'palettes': palettes})
    finally:
        conn.close()


@bp.route('/api/brand-palettes', methods=['POST'])
def create_brand_palette():
    data = request.get_json() or {}
    project_id = data.get('projectId')
    name = data.get('name')
    colors = data.get('colors')
    if not project_id or not name or not colors:
        return jsonify({'error': 'projectId, name, and colors are required'}), 400
    conn = db()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO brand_palettes (project_id, name, colors_json, created_at) VALUES (?, ?, ?, ?)",
            (project_id, name, json.dumps(colors), datetime.now(timezone.utc).isoformat())
        )
        conn.commit()
        return jsonify({'success': True, 'id': cur.lastrowid})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()


@bp.route('/api/brand-palettes/<int:palette_id>', methods=['DELETE'])
def delete_brand_palette(palette_id):
    conn = db()
    try:
        conn.execute("DELETE FROM brand_palettes WHERE id = ?", (palette_id,))
        conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()


# --------------- Colorway Manager ---------------
@bp.route('/api/colorways/generate', methods=['POST'])
def generate_colorways():
    """
    Generate production colorways using color theory strategies.
    Expects JSON: { filename, palette, lockedIndices, strategy, count, projectId, userId }
    """
    import colorsys
    data = request.get_json()
    filename = data.get('filename', '')
    palette = data.get('palette', [])
    locked_indices = set(data.get('lockedIndices', []))
    strategy = data.get('strategy', 'complementary')
    count = int(data.get('count', 4))
    project_id = int(data.get('projectId', 1))
    user_id = data.get('userId') or data.get('user_id')
    if user_id:
        try:
            user_id = int(user_id)
        except ValueError:
            user_id = None

    if not filename or not palette:
        return jsonify({'error': 'Filename and palette are required'}), 400
    filename = os.path.basename(filename)

    filepath = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(filepath):
        filepath = os.path.join(RESULTS_DIR, filename)
        if not os.path.exists(filepath):
            return jsonify({'error': 'File not found'}), 404

    ok, remaining, limit, used = check_credits(user_id)
    if not ok:
        return jsonify({'error': 'Insufficient credits', 'creditsUsed': used, 'creditsLimit': limit}), 403

    def hex_to_hsl(hex_str):
        hex_str = hex_str.lstrip('#')
        r, g, b = int(hex_str[0:2], 16)/255, int(hex_str[2:4], 16)/255, int(hex_str[4:6], 16)/255
        h, l, s = colorsys.rgb_to_hls(r, g, b)
        return h, s, l

    def hsl_to_hex(h, s, l):
        r, g, b = colorsys.hls_to_rgb(h, l, s)
        return '#{:02x}{:02x}{:02x}'.format(int(r*255), int(g*255), int(b*255))

    import random
    random.seed()
    colorways = []
    total_credits = 0

    for cw_idx in range(count):
        new_colors = list(palette)
        for i in range(len(palette)):
            if i in locked_indices:
                continue
            h, s, l = hex_to_hsl(palette[i])

            if strategy == 'complementary':
                h = (h + 0.5 + random.uniform(-0.05, 0.05)) % 1.0
                s = min(1.0, max(0.1, s + random.uniform(-0.15, 0.15)))
            elif strategy == 'analogous':
                h = (h + random.uniform(-0.08, 0.08) + (cw_idx * 0.06)) % 1.0
                s = min(1.0, max(0.1, s + random.uniform(-0.1, 0.1)))
            elif strategy == 'triadic':
                shifts = [0.333, 0.666, 0.5]
                h = (h + shifts[cw_idx % len(shifts)] + random.uniform(-0.03, 0.03)) % 1.0
            elif strategy == 'monochrome':
                l = min(0.9, max(0.1, l + (cw_idx - count/2) * 0.12 + random.uniform(-0.05, 0.05)))
                s = min(1.0, max(0.05, s + random.uniform(-0.1, 0.1)))
            elif strategy == 'seasonal_warm':
                warm_hues = [0.0, 0.05, 0.08, 0.12, 0.95]
                h = warm_hues[random.randint(0, len(warm_hues)-1)] + random.uniform(-0.03, 0.03)
                h = h % 1.0
                s = min(1.0, max(0.3, s + random.uniform(-0.1, 0.15)))
                l = min(0.85, max(0.2, l + random.uniform(-0.1, 0.1)))
            elif strategy == 'seasonal_cool':
                cool_hues = [0.55, 0.6, 0.65, 0.7, 0.75]
                h = cool_hues[random.randint(0, len(cool_hues)-1)] + random.uniform(-0.03, 0.03)
                h = h % 1.0
                s = min(1.0, max(0.2, s + random.uniform(-0.1, 0.1)))
                l = min(0.8, max(0.15, l + random.uniform(-0.1, 0.1)))

            new_colors[i] = hsl_to_hex(h, s, l)

        # Generate recolored image
        color_mapping = [{'old': palette[j], 'new': new_colors[j]} for j in range(len(palette))]
        result_name = f"cw_{uuid.uuid4().hex[:8]}.png"
        result_path = os.path.join(RESULTS_DIR, result_name)

        try:
            recolor_image(filepath, color_mapping, result_path)
            colorways.append({
                'colors': new_colors,
                'strategy': strategy,
                'resultUrl': f'/results/{result_name}',
            })
            log_export(project_id, result_name, filename, "Colorway", {"strategy": strategy, "colorway_index": cw_idx})
            total_credits += 10
        except Exception as e:
            print(f"  [Colorway] Error generating colorway {cw_idx}: {e}")

    if colorways:
        record_activity(project_id, 'generation', len(colorways), total_credits, user_id=user_id)

    updated_credits = get_updated_credits(user_id)
    return jsonify({'success': True, 'colorways': colorways, **updated_credits})


@bp.route('/api/colorways/export-linecard', methods=['POST'])
def export_linecard():
    """
    Export a colorway line card as PDF.
    Expects JSON: { filename, colorways, basePalette, projectId }
    """
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas as pdfcanvas
    from reportlab.lib.units import inch
    from PIL import Image

    data = request.get_json()
    filename = data.get('filename', '')
    filename = os.path.basename(filename) if filename else ''
    colorways_data = data.get('colorways', [])
    base_palette = data.get('basePalette', [])
    project_id = int(data.get('projectId', 1))

    if not colorways_data:
        return jsonify({'error': 'No colorways to export'}), 400

    pdf_name = f"linecard_{uuid.uuid4().hex[:8]}.pdf"
    pdf_path = os.path.join(RESULTS_DIR, pdf_name)

    try:
        c = pdfcanvas.Canvas(pdf_path, pagesize=A4)
        width, height = A4

        # Title
        c.setFont("Helvetica-Bold", 24)
        c.drawString(inch, height - inch, "RIMI AI — Colorway Line Card")
        c.setFont("Helvetica", 10)
        c.drawString(inch, height - 1.3 * inch, f"Date: {datetime.now(timezone.utc).strftime('%Y-%m-%d')}  |  Colorways: {len(colorways_data)}")

        # Base palette
        y = height - 1.8 * inch
        c.setFont("Helvetica-Bold", 12)
        c.drawString(inch, y, "Base Palette")
        y -= 25
        for i, hex_color in enumerate(base_palette[:8]):
            hex_clean = hex_color.lstrip('#')
            r, g, b = int(hex_clean[0:2], 16), int(hex_clean[2:4], 16), int(hex_clean[4:6], 16)
            c.setFillColorRGB(r/255, g/255, b/255)
            c.rect(inch + i * 55, y, 45, 25, fill=1)
            c.setFillColorRGB(0, 0, 0)
            c.setFont("Helvetica", 7)
            c.drawString(inch + i * 55, y - 10, hex_color.upper())
        y -= 50

        # Each colorway
        c.setFont("Helvetica-Bold", 12)
        for cw_idx, cw in enumerate(colorways_data):
            if y < 2 * inch:
                c.showPage()
                y = height - inch

            c.setFillColorRGB(0, 0, 0)
            c.setFont("Helvetica-Bold", 11)
            c.drawString(inch, y, f"Colorway {cw_idx + 1} — {cw.get('strategy', 'custom').capitalize()}")
            y -= 20

            colors = cw.get('colors', [])
            for j, hex_color in enumerate(colors[:8]):
                hex_clean = hex_color.lstrip('#')
                r2, g2, b2 = int(hex_clean[0:2], 16), int(hex_clean[2:4], 16), int(hex_clean[4:6], 16)
                c.setFillColorRGB(r2/255, g2/255, b2/255)
                c.rect(inch + j * 55, y, 45, 25, fill=1)
                c.setFillColorRGB(0, 0, 0)
                c.setFont("Helvetica", 7)
                c.drawString(inch + j * 55, y - 10, hex_color.upper())
            y -= 20

            # Draw preview image if available
            result_url = cw.get('resultUrl', '')
            if result_url:
                img_path = os.path.join(RESULTS_DIR, result_url.split('/')[-1])
                if os.path.exists(img_path):
                    try:
                        c.drawImage(img_path, inch, y - 2.5*inch, width=2.5*inch, height=2.5*inch,
                                   preserveAspectRatio=True, anchor='nw')
                        y -= 2.7 * inch
                    except Exception:
                        y -= 15
            y -= 30

        c.save()

        log_export(project_id, pdf_name, filename, "Colorway Line Card")
        return jsonify({'success': True, 'pdfUrl': f'/results/{pdf_name}'})

    except Exception as e:
        print(f"  [Line Card] Error: {e}")
        return jsonify({'error': str(e)}), 500
