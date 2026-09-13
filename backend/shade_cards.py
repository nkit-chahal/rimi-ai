"""Shade cards: Pantone TCX plus thread and yarn shade cards, matched by CIE Delta E 2000.

Built-in cards come from ``pantone_data.json`` and ``data/shade_cards/*.json``.
Custom cards are stored per user in the ``shade_cards`` table and addressed as ``custom-<id>``.
The matcher is the same one Pantone uses, so a thread card behaves exactly like Pantone for prints.
"""
import glob
import json
import os
import re
from datetime import datetime, timezone

import numpy as np

from db import db, db_lock
from pantone_utils import HAS_COLOUR, _load_pantone_db, _rgb_to_lab

if HAS_COLOUR:
    from colour.difference import delta_E_CIE2000

DATA_DIR = os.path.join(os.path.dirname(__file__), 'data', 'shade_cards')
PANTONE_CARD_ID = 'pantone-tcx'
CUSTOM_PREFIX = 'custom-'
KINDS = ('pantone', 'thread', 'yarn', 'custom')
MAX_ENTRIES = 5000
MAX_MATCH_COLORS = 64
MAX_TOP_N = 10

_HEX_RE = re.compile(r'^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$')
_BUILTIN = None


def _now_iso():
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat()


def normalize_hex(value):
    """Return '#rrggbb' lowercase for '#abc', 'abc', '#AABBCC' style input, or None when invalid."""
    if not isinstance(value, str):
        return None
    match = _HEX_RE.match(value.strip())
    if not match:
        return None
    digits = match.group(1).lower()
    if len(digits) == 3:
        digits = ''.join(ch * 2 for ch in digits)
    return f'#{digits}'


def hex_to_rgb(hex_value):
    digits = hex_value.lstrip('#')
    return tuple(int(digits[i:i + 2], 16) for i in (0, 2, 4))


def _lab_matrix(entries):
    if not entries:
        return np.zeros((0, 3), dtype=np.float64)
    return np.array([_rgb_to_lab(hex_to_rgb(entry['hex'])) for entry in entries], dtype=np.float64)


def clean_entries(raw_entries):
    """Validate and normalize user supplied entries. Raises ValueError with a user-facing message."""
    if not isinstance(raw_entries, list) or not raw_entries:
        raise ValueError('entries must be a non-empty list')
    if len(raw_entries) > MAX_ENTRIES:
        raise ValueError(f'A shade card can hold at most {MAX_ENTRIES} entries')
    cleaned = []
    seen = set()
    for index, raw in enumerate(raw_entries):
        if not isinstance(raw, dict):
            raise ValueError(f'Entry {index + 1} must be an object')
        hex_value = normalize_hex(raw.get('hex') or raw.get('color') or raw.get('colour'))
        if not hex_value:
            raise ValueError(f'Entry {index + 1} has an invalid hex colour')
        code = str(raw.get('code') or raw.get('number') or '').strip()[:40]
        if not code:
            raise ValueError(f'Entry {index + 1} needs a shade code')
        if code.lower() in seen:
            raise ValueError(f'Duplicate shade code "{code}"')
        seen.add(code.lower())
        name = str(raw.get('name') or '').strip()[:80]
        cleaned.append({'code': code, 'name': name, 'hex': hex_value})
    return cleaned


def _pantone_entries():
    entries = []
    for row in _load_pantone_db():
        full_name = str(row.get('name') or '')
        code = full_name.replace('PANTONE', '').split(' TCX')[0].strip()
        name = full_name.split(' TCX', 1)[1].strip() if ' TCX' in full_name else ''
        hex_value = normalize_hex(row.get('hex'))
        if hex_value and code:
            entries.append({'code': code, 'name': name, 'hex': hex_value})
    return entries


def _load_builtin():
    global _BUILTIN
    if _BUILTIN is not None:
        return _BUILTIN

    cards = {}
    pantone_entries = _pantone_entries()
    cards[PANTONE_CARD_ID] = {
        'id': PANTONE_CARD_ID,
        'name': 'Pantone TCX',
        'brand': 'Pantone',
        'kind': 'pantone',
        'note': 'Fashion, home and interiors cotton swatch library.',
        'builtIn': True,
        'entries': pantone_entries,
        'lab': _lab_matrix(pantone_entries),
    }

    for path in sorted(glob.glob(os.path.join(DATA_DIR, '*.json'))):
        try:
            with open(path, 'r', encoding='utf-8') as handle:
                raw = json.load(handle)
            entries = clean_entries(raw.get('entries'))
            card_id = str(raw.get('id') or os.path.splitext(os.path.basename(path))[0]).strip()
            if not card_id or card_id.startswith(CUSTOM_PREFIX):
                raise ValueError('invalid built-in card id')
            kind = raw.get('kind') if raw.get('kind') in KINDS else 'thread'
            cards[card_id] = {
                'id': card_id,
                'name': str(raw.get('name') or card_id)[:80],
                'brand': str(raw.get('brand') or '')[:60],
                'kind': kind,
                'note': str(raw.get('note') or '')[:400],
                'builtIn': True,
                'entries': entries,
                'lab': _lab_matrix(entries),
            }
        except Exception as exc:  # A broken data file must not take the API down.
            print(f"  [ShadeCards] Skipping {os.path.basename(path)}: {exc}")

    _BUILTIN = cards
    return _BUILTIN


def summarize(card):
    return {
        'id': card['id'],
        'name': card['name'],
        'brand': card.get('brand') or '',
        'kind': card.get('kind') or 'custom',
        'note': card.get('note') or '',
        'builtIn': bool(card.get('builtIn')),
        'count': len(card.get('entries') or []),
        'createdAt': card.get('createdAt'),
    }


def _custom_row_to_card(row, with_entries=True):
    entries = json.loads(row['entries_json'] or '[]') if with_entries else []
    return {
        'id': f"{CUSTOM_PREFIX}{row['id']}",
        'name': row['name'],
        'brand': row['brand'] or '',
        'kind': row['kind'] or 'custom',
        'note': row['note'] or '',
        'builtIn': False,
        'createdAt': row['created_at'],
        'entries': entries,
        'count': len(entries),
    }


def list_cards(user_id):
    cards = [summarize(card) for card in _load_builtin().values()]
    with db_lock:
        conn = db()
        try:
            rows = conn.execute(
                "SELECT id, user_id, name, brand, kind, note, entries_json, created_at FROM shade_cards WHERE user_id = ? ORDER BY created_at DESC",
                (user_id,),
            ).fetchall()
        finally:
            conn.close()
    for row in rows:
        cards.append(summarize(_custom_row_to_card(row)))
    return cards


def get_card(card_id, user_id):
    """Return a full card (with entries and lab matrix) or None."""
    builtin = _load_builtin().get(card_id)
    if builtin:
        return builtin
    if not str(card_id).startswith(CUSTOM_PREFIX):
        return None
    try:
        raw_id = int(str(card_id)[len(CUSTOM_PREFIX):])
    except ValueError:
        return None
    with db_lock:
        conn = db()
        try:
            row = conn.execute(
                "SELECT id, user_id, name, brand, kind, note, entries_json, created_at FROM shade_cards WHERE id = ? AND user_id = ?",
                (raw_id, user_id),
            ).fetchone()
        finally:
            conn.close()
    if not row:
        return None
    card = _custom_row_to_card(row)
    card['lab'] = _lab_matrix(card['entries'])
    return card


def create_card(user_id, name, brand, kind, entries, note=''):
    name = str(name or '').strip()[:80]
    if not name:
        raise ValueError('name is required')
    kind = kind if kind in KINDS else 'custom'
    cleaned = clean_entries(entries)
    now = _now_iso()
    with db_lock:
        conn = db()
        try:
            cur = conn.execute(
                """
                INSERT INTO shade_cards (user_id, name, brand, kind, note, entries_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (user_id, name, str(brand or '')[:60], kind, str(note or '')[:400], json.dumps(cleaned), now),
            )
            conn.commit()
            new_id = cur.lastrowid
        finally:
            conn.close()
    return {
        'id': f'{CUSTOM_PREFIX}{new_id}',
        'name': name,
        'brand': str(brand or '')[:60],
        'kind': kind,
        'note': str(note or '')[:400],
        'builtIn': False,
        'createdAt': now,
        'entries': cleaned,
        'count': len(cleaned),
    }


def delete_card(card_id, user_id):
    if not str(card_id).startswith(CUSTOM_PREFIX):
        return False
    try:
        raw_id = int(str(card_id)[len(CUSTOM_PREFIX):])
    except ValueError:
        return False
    with db_lock:
        conn = db()
        try:
            cur = conn.execute("DELETE FROM shade_cards WHERE id = ? AND user_id = ?", (raw_id, user_id))
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()


def _distances(target_lab, labs):
    if labs.shape[0] == 0:
        return np.zeros(0)
    if HAS_COLOUR:
        try:
            tiled = np.tile(np.asarray(target_lab, dtype=np.float64), (labs.shape[0], 1))
            return np.asarray(delta_E_CIE2000(tiled, labs), dtype=np.float64).reshape(-1)
        except Exception:
            pass
    diff = labs - np.asarray(target_lab, dtype=np.float64)
    return np.sqrt(np.sum(diff * diff, axis=1))


def match_colors(card, hex_values, top_n=3):
    """Nearest shades on ``card`` for each hex colour. Returns [{hex, matches: [...]}, ...]."""
    top_n = max(1, min(int(top_n or 3), MAX_TOP_N))
    entries = card.get('entries') or []
    labs = card.get('lab')
    if labs is None:
        labs = _lab_matrix(entries)
    results = []
    for raw in hex_values[:MAX_MATCH_COLORS]:
        hex_value = normalize_hex(raw)
        if not hex_value:
            results.append({'hex': raw, 'error': 'Invalid hex colour', 'matches': []})
            continue
        distances = _distances(_rgb_to_lab(hex_to_rgb(hex_value)), labs)
        order = np.argsort(distances)[:top_n]
        matches = [
            {
                'code': entries[i]['code'],
                'name': entries[i].get('name') or '',
                'hex': entries[i]['hex'],
                'deltaE': round(float(distances[i]), 2),
            }
            for i in order
        ]
        results.append({'hex': hex_value, 'matches': matches})
    return results
