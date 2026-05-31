import os
from datetime import datetime, timezone
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import Paragraph
from color_utils import extract_palette
from pantone_utils import match_to_pantone

# ─── Constants ────────────────────────────────────────────────────────────────

PAGE_W, PAGE_H = A4
MARGIN = 0.75 * inch
CONTENT_W = PAGE_W - 2 * MARGIN

# Brand colours
BRAND_DARK = colors.HexColor('#1a1a2e')
BRAND_ACCENT = colors.HexColor('#e94560')
BRAND_LIGHT_BG = colors.HexColor('#f5f5f7')
BRAND_MID_GRAY = colors.HexColor('#6b7280')
BRAND_BORDER = colors.HexColor('#e5e7eb')
BLACK = colors.HexColor('#000000')
WHITE = colors.HexColor('#ffffff')

# Care‑instruction presets keyed by fabric type
CARE_PRESETS = {
    'cotton': {
        'wash': 'Machine wash cold (30°C / 86°F). Gentle cycle recommended.',
        'iron': 'Iron on medium heat (150°C / 300°F). Steam allowed.',
        'bleach': 'Non-chlorine bleach only when needed.',
        'dry_clean': 'Dry cleanable. Use normal solvents.',
        'tumble_dry': 'Tumble dry low. Remove promptly.',
        'notes': 'Pre-shrunk finish recommended. Wash inside-out to preserve print.',
    },
    'polyester': {
        'wash': 'Machine wash warm (40°C / 104°F). Permanent press cycle.',
        'iron': 'Iron on low heat (110°C / 230°F). No steam.',
        'bleach': 'Do not bleach.',
        'dry_clean': 'Dry cleanable with petroleum solvent only.',
        'tumble_dry': 'Tumble dry low. Remove immediately.',
        'notes': 'Quick-drying fabric. Avoid high heat to prevent melting or glazing.',
    },
    'silk': {
        'wash': 'Hand wash cold (30°C / 86°F) with mild detergent. Do not wring.',
        'iron': 'Iron on low heat (110°C / 230°F). Use pressing cloth.',
        'bleach': 'Do not bleach.',
        'dry_clean': 'Professional dry clean recommended.',
        'tumble_dry': 'Do not tumble dry. Lay flat or hang to dry in shade.',
        'notes': 'Avoid prolonged sun exposure. Store in breathable garment bag.',
    },
    'linen': {
        'wash': 'Machine wash cold to warm (30-40°C). Gentle cycle.',
        'iron': 'Iron on high heat (200°C / 390°F) while slightly damp. Steam allowed.',
        'bleach': 'Non-chlorine bleach only when needed.',
        'dry_clean': 'Dry cleanable.',
        'tumble_dry': 'Tumble dry low. Remove while slightly damp.',
        'notes': 'Expect natural softening with each wash. Slight wrinkling is characteristic.',
    },
    'wool': {
        'wash': 'Hand wash cold (30°C / 86°F) or delicate machine cycle. Use wool detergent.',
        'iron': 'Iron on low heat (110°C / 230°F) with pressing cloth. Steam carefully.',
        'bleach': 'Do not bleach.',
        'dry_clean': 'Professional dry clean recommended.',
        'tumble_dry': 'Do not tumble dry. Reshape and lay flat to dry.',
        'notes': 'Store folded with cedar blocks. Do not hang to prevent stretching.',
    },
    'rayon': {
        'wash': 'Hand wash cold (30°C / 86°F). Do not wring or twist.',
        'iron': 'Iron on medium-low heat (150°C / 300°F). Use pressing cloth.',
        'bleach': 'Do not bleach.',
        'dry_clean': 'Dry clean recommended for best results.',
        'tumble_dry': 'Do not tumble dry. Hang to dry.',
        'notes': 'Rayon weakens when wet. Handle with care during washing.',
    },
    'nylon': {
        'wash': 'Machine wash cold (30°C / 86°F). Gentle cycle.',
        'iron': 'Iron on lowest heat (110°C / 230°F). Avoid direct contact.',
        'bleach': 'Do not bleach.',
        'dry_clean': 'Dry cleanable.',
        'tumble_dry': 'Tumble dry low or hang to dry.',
        'notes': 'Static-prone. Use fabric softener or anti-static spray.',
    },
}

# Fallback care preset
DEFAULT_CARE = {
    'wash': 'Machine wash cold (30°C / 86°F). Gentle cycle.',
    'iron': 'Iron on low to medium heat. Check garment label.',
    'bleach': 'Do not bleach unless specified.',
    'dry_clean': 'Dry cleanable. Check garment label.',
    'tumble_dry': 'Tumble dry low or lay flat to dry.',
    'notes': 'Refer to specific fabric content for detailed care.',
}


# ─── Helper drawing functions ────────────────────────────────────────────────

def _draw_header_bar(c, y, title, page_num, total_pages):
    """Draw the branded header bar at the top of each page."""
    # Dark header band
    c.setFillColor(BRAND_DARK)
    c.rect(0, y, PAGE_W, 50, fill=1, stroke=0)
    # Title
    c.setFillColor(WHITE)
    c.setFont('Helvetica-Bold', 14)
    c.drawString(MARGIN, y + 18, title)
    # Page number
    c.setFont('Helvetica', 9)
    c.drawRightString(PAGE_W - MARGIN, y + 18, f'Page {page_num} / {total_pages}')


def _draw_footer(c):
    """Draw footer with branding and confidentiality notice."""
    c.setStrokeColor(BRAND_BORDER)
    c.setLineWidth(0.5)
    c.line(MARGIN, 40, PAGE_W - MARGIN, 40)
    c.setFillColor(BRAND_MID_GRAY)
    c.setFont('Helvetica', 7)
    c.drawString(MARGIN, 26,
                 'CONFIDENTIAL — This document is property of RIMI AI and the respective brand. '
                 'Do not distribute without permission.')
    c.drawRightString(PAGE_W - MARGIN, 26,
                      f'Generated {datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")}')


def _draw_section_heading(c, y, text):
    """Draw a section heading with accent underline. Returns new y position."""
    c.setFillColor(BRAND_DARK)
    c.setFont('Helvetica-Bold', 13)
    c.drawString(MARGIN, y, text)
    y -= 4
    c.setStrokeColor(BRAND_ACCENT)
    c.setLineWidth(2)
    c.line(MARGIN, y, MARGIN + c.stringWidth(text, 'Helvetica-Bold', 13) + 6, y)
    c.setLineWidth(1)
    return y - 18


def _draw_label_value(c, y, label, value, label_font='Helvetica-Bold', value_font='Helvetica',
                      font_size=10, label_w=170):
    """Draw a label: value row. Returns new y position."""
    c.setFont(label_font, font_size)
    c.setFillColor(BRAND_MID_GRAY)
    c.drawString(MARGIN + 10, y, label)
    c.setFont(value_font, font_size)
    c.setFillColor(BLACK)
    c.drawString(MARGIN + label_w, y, str(value))
    return y - 18


def _draw_table_row(c, y, cols, col_widths, bold=False, bg=None, font_size=9):
    """Draw a table row with multiple columns. Returns new y."""
    row_h = 18
    x = MARGIN
    if bg:
        c.setFillColor(bg)
        c.rect(MARGIN, y - 4, CONTENT_W, row_h, fill=1, stroke=0)
    font_name = 'Helvetica-Bold' if bold else 'Helvetica'
    c.setFont(font_name, font_size)
    c.setFillColor(BLACK if not bold else BRAND_DARK)
    for col, w in zip(cols, col_widths):
        c.drawString(x + 4, y, str(col))
        x += w
    return y - row_h


# ─── Page builders ────────────────────────────────────────────────────────────

def _page_cover(c, project_metadata, options, total_pages):
    """Page 1 — Cover Sheet."""
    # Full page dark background
    c.setFillColor(BRAND_DARK)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)

    # Accent stripe
    c.setFillColor(BRAND_ACCENT)
    c.rect(0, PAGE_H * 0.52, PAGE_W, 6, fill=1, stroke=0)

    # Main title
    c.setFillColor(WHITE)
    c.setFont('Helvetica-Bold', 36)
    c.drawCentredString(PAGE_W / 2, PAGE_H * 0.65, 'RIMI AI')
    c.setFont('Helvetica', 20)
    c.drawCentredString(PAGE_W / 2, PAGE_H * 0.60, 'T E C H   P A C K')

    # Project info block
    y = PAGE_H * 0.44
    c.setFont('Helvetica', 12)
    project_name = project_metadata.get('name', 'Untitled Project')
    company = options.get('company_name', '')
    season = options.get('season', '')
    version = options.get('version', '1.0')
    date_str = datetime.now(timezone.utc).strftime('%B %d, %Y')

    info_lines = [
        ('Project', project_name),
        ('Date', date_str),
        ('Version', version),
    ]
    if company:
        info_lines.append(('Brand / Company', company))
    if season:
        info_lines.append(('Season', season))

    for label, val in info_lines:
        c.setFont('Helvetica', 10)
        c.setFillColor(colors.HexColor('#9ca3af'))
        c.drawCentredString(PAGE_W / 2, y, label.upper())
        y -= 16
        c.setFont('Helvetica-Bold', 14)
        c.setFillColor(WHITE)
        c.drawCentredString(PAGE_W / 2, y, val)
        y -= 28

    # Footer on cover
    c.setFillColor(colors.HexColor('#4b5563'))
    c.setFont('Helvetica', 8)
    c.drawCentredString(PAGE_W / 2, 30,
                        'Confidential — Generated by RIMI AI Textile Design Platform')

    c.showPage()


def _page_design_preview(c, image_path, project_metadata, options, total_pages):
    """Page 2 — Design Preview."""
    _draw_header_bar(c, PAGE_H - 50, 'DESIGN PREVIEW', 2, total_pages)

    y = PAGE_H - 80
    controls = project_metadata.get('controls', {})
    description = options.get('description', '')
    repeat_type = str(controls.get('repeat_type', 'block')).capitalize()
    print_width = controls.get('print_width', 12)

    # Image
    img_max_w = CONTENT_W
    img_max_h = 5.5 * inch
    try:
        c.drawImage(image_path, MARGIN, y - img_max_h,
                     width=img_max_w, height=img_max_h,
                     preserveAspectRatio=True, anchor='nw')
    except Exception as e:
        c.setFillColor(BRAND_LIGHT_BG)
        c.rect(MARGIN, y - img_max_h, img_max_w, img_max_h, fill=1, stroke=0)
        c.setFillColor(BRAND_MID_GRAY)
        c.setFont('Helvetica', 11)
        c.drawCentredString(PAGE_W / 2, y - img_max_h / 2, f'Image could not be loaded: {e}')

    y = y - img_max_h - 30

    # Description
    y = _draw_section_heading(c, y, 'Pattern Details')

    if description:
        # Wrap long descriptions
        c.setFont('Helvetica', 10)
        c.setFillColor(BLACK)
        text_obj = c.beginText(MARGIN + 10, y)
        text_obj.setFont('Helvetica', 10)
        text_obj.setLeading(14)
        # Simple word-wrap
        words = description.split()
        line = ''
        max_chars = 85
        for w in words:
            if len(line) + len(w) + 1 > max_chars:
                text_obj.textLine(line)
                line = w
            else:
                line = (line + ' ' + w).strip()
        if line:
            text_obj.textLine(line)
        c.drawText(text_obj)
        y -= (len(description) // max_chars + 2) * 14

    y = _draw_label_value(c, y, 'Repeat Type:', repeat_type)
    y = _draw_label_value(c, y, 'Print Width:', f'{print_width} inches')

    _draw_footer(c)
    c.showPage()


def _page_color_specs(c, palette, total_pages):
    """Page 3 — Color Specifications with Pantone matching."""
    _draw_header_bar(c, PAGE_H - 50, 'COLOR SPECIFICATIONS', 3, total_pages)

    y = PAGE_H - 80
    y = _draw_section_heading(c, y, f'Dominant Colors  ({len(palette)} total)')

    # Table header
    col_widths = [30, 80, 115, 150, 80]  # swatch, HEX, RGB, Pantone, Coverage
    y = _draw_table_row(c, y, ['', 'HEX', 'RGB', 'Pantone TCX Match', 'Coverage'],
                        col_widths, bold=True, bg=BRAND_LIGHT_BG, font_size=9)

    c.setStrokeColor(BRAND_BORDER)
    c.line(MARGIN, y + 14, MARGIN + CONTENT_W, y + 14)

    for idx, p in enumerate(palette):
        hex_code = p['hex'].upper()
        r, g, b = p['rgb']
        weight = p['weight']

        # Pantone match
        try:
            matches = match_to_pantone((r, g, b), top_n=1)
            pantone_name = matches[0]['name'] if matches else '—'
            pantone_de = f' (ΔE {matches[0]["deltaE"]})' if matches else ''
        except Exception:
            pantone_name = '—'
            pantone_de = ''

        # Alternating row background
        bg = BRAND_LIGHT_BG if idx % 2 == 0 else None
        row_h = 22
        x = MARGIN

        if bg:
            c.setFillColor(bg)
            c.rect(MARGIN, y - 6, CONTENT_W, row_h, fill=1, stroke=0)

        # Swatch
        c.setFillColorRGB(r / 255.0, g / 255.0, b / 255.0)
        c.roundRect(x + 4, y - 3, 18, 16, 2, fill=1, stroke=1)
        c.setStrokeColor(BRAND_BORDER)
        x += col_widths[0]

        # HEX
        c.setFillColor(BLACK)
        c.setFont('Helvetica-Bold', 9)
        c.drawString(x + 4, y, hex_code)
        x += col_widths[1]

        # RGB
        c.setFont('Helvetica', 9)
        c.drawString(x + 4, y, f'{r}, {g}, {b}')
        x += col_widths[2]

        # Pantone
        c.setFont('Helvetica', 9)
        c.drawString(x + 4, y, f'{pantone_name}{pantone_de}')
        x += col_widths[3]

        # Coverage
        c.setFont('Helvetica', 9)
        c.drawString(x + 4, y, f'{weight * 100:.1f}%')

        y -= row_h

        if y < 80:
            break  # prevent overflow off page

    # Visual palette bar at bottom
    y -= 30
    y = _draw_section_heading(c, y, 'Color Distribution')
    bar_y = y - 4
    bar_h = 28
    x = MARGIN
    for p in palette:
        r, g, b = p['rgb']
        seg_w = CONTENT_W * p['weight']
        if seg_w < 1:
            seg_w = 1
        c.setFillColorRGB(r / 255.0, g / 255.0, b / 255.0)
        c.rect(x, bar_y, seg_w, bar_h, fill=1, stroke=0)
        x += seg_w

    # Border around bar
    c.setStrokeColor(BRAND_BORDER)
    c.rect(MARGIN, bar_y, CONTENT_W, bar_h, fill=0, stroke=1)

    _draw_footer(c)
    c.showPage()


def _page_production_specs(c, project_metadata, options, total_pages):
    """Page 4 — Production Specifications."""
    _draw_header_bar(c, PAGE_H - 50, 'PRODUCTION SPECIFICATIONS', 4, total_pages)

    controls = project_metadata.get('controls', {})
    y = PAGE_H - 80

    # Fabric section
    y = _draw_section_heading(c, y, 'Fabric Details')
    fabric_type = options.get('fabric_type', 'Not specified')
    gsm = options.get('gsm', 'Not specified')
    fiber_content = options.get('fiber_content', 'Not specified')

    y = _draw_label_value(c, y, 'Fabric Type:', fabric_type.capitalize() if isinstance(fabric_type, str) else fabric_type)
    y = _draw_label_value(c, y, 'Fabric Weight:', f'{gsm} GSM' if gsm != 'Not specified' else gsm)
    y = _draw_label_value(c, y, 'Fiber Content:', fiber_content)

    y -= 10

    # Print section
    y = _draw_section_heading(c, y, 'Print Specifications')
    print_method = options.get('print_method', 'Digital (inkjet)')
    scale = controls.get('scale', 100)
    export_dpi = controls.get('export_dpi', 300)
    print_width = controls.get('print_width', 12)

    y = _draw_label_value(c, y, 'Print Method:', print_method)
    y = _draw_label_value(c, y, 'DPI Setting:', str(export_dpi))
    y = _draw_label_value(c, y, 'Scale:', f'{scale}%')

    y -= 10

    # Repeat section
    y = _draw_section_heading(c, y, 'Repeat & Dimensions')
    repeat_type = str(controls.get('repeat_type', 'block')).capitalize()
    shrinkage = options.get('shrinkage', '3-5%')

    y = _draw_label_value(c, y, 'Repeat Type:', repeat_type)
    y = _draw_label_value(c, y, 'Print Width:', f'{print_width} inches')
    y = _draw_label_value(c, y, 'Shrinkage Allowance:', str(shrinkage))

    y -= 10

    # Grid / Tiling info
    y = _draw_section_heading(c, y, 'Tiling & Grid')
    grid_size = controls.get('grid_size', 2)
    h_brush = controls.get('h_brush', 8)
    v_brush = controls.get('v_brush', 8)
    color_cleanup = controls.get('color_cleanup', True)
    edge_match = controls.get('edge_match', True)

    y = _draw_label_value(c, y, 'Grid Size:', f'{grid_size} × {grid_size}')
    y = _draw_label_value(c, y, 'Edge-Match Brush (H/V):', f'{h_brush} / {v_brush} px')
    y = _draw_label_value(c, y, 'Color Cleanup:', 'Enabled' if color_cleanup else 'Disabled')
    y = _draw_label_value(c, y, 'Edge Matching:', 'Enabled' if edge_match else 'Disabled')

    y -= 16

    # Notes box
    y = _draw_section_heading(c, y, 'Production Notes')
    c.setFillColor(BRAND_LIGHT_BG)
    notes_h = 80
    c.roundRect(MARGIN, y - notes_h + 10, CONTENT_W, notes_h, 4, fill=1, stroke=0)
    c.setFillColor(BRAND_MID_GRAY)
    c.setFont('Helvetica', 9)
    c.drawString(MARGIN + 10, y - 6,
                 '• Ensure colour calibration is performed before production run.')
    c.drawString(MARGIN + 10, y - 20,
                 f'• Recommended shrinkage allowance: {shrinkage}. Adjust pattern scale accordingly.')
    c.drawString(MARGIN + 10, y - 34,
                 '• Strike-off approval required before bulk production.')
    c.drawString(MARGIN + 10, y - 48,
                 '• All Pantone references are approximate digital matches — verify with physical swatch.')

    _draw_footer(c)
    c.showPage()


def _page_care_instructions(c, options, total_pages):
    """Page 5 — Care Instructions."""
    _draw_header_bar(c, PAGE_H - 50, 'CARE INSTRUCTIONS', 5, total_pages)

    y = PAGE_H - 80

    fabric_key = (options.get('fabric_type') or '').lower().strip()
    care = options.get('care_override') or CARE_PRESETS.get(fabric_key, DEFAULT_CARE)

    # If care_override is a dict, use it directly; otherwise use preset
    if isinstance(care, str):
        care = DEFAULT_CARE

    y = _draw_section_heading(c, y, 'Washing')
    y = _draw_label_value(c, y, 'Instructions:', care.get('wash', DEFAULT_CARE['wash']),
                          label_w=120)

    y -= 6
    y = _draw_section_heading(c, y, 'Ironing')
    y = _draw_label_value(c, y, 'Instructions:', care.get('iron', DEFAULT_CARE['iron']),
                          label_w=120)

    y -= 6
    y = _draw_section_heading(c, y, 'Bleaching')
    y = _draw_label_value(c, y, 'Instructions:', care.get('bleach', DEFAULT_CARE['bleach']),
                          label_w=120)

    y -= 6
    y = _draw_section_heading(c, y, 'Dry Cleaning')
    y = _draw_label_value(c, y, 'Instructions:', care.get('dry_clean', DEFAULT_CARE['dry_clean']),
                          label_w=120)

    y -= 6
    y = _draw_section_heading(c, y, 'Tumble Drying')
    y = _draw_label_value(c, y, 'Instructions:', care.get('tumble_dry', DEFAULT_CARE['tumble_dry']),
                          label_w=120)

    y -= 20
    y = _draw_section_heading(c, y, 'Additional Notes')
    c.setFillColor(BRAND_LIGHT_BG)
    notes_h = 60
    c.roundRect(MARGIN, y - notes_h + 10, CONTENT_W, notes_h, 4, fill=1, stroke=0)
    c.setFillColor(BLACK)
    c.setFont('Helvetica', 10)
    notes_text = care.get('notes', DEFAULT_CARE['notes'])
    # Simple wrap
    text_obj = c.beginText(MARGIN + 10, y - 6)
    text_obj.setFont('Helvetica', 10)
    text_obj.setLeading(14)
    words = notes_text.split()
    line = ''
    for w in words:
        if len(line) + len(w) + 1 > 80:
            text_obj.textLine(line)
            line = w
        else:
            line = (line + ' ' + w).strip()
    if line:
        text_obj.textLine(line)
    c.drawText(text_obj)

    y -= notes_h + 20

    # Care symbols summary table
    y = _draw_section_heading(c, y, 'Care Symbols Reference')
    symbols = [
        ('Washing', _care_symbol_code(care, 'wash')),
        ('Ironing', _care_symbol_code(care, 'iron')),
        ('Bleaching', _care_symbol_code(care, 'bleach')),
        ('Dry Cleaning', _care_symbol_code(care, 'dry_clean')),
        ('Drying', _care_symbol_code(care, 'tumble_dry')),
    ]
    col_widths = [150, CONTENT_W - 150]
    y = _draw_table_row(c, y, ['Category', 'Symbol Description'], col_widths,
                        bold=True, bg=BRAND_LIGHT_BG)
    for cat, desc in symbols:
        y = _draw_table_row(c, y, [cat, desc], col_widths)
        if y < 60:
            break

    _draw_footer(c)
    c.showPage()


def _care_symbol_code(care, key):
    """Return a short symbol-style summary for care labels."""
    text = care.get(key, '')
    if not text:
        return '—'
    # Return first sentence as symbol description
    return text.split('.')[0] + '.'


# ─── Main public function ────────────────────────────────────────────────────

def generate_tech_pack(image_path, project_metadata, output_path, options=None):
    """
    Generate a comprehensive, multi-page, industry-standard Tech Pack PDF.

    Args:
        image_path (str):       Path to the pattern image file.
        project_metadata (dict): Project data from DB (must include 'name', 'controls' sub-dict).
        output_path (str):      Destination file path for the PDF.
        options (dict, optional): Extended options dict. Keys:
            fabric_type     – e.g. 'cotton', 'polyester', 'silk'
            gsm             – fabric weight in GSM
            fiber_content   – e.g. '100% Cotton'
            print_method    – e.g. 'Digital (inkjet)', 'Rotary Screen'
            season          – e.g. 'SS26', 'AW26'
            company_name    – brand / company name
            description     – pattern description text
            shrinkage       – e.g. '3-5%'
            care_override   – dict overriding auto-generated care instructions
            version         – tech pack version string

    Returns:
        str: The output_path of the generated PDF.
    """
    if options is None:
        options = {}

    total_pages = 5

    # Extract palette for colour page
    try:
        palette = extract_palette(image_path, num_colors=8)
    except Exception as e:
        print(f'[techpack] Error extracting palette: {e}')
        palette = []

    c = canvas.Canvas(output_path, pagesize=A4)
    c.setTitle(f'Tech Pack — {project_metadata.get("name", "Untitled")}')
    c.setAuthor('RIMI AI')
    c.setSubject('Textile Design Tech Pack')

    # Page 1 — Cover
    _page_cover(c, project_metadata, options, total_pages)

    # Page 2 — Design Preview
    _page_design_preview(c, image_path, project_metadata, options, total_pages)

    # Page 3 — Color Specifications
    _page_color_specs(c, palette, total_pages)

    # Page 4 — Production Specifications
    _page_production_specs(c, project_metadata, options, total_pages)

    # Page 5 — Care Instructions
    _page_care_instructions(c, options, total_pages)

    c.save()
    return output_path
