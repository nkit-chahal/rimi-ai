"""Nightly retention sweep for orphaned Qwen layer assets."""
import json
import os
from datetime import datetime, timedelta, timezone

from config import RESULTS_DIR
from db import db, db_lock
import storage

LAYER_PREFIXES = ('layer_', 'layedit_', 'layinpaint_', 'composed_', 'smartmask_')


def _collect_referenced_filenames():
    referenced = set()
    with db_lock:
        conn = db()
        try:
            export_rows = conn.execute("SELECT filename FROM exports").fetchall()
            for row in export_rows:
                if row['filename']:
                    referenced.add(row['filename'])

            version_rows = conn.execute("SELECT filename FROM qwen_layer_versions").fetchall()
            for row in version_rows:
                if row['filename']:
                    referenced.add(row['filename'])

            session_rows = conn.execute(
                "SELECT source_filename, thumbnail_filename, last_composed_filename, document_json FROM qwen_layered_sessions"
            ).fetchall()
            for row in session_rows:
                for key in ('source_filename', 'thumbnail_filename', 'last_composed_filename'):
                    if row[key]:
                        referenced.add(row[key])
                try:
                    doc = json.loads(row['document_json'] or '{}')
                    for layer in doc.get('layers', []):
                        if layer.get('filename'):
                            referenced.add(layer['filename'])
                except json.JSONDecodeError:
                    pass
        finally:
            conn.close()
    return referenced


def sweep_orphaned_layer_files(max_age_days=30, dry_run=False):
    """Delete layer files not referenced anywhere and older than max_age_days."""
    referenced = _collect_referenced_filenames()
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=max_age_days)
    deleted = []
    skipped = []

    if not os.path.exists(RESULTS_DIR):
        return {'deleted': deleted, 'skipped': skipped}

    for filename in os.listdir(RESULTS_DIR):
        if not filename.lower().startswith(LAYER_PREFIXES):
            continue
        if filename in referenced:
            skipped.append(filename)
            continue
        filepath = os.path.join(RESULTS_DIR, filename)
        if not os.path.isfile(filepath):
            continue
        mtime = datetime.utcfromtimestamp(os.path.getmtime(filepath))
        if mtime > cutoff:
            skipped.append(filename)
            continue
        if dry_run:
            deleted.append(filename)
            continue
        try:
            os.remove(filepath)
            storage.delete_from_s3('results', filename)
            deleted.append(filename)
        except Exception as exc:
            print(f"  [Cleanup] Failed to delete {filename}: {exc}")

    return {'deleted': deleted, 'skipped': skipped, 'referencedCount': len(referenced)}
