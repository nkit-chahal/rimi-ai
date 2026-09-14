"""Postgres lastrowid emulation must cover every table whose id a caller reads back.

SQLite gives a real cursor.lastrowid, so a table missing from _RETURNING_ID_TABLES works perfectly
in dev and returns None only on Postgres. background_jobs was missing: every async job enqueued as
"rimi-None-<hash>" and the worker died with "Job None not found", visible only in production.
"""
import re
from pathlib import Path

import pytest

from db import _PgCursorWrapper as PGCursor

BACKEND = Path(__file__).resolve().parents[1]

INSERT_RE = re.compile(r'INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+([a-z_]+)', re.IGNORECASE)


def _tables_whose_id_is_read():
    """Every table where source does `cur.lastrowid` after inserting into it."""
    found = set()
    for path in list(BACKEND.glob('*.py')) + list(BACKEND.glob('routes/*.py')) + list(BACKEND.glob('services/*.py')):
        if path.parent.name == 'tests':
            continue
        lines = path.read_text(encoding='utf-8').splitlines()
        for idx, line in enumerate(lines):
            if 'lastrowid' not in line or 'def lastrowid' in line or '_lastrowid' in line:
                continue
            # Walk back to the most recent INSERT in the same file.
            for prev in range(idx, max(-1, idx - 60), -1):
                match = INSERT_RE.search(lines[prev])
                if match:
                    found.add(match.group(1).lower())
                    break
    return found


def test_every_table_read_back_is_in_the_returning_allowlist():
    missing = _tables_whose_id_is_read() - PGCursor._RETURNING_ID_TABLES
    assert not missing, (
        f"These tables have their id read via cur.lastrowid but are not in "
        f"_RETURNING_ID_TABLES, so they return None on Postgres: {sorted(missing)}"
    )


def test_background_jobs_is_covered():
    """The specific regression: async jobs enqueued with a None id."""
    assert 'background_jobs' in PGCursor._RETURNING_ID_TABLES


@pytest.mark.parametrize('table', sorted(PGCursor._RETURNING_ID_TABLES))
def test_allowlisted_inserts_get_returning_id(table):
    sql = PGCursor._convert_query(f"INSERT INTO {table} (a, b) VALUES (?, ?)")
    assert PGCursor._insert_table(sql) == table
    assert table in PGCursor._RETURNING_ID_TABLES


def test_insert_table_ignores_non_inserts():
    assert PGCursor._insert_table("UPDATE projects SET a = 1") is None
    assert PGCursor._insert_table("SELECT * FROM projects") is None
