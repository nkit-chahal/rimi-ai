"""Shade cards (Pantone / thread / yarn) and per-project thread palettes. All endpoints are free: matching is deterministic."""
import json
from datetime import datetime, timezone

from flask import Blueprint, g, jsonify, request
from middleware import login_required, project_access_from_payload, assert_project_access

from db import db, db_lock
import shade_cards as cards

bp = Blueprint('shade_cards', __name__)

MAX_PALETTE_ENTRIES = 200


def _now_iso():
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat()


# ---------------------------------------------------------------------------
# Shade cards
# ---------------------------------------------------------------------------
@bp.route('/api/shade-cards', methods=['GET'])
@login_required
def list_shade_cards():
    return jsonify({'success': True, 'cards': cards.list_cards(g.current_user['id'])})


@bp.route('/api/shade-cards', methods=['POST'])
@login_required
def create_shade_card():
    data = request.get_json(silent=True) or {}
    try:
        card = cards.create_card(
            g.current_user['id'],
            data.get('name'),
            data.get('brand'),
            data.get('kind'),
            data.get('entries'),
            data.get('note'),
        )
    except ValueError as exc:
        return jsonify({'success': False, 'error': str(exc)}), 400
    return jsonify({'success': True, 'card': card})


@bp.route('/api/shade-cards/<card_id>', methods=['GET'])
@login_required
def get_shade_card(card_id):
    card = cards.get_card(card_id, g.current_user['id'])
    if not card:
        return jsonify({'success': False, 'error': 'Shade card not found'}), 404
    payload = cards.summarize(card)
    payload['entries'] = card['entries']
    return jsonify({'success': True, 'card': payload})


@bp.route('/api/shade-cards/<card_id>', methods=['DELETE'])
@login_required
def delete_shade_card(card_id):
    if card_id in cards._load_builtin():
        return jsonify({'success': False, 'error': 'Built-in cards cannot be deleted'}), 400
    if not cards.delete_card(card_id, g.current_user['id']):
        return jsonify({'success': False, 'error': 'Shade card not found'}), 404
    return jsonify({'success': True})


@bp.route('/api/shade-cards/match', methods=['POST'])
@login_required
def match_shade_card():
    data = request.get_json(silent=True) or {}
    card_id = str(data.get('cardId') or cards.PANTONE_CARD_ID)
    colors = data.get('colors')
    if isinstance(colors, str):
        colors = [colors]
    if not isinstance(colors, list) or not colors:
        return jsonify({'success': False, 'error': 'colors must be a non-empty list of hex values'}), 400
    if len(colors) > cards.MAX_MATCH_COLORS:
        return jsonify({'success': False, 'error': f'At most {cards.MAX_MATCH_COLORS} colours per request'}), 400
    card = cards.get_card(card_id, g.current_user['id'])
    if not card:
        return jsonify({'success': False, 'error': 'Shade card not found'}), 404
    try:
        top_n = int(data.get('topN', 3))
    except (TypeError, ValueError):
        top_n = 3
    results = cards.match_colors(card, [str(c) for c in colors], top_n=top_n)
    return jsonify({'success': True, 'cardId': card['id'], 'cardName': card['name'], 'results': results})


# ---------------------------------------------------------------------------
# Thread palettes (saved per project)
# ---------------------------------------------------------------------------
def _serialize_palette(row):
    return {
        'id': row['id'],
        'projectId': row['project_id'],
        'name': row['name'],
        'cardId': row['card_id'],
        'entries': json.loads(row['entries_json'] or '[]'),
        'createdAt': row['created_at'],
    }


@bp.route('/api/thread-palettes', methods=['GET'])
@login_required
def list_thread_palettes():
    raw_project = request.args.get('projectId') or request.args.get('project_id')
    if not raw_project:
        return jsonify({'success': False, 'error': 'projectId is required'}), 400
    try:
        project_id = int(raw_project)
    except ValueError:
        return jsonify({'success': False, 'error': 'projectId must be a number'}), 400
    denied = assert_project_access(project_id)
    if denied:
        return denied
    with db_lock:
        conn = db()
        try:
            rows = conn.execute(
                "SELECT * FROM thread_palettes WHERE project_id = ? AND user_id = ? ORDER BY created_at DESC",
                (project_id, g.current_user['id']),
            ).fetchall()
        finally:
            conn.close()
    return jsonify({'success': True, 'palettes': [_serialize_palette(row) for row in rows]})


@bp.route('/api/thread-palettes', methods=['POST'])
@login_required
def create_thread_palette():
    data = request.get_json(silent=True) or {}
    project_id, access_error = project_access_from_payload(data)
    if access_error:
        return access_error
    name = str(data.get('name') or '').strip()[:80]
    if not name:
        return jsonify({'success': False, 'error': 'name is required'}), 400
    entries = data.get('entries')
    if not isinstance(entries, list) or not entries:
        return jsonify({'success': False, 'error': 'entries must be a non-empty list'}), 400
    if len(entries) > MAX_PALETTE_ENTRIES:
        return jsonify({'success': False, 'error': f'At most {MAX_PALETTE_ENTRIES} entries per palette'}), 400

    cleaned = []
    for index, raw in enumerate(entries):
        if not isinstance(raw, dict):
            return jsonify({'success': False, 'error': f'Entry {index + 1} must be an object'}), 400
        hex_value = cards.normalize_hex(raw.get('hex'))
        if not hex_value:
            return jsonify({'success': False, 'error': f'Entry {index + 1} has an invalid hex colour'}), 400
        cleaned.append({
            'sourceHex': cards.normalize_hex(raw.get('sourceHex')) or hex_value,
            'code': str(raw.get('code') or '').strip()[:40],
            'name': str(raw.get('name') or '').strip()[:80],
            'hex': hex_value,
            'deltaE': float(raw.get('deltaE') or 0),
        })

    card_id = str(data.get('cardId') or '')[:80]
    now = _now_iso()
    with db_lock:
        conn = db()
        try:
            cur = conn.execute(
                """
                INSERT INTO thread_palettes (user_id, project_id, name, card_id, entries_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (g.current_user['id'], project_id, name, card_id, json.dumps(cleaned), now),
            )
            conn.commit()
            new_id = cur.lastrowid
        finally:
            conn.close()
    return jsonify({
        'success': True,
        'palette': {'id': new_id, 'projectId': project_id, 'name': name, 'cardId': card_id, 'entries': cleaned, 'createdAt': now},
    })


@bp.route('/api/thread-palettes/<int:palette_id>', methods=['DELETE'])
@login_required
def delete_thread_palette(palette_id):
    with db_lock:
        conn = db()
        try:
            cur = conn.execute(
                "DELETE FROM thread_palettes WHERE id = ? AND user_id = ?",
                (palette_id, g.current_user['id']),
            )
            conn.commit()
            deleted = cur.rowcount > 0
        finally:
            conn.close()
    if not deleted:
        return jsonify({'success': False, 'error': 'Palette not found'}), 404
    return jsonify({'success': True})
