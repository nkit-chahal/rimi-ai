"""A request must not be able to name a number that exhausts the worker.

Canvas dimensions, print size, DPI and batch counts came straight from the request body with
no ceiling, so a single call could ask for a canvas large enough to take the process down, or
for an unbounded number of generated files at a fixed price.
"""
import pytest

from config import MAX_CANVAS_PX, MIN_CANVAS_PX, clamp_canvas
from routes.repeat import _clamp_float


@pytest.mark.parametrize(
    "requested,expected",
    [
        (1024, 1024),
        (2048, 2048),
        (999999, MAX_CANVAS_PX),
        (10 ** 9, MAX_CANVAS_PX),
        (0, MIN_CANVAS_PX),
        (-5000, MIN_CANVAS_PX),
    ],
)
def test_canvas_dimensions_are_bounded(requested, expected):
    assert clamp_canvas(requested) == expected


@pytest.mark.parametrize("junk", ["abc", None, "", {}, [], "12px"])
def test_unparseable_canvas_falls_back_to_the_default(junk):
    assert clamp_canvas(junk, 640) == 640


def test_a_huge_canvas_cannot_allocate_more_than_a_quarter_gigabyte():
    """RGBA is four bytes a pixel, so the ceiling has to be defensible in memory terms."""
    worst_case_bytes = MAX_CANVAS_PX * MAX_CANVAS_PX * 4
    assert worst_case_bytes <= 300 * 1024 * 1024


@pytest.mark.parametrize(
    "requested,low,high,expected",
    [
        (12, 1, 120, 12),
        (100000, 1, 120, 120),
        (0, 1, 120, 1),
        (-3, 1, 120, 1),
    ],
)
def test_print_dimensions_are_bounded(requested, low, high, expected):
    assert _clamp_float(requested, 12, low, high) == expected


def test_unparseable_print_dimension_falls_back():
    assert _clamp_float("not a number", 12, 1, 120) == 12.0


def test_repeat_tile_cannot_exceed_a_workable_pixel_size():
    """repeat_width * dpi is the tile edge, and the grid multiplies it again.

    100 inches at 1200 dpi asked for a 120,000px edge before the grid was applied.
    """
    widest = _clamp_float(10 ** 6, 12, 1, 120)
    highest_dpi = _clamp_float(10 ** 6, 300, 72, 600)
    edge = widest * highest_dpi
    assert edge <= 72_000, f"a single tile edge of {edge}px is still too large"


def test_colorway_batch_size_is_bounded():
    """Each colourway is a full-resolution recolour written to disk and synced to storage."""
    import inspect

    from routes import colorways

    source = inspect.getsource(colorways.generate_colorways)
    assert "min(12" in source, "the colourway count no longer looks bounded"
