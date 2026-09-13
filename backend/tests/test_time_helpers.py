"""Timestamp helpers must accept naive and offset-aware ISO values (the DB holds both)."""
from datetime import datetime, timedelta, timezone

from db import iso_to_epoch, parse_iso_naive_utc, time_ago


def test_parse_handles_naive_aware_and_z():
    assert parse_iso_naive_utc('2026-09-05T17:16:00.791315') == datetime(2026, 9, 5, 17, 16, 0, 791315)
    assert parse_iso_naive_utc('2026-09-05T17:16:00.791315+00:00') == datetime(2026, 9, 5, 17, 16, 0, 791315)
    assert parse_iso_naive_utc('2026-09-05T22:46:00+05:30') == datetime(2026, 9, 5, 17, 16, 0)
    assert parse_iso_naive_utc('2026-09-05T17:16:00Z') == datetime(2026, 9, 5, 17, 16, 0)
    assert parse_iso_naive_utc('not a date') is None
    assert parse_iso_naive_utc(None) is None


def test_time_ago_never_raises_on_offset_timestamps():
    recent_aware = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    assert time_ago(recent_aware) == 'Updated 2h ago'
    old_naive = (datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=3)).isoformat()
    assert time_ago(old_naive) == 'Updated 3 days ago'
    assert time_ago('garbage') == 'Updated recently'
    assert time_ago(None) == 'Updated recently'


def test_iso_to_epoch_is_consistent_across_offsets():
    naive = iso_to_epoch('2026-09-05T17:16:00')
    aware = iso_to_epoch('2026-09-05T17:16:00+00:00')
    ist = iso_to_epoch('2026-09-05T22:46:00+05:30')
    assert naive == aware == ist
    assert iso_to_epoch('nope') == 0.0
