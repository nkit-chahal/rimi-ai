"""Embroidery tech pack PDF: placement sheet, thread list, stitch estimates and production notes."""
from datetime import datetime, timezone

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.pdfgen import canvas as pdf_canvas

from services.stitch_render import DENSITIES, STITCH_STYLES

PAGE_W, PAGE_H = A4
MARGIN = 1.6 * cm
CONTENT_W = PAGE_W - 2 * MARGIN
INK = colors.HexColor('#1c1917')
MUTED = colors.HexColor('#78716c')
LINE = colors.HexColor('#e7e2dc')
ACCENT = colors.HexColor('#be123c')
SOFT = colors.HexColor('#faf8f5')

STABILISER_BY_FABRIC = {
    'cotton': 'Medium-weight tear-away stabiliser; hoop firmly.',
    'linen': 'Medium-weight tear-away; pre-wash to remove sizing.',
    'silk': 'Lightweight cut-away or wash-away topping; use a sharp 65/9 needle.',
    'velvet': 'Cut-away stabiliser plus a water-soluble topping so stitches do not sink into the pile.',
    'georgette': 'Wash-away stabiliser front and back; keep designs open and light.',
    'denim': 'Medium cut-away; use a 90/14 needle.',
    'wool': 'Cut-away stabiliser and a water-soluble topping.',
    'jersey': 'Fusible cut-away (no-show mesh) to stop stretch distortion; ballpoint needle.',
}


def estimate_stitches(area_cm2, style='satin', density='medium'):
    """Planning estimate only. Stitches per cm² by style, scaled by density."""
    base = STITCH_STYLES.get(style, STITCH_STYLES['satin'])['density']
    factor = DENSITIES.get(density, DENSITIES['medium'])[1]
    return int(round(max(0.0, float(area_cm2)) * base * factor))


def _text(c, x, y, text, size=10, bold=False, color=INK):
    c.setFont('Helvetica-Bold' if bold else 'Helvetica', size)
    c.setFillColor(color)
    c.drawString(x, y, str(text))


def _header(c, title, subtitle, page_num, total):
    c.setFillColor(SOFT)
    c.rect(0, PAGE_H - 2.4 * cm, PAGE_W, 2.4 * cm, stroke=0, fill=1)
    _text(c, MARGIN, PAGE_H - 1.25 * cm, title, 15, True)
    _text(c, MARGIN, PAGE_H - 1.85 * cm, subtitle, 8.5, False, MUTED)
    _text(c, PAGE_W - MARGIN - 2.2 * cm, PAGE_H - 1.5 * cm, f'Page {page_num} / {total}', 8.5, False, MUTED)
    c.setStrokeColor(ACCENT)
    c.setLineWidth(2)
    c.line(0, PAGE_H - 2.4 * cm, PAGE_W, PAGE_H - 2.4 * cm)


def _footer(c, note):
    c.setStrokeColor(LINE)
    c.setLineWidth(0.5)
    c.line(MARGIN, 1.6 * cm, PAGE_W - MARGIN, 1.6 * cm)
    _text(c, MARGIN, 1.1 * cm, note, 7.5, False, MUTED)


def _section(c, y, text):
    _text(c, MARGIN, y, text.upper(), 8.5, True, ACCENT)
    c.setStrokeColor(LINE)
    c.setLineWidth(0.5)
    c.line(MARGIN, y - 0.2 * cm, PAGE_W - MARGIN, y - 0.2 * cm)
    return y - 0.75 * cm


def _row(c, y, cells, widths, bold=False, size=8.5, fill=None):
    if fill is not None:
        c.setFillColor(fill)
        c.rect(MARGIN, y - 0.18 * cm, CONTENT_W, 0.62 * cm, stroke=0, fill=1)
    x = MARGIN + 0.15 * cm
    for cell, width in zip(cells, widths):
        _text(c, x, y, cell, size, bold)
        x += width
    return y - 0.62 * cm


def _swatch(c, x, y, hex_value, size=0.42 * cm):
    try:
        c.setFillColor(colors.HexColor(hex_value or '#cccccc'))
    except ValueError:
        c.setFillColor(colors.HexColor('#cccccc'))
    c.setStrokeColor(LINE)
    c.roundRect(x, y - 0.1 * cm, size, size, 2, stroke=1, fill=1)


def _fmt(value, digits=1):
    return f'{float(value):.{digits}f}'


def build_embroidery_tech_pack(output_path, spec):
    """Write the PDF. ``spec`` keys: title, project_name, company, design_path, doc_width_px, doc_height_px,
    physical_width_cm, product, zone, technique, fabric, base, layers[], threads[], notes."""
    layers = spec.get('layers') or []
    threads = spec.get('threads') or []
    total_pages = 3 + (1 if threads else 0)
    page = 0
    title = spec.get('title') or 'Embroidery tech pack'
    subtitle = f"{spec.get('project_name') or 'Project'} · {spec.get('company') or 'RIMI AI'} · {datetime.now(timezone.utc).strftime('%d %b %Y')}"
    footer_note = 'Stitch counts are planning estimates derived from motif area and density. The embroidery unit\'s digitised file is authoritative.'

    c = pdf_canvas.Canvas(output_path, pagesize=A4)

    # ---- Page 1: overview -------------------------------------------------------------------
    page += 1
    _header(c, title, subtitle, page, total_pages)
    y = PAGE_H - 3.4 * cm
    y = _section(c, y, 'Design')
    image_bottom = y
    if spec.get('design_path'):
        try:
            from reportlab.lib.utils import ImageReader
            reader = ImageReader(spec['design_path'])
            iw, ih = reader.getSize()
            max_w, max_h = CONTENT_W, 9.5 * cm
            scale = min(max_w / iw, max_h / ih)
            w, h = iw * scale, ih * scale
            c.drawImage(reader, MARGIN + (CONTENT_W - w) / 2, y - h, w, h, mask='auto')
            image_bottom = y - h - 0.6 * cm
        except Exception:
            _text(c, MARGIN, y - 0.5 * cm, 'Design preview unavailable', 9, False, MUTED)
            image_bottom = y - 1.2 * cm
    y = image_bottom
    y = _section(c, y, 'Summary')
    px_per_cm = spec.get('px_per_cm') or 0
    physical_h = (spec.get('doc_height_px') or 0) / px_per_cm if px_per_cm else 0
    total_stitches = sum(int(layer.get('stitches') or 0) for layer in layers)
    facts = [
        ('Product / zone', f"{spec.get('product') or '-'} · {spec.get('zone') or '-'}"),
        ('Technique', spec.get('technique') or '-'),
        ('Fabric / base', f"{spec.get('fabric') or '-'} · {spec.get('base') or '-'}"),
        ('Design size', f"{_fmt(spec.get('physical_width_cm') or 0)} × {_fmt(physical_h)} cm  ({spec.get('doc_width_px')} × {spec.get('doc_height_px')} px)"),
        ('Motifs placed', str(len(layers))),
        ('Estimated stitches', f'{total_stitches:,}'),
        ('Thread shades', str(len(threads))),
    ]
    for label, value in facts:
        _text(c, MARGIN, y, label, 8.5, False, MUTED)
        _text(c, MARGIN + 4.2 * cm, y, value, 9.5, True)
        y -= 0.62 * cm
    if spec.get('notes'):
        y -= 0.2 * cm
        y = _section(c, y, 'Notes')
        for line in str(spec['notes']).splitlines()[:12]:
            _text(c, MARGIN, y, line[:110], 9)
            y -= 0.5 * cm
    _footer(c, footer_note)
    c.showPage()

    # ---- Page 2: placement sheet -----------------------------------------------------------
    page += 1
    _header(c, 'Placement sheet', subtitle, page, total_pages)
    y = PAGE_H - 3.4 * cm
    y = _section(c, y, f"Motif positions (centre from top-left, cm) · {_fmt(spec.get('physical_width_cm') or 0)} cm wide design")
    widths = [0.9 * cm, 4.6 * cm, 2.6 * cm, 2.6 * cm, 1.6 * cm, 3.0 * cm, 2.6 * cm]
    y = _row(c, y, ['#', 'Motif', 'Centre X, Y', 'Size W × H', 'Angle', 'Stitch style', 'Est. stitches'], widths, True, 8, SOFT)
    for index, layer in enumerate(layers, start=1):
        if y < 3 * cm:
            _footer(c, footer_note)
            c.showPage()
            page += 1
            total_pages += 1
            _header(c, 'Placement sheet (continued)', subtitle, page, total_pages)
            y = PAGE_H - 3.4 * cm
        style_label = STITCH_STYLES.get(layer.get('stitch_style'), STITCH_STYLES['satin'])['label']
        y = _row(c, y, [
            str(index),
            str(layer.get('name') or 'Motif')[:26],
            f"{_fmt(layer.get('x_cm'))}, {_fmt(layer.get('y_cm'))}",
            f"{_fmt(layer.get('w_cm'))} × {_fmt(layer.get('h_cm'))}",
            f"{int(round(float(layer.get('angle') or 0)))}°",
            f"{style_label} · {layer.get('density') or 'medium'}",
            f"{int(layer.get('stitches') or 0):,}",
        ], widths)
    y = _row(c, y, ['', 'Total', '', '', '', '', f'{total_stitches:,}'], widths, True, 8.5, SOFT)
    y -= 0.4 * cm
    _text(c, MARGIN, y, 'Coverage is the share of each motif\'s bounding box that is stitched; sizes include rotation.', 8, False, MUTED)
    _footer(c, footer_note)
    c.showPage()

    # ---- Page 3 (optional): threads --------------------------------------------------------
    if threads:
        page += 1
        _header(c, 'Thread list', subtitle, page, total_pages)
        y = PAGE_H - 3.4 * cm
        y = _section(c, y, f"Shade card: {spec.get('thread_card') or 'as matched'}")
        twidths = [1.0 * cm, 2.8 * cm, 5.2 * cm, 2.6 * cm, 2.4 * cm, 3.0 * cm]
        y = _row(c, y, ['', 'Code', 'Name', 'Hex', 'Delta E', 'Source colour'], twidths, True, 8, SOFT)
        for thread in threads[:60]:
            if y < 3 * cm:
                _footer(c, footer_note)
                c.showPage()
                page += 1
                total_pages += 1
                _header(c, 'Thread list (continued)', subtitle, page, total_pages)
                y = PAGE_H - 3.4 * cm
            _swatch(c, MARGIN + 0.15 * cm, y, thread.get('hex'))
            delta = thread.get('deltaE')
            y = _row(c, y, [
                '',
                str(thread.get('code') or '-'),
                str(thread.get('name') or '')[:34],
                str(thread.get('hex') or ''),
                _fmt(delta) if delta not in (None, '') else '-',
                str(thread.get('sourceHex') or ''),
            ], twidths)
        _footer(c, footer_note)
        c.showPage()

    # ---- Last page: production notes -------------------------------------------------------
    page += 1
    _header(c, 'Production notes', subtitle, page, total_pages)
    y = PAGE_H - 3.4 * cm
    y = _section(c, y, 'Stabiliser and needle')
    fabric_key = str(spec.get('fabric') or '').lower()
    _text(c, MARGIN, y, STABILISER_BY_FABRIC.get(fabric_key, 'Choose a stabiliser to match the fabric weight; test on a swatch first.'), 9.5)
    y -= 1.0 * cm
    y = _section(c, y, 'Stitch styles used')
    used = sorted({layer.get('stitch_style') or 'satin' for layer in layers}) or ['satin']
    for key in used:
        style = STITCH_STYLES.get(key, STITCH_STYLES['satin'])
        _text(c, MARGIN, y, style['label'], 9.5, True)
        _text(c, MARGIN + 4.2 * cm, y, f"{style['blurb']}  ~{style['density']} stitches/cm² at medium density.", 9)
        y -= 0.6 * cm
    y -= 0.3 * cm
    y = _section(c, y, 'Checks before sampling')
    for line in [
        'Confirm the physical design width on the garment pattern piece before digitising.',
        'Match thread shades against the physical shade card under daylight; Delta E under 2 is a visual match.',
        'Sew a test swatch on the actual fabric to confirm density, pull compensation and shrinkage.',
        'Trim, press from the reverse with a pressing cloth, and check the back for loose ends.',
    ]:
        _text(c, MARGIN, y, f'• {line}', 9)
        y -= 0.55 * cm
    _footer(c, footer_note)
    c.showPage()
    c.save()
    return output_path
