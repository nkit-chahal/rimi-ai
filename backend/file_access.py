"""Shared file access: who may read a file, and where it actually lives.

Two problems this exists to fix.

**Ownership.** Every tool resolved its input by bare basename against the uploads and results
directories with no owner check. Any authenticated user who learned a filename, from a share
link, an exports list or a pipeline result, could run tools on another customer's artwork and
receive the output under their own project.

**Location.** Every tool read local disk only. In production the container disk is ephemeral,
so after a redeploy files that live in object storage were reported as "File not found" even
though they were still there.
"""
import logging
import os

from config import RESULTS_DIR, UPLOAD_DIR

logger = logging.getLogger(__name__)

# Shared demo artwork (demo_floral.png and friends) lives in the repo's public/ folder,
# one level above backend/. Several routes tried to reach it with a path built from
# routes/, which resolves to backend/public and therefore never matched anything.
PUBLIC_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public")


class FileAccessError(Exception):
    """A file may not be read. `status` is the HTTP status the route should return."""

    def __init__(self, message, status=404):
        super().__init__(message)
        self.status = status


def _current_user():
    from flask import g

    return getattr(g, "current_user", None) or {}


def file_owner(filename):
    """The user id that owns this file, or None when nothing records one."""
    from routes.upload import _lookup_file_owner

    return _lookup_file_owner(filename)


def assert_readable(filename, user=None):
    """Return the safe basename, or raise FileAccessError if this user may not read it.

    A file whose owner cannot be determined is allowed through. Results are UUID-named and
    unguessable, and intermediate outputs are not always recorded against a user, so refusing
    them would break legitimate tool chaining. The case this closes is the opposite one: a
    filename the caller has actually seen, which is exactly when an owner is on record.

    Denial returns 404 rather than 403 so the response does not confirm that a file exists.
    """
    safe = os.path.basename(filename or "")
    if not safe:
        raise FileAccessError("Filename is required", 400)

    user = user if user is not None else _current_user()
    if not user:
        # No authenticated context at all. This is an RQ worker or a background thread
        # running a job whose ownership was already checked when the route enqueued it,
        # so there is nobody to check against and nothing to refuse.
        return safe
    if user.get("role") == "admin":
        return safe

    owner = file_owner(safe)
    if owner is None:
        return safe

    try:
        same = int(owner) == int(user.get("id") or 0)
    except (TypeError, ValueError):
        same = False
    if not same:
        logger.warning(
            "User %s was denied access to %s, which belongs to user %s",
            user.get("id"), safe, owner,
        )
        raise FileAccessError("File not found", 404)
    return safe


def resolve_readable_path(filename, user=None, directories=("uploads", "results"),
                          include_public=True):
    """Local path for a file this user may read, or None when it cannot be found.

    Checks ownership first, then local disk, then the shared public assets, then object
    storage. The storage lookup is what keeps previously uploaded artwork working across
    a redeploy onto a fresh container.
    """
    import storage

    safe = assert_readable(filename, user=user)

    for directory in directories:
        local = os.path.join(UPLOAD_DIR if directory == "uploads" else RESULTS_DIR, safe)
        if os.path.exists(local):
            return local

    if include_public:
        # Demo artwork belongs to nobody and is offered to everyone.
        shared = os.path.join(PUBLIC_DIR, safe)
        if os.path.exists(shared):
            return shared

    for directory in directories:
        try:
            path = storage.get_file_path(directory, safe)
        except Exception as exc:
            logger.warning("Storage lookup failed for %s/%s: %s", directory, safe, exc)
            continue
        if path and os.path.exists(path):
            return path

    return None


def readable_path_or_none(filename, user=None, **kwargs):
    """resolve_readable_path, but a refusal reads as "not found" instead of raising.

    Lets a route keep its single not-found branch. A file the caller may not read and a
    file that does not exist are deliberately indistinguishable from outside.
    """
    try:
        return resolve_readable_path(filename, user=user, **kwargs)
    except FileAccessError:
        return None
