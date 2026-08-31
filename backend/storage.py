"""
S3-compatible storage helper for Railway Object Storage (Buckets).
Falls back to local filesystem when S3 is not configured.
"""
import os
import io
from urllib.parse import urlencode

from config import (
    S3_ENDPOINT, S3_BUCKET, S3_REGION, S3_ACCESS_KEY, S3_SECRET_KEY,
    USE_S3, UPLOAD_DIR, RESULTS_DIR
)

_s3_client = None


def _get_s3():
    global _s3_client
    if _s3_client is None:
        import boto3
        _s3_client = boto3.client(
            's3',
            endpoint_url=S3_ENDPOINT,
            aws_access_key_id=S3_ACCESS_KEY,
            aws_secret_access_key=S3_SECRET_KEY,
            region_name=S3_REGION,
        )
    return _s3_client


def save_file(directory_type, filename, data):
    """
    Save file data (bytes or file-like) to storage.
    directory_type: 'uploads' or 'results'
    filename: just the filename, no path
    data: bytes or file-like object
    Returns the relative URL path (e.g. /uploads/xyz.png)
    """
    if isinstance(data, (bytes, bytearray)):
        file_bytes = bytes(data)
    elif hasattr(data, 'read'):
        file_bytes = data.read()
    else:
        file_bytes = data

    if USE_S3:
        key = f"{directory_type}/{filename}"
        s3 = _get_s3()
        # Determine content type
        ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
        content_types = {
            'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
            'webp': 'image/webp', 'svg': 'image/svg+xml', 'tiff': 'image/tiff',
            'pdf': 'application/pdf', 'json': 'application/json',
        }
        content_type = content_types.get(ext, 'application/octet-stream')
        s3.put_object(
            Bucket=S3_BUCKET, Key=key, Body=file_bytes,
            ContentType=content_type,
            Tagging=urlencode({'lifecycle': 'active'}),
        )
        return f"/{key}"
    else:
        local_dir = UPLOAD_DIR if directory_type == 'uploads' else RESULTS_DIR
        filepath = os.path.join(local_dir, filename)
        with open(filepath, 'wb') as f:
            f.write(file_bytes)
        return f"/{directory_type}/{filename}"


def get_file(directory_type, filename):
    """
    Retrieve file bytes from storage.
    Returns (bytes, content_type) or (None, None) if not found.
    """
    if USE_S3:
        key = f"{directory_type}/{filename}"
        s3 = _get_s3()
        try:
            response = s3.get_object(Bucket=S3_BUCKET, Key=key)
            return response['Body'].read(), response.get('ContentType', 'application/octet-stream')
        except Exception:
            return None, None
    else:
        local_dir = UPLOAD_DIR if directory_type == 'uploads' else RESULTS_DIR
        filepath = os.path.join(local_dir, filename)
        if os.path.exists(filepath):
            ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
            content_types = {
                'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
                'webp': 'image/webp', 'svg': 'image/svg+xml', 'tiff': 'image/tiff',
            }
            ct = content_types.get(ext, 'application/octet-stream')
            with open(filepath, 'rb') as f:
                return f.read(), ct
        return None, None


def file_exists(directory_type, filename):
    """Check if a file exists in storage."""
    if USE_S3:
        key = f"{directory_type}/{filename}"
        s3 = _get_s3()
        try:
            s3.head_object(Bucket=S3_BUCKET, Key=key)
            return True
        except Exception:
            return False
    else:
        local_dir = UPLOAD_DIR if directory_type == 'uploads' else RESULTS_DIR
        return os.path.exists(os.path.join(local_dir, filename))


def get_file_path(directory_type, filename):
    """
    Get local file path. For S3, downloads to a temp location first.
    Returns the local file path.
    """
    if USE_S3:
        import tempfile
        data, _ = get_file(directory_type, filename)
        if data is None:
            return None
        local_dir = UPLOAD_DIR if directory_type == 'uploads' else RESULTS_DIR
        os.makedirs(local_dir, exist_ok=True)
        filepath = os.path.join(local_dir, filename)
        with open(filepath, 'wb') as f:
            f.write(data)
        return filepath
    else:
        local_dir = UPLOAD_DIR if directory_type == 'uploads' else RESULTS_DIR
        filepath = os.path.join(local_dir, filename)
        return filepath if os.path.exists(filepath) else None


def save_local_file_to_storage(directory_type, filename):
    """
    If a file already exists on local disk, upload it to S3.
    Useful for results that are generated locally first.
    """
    if not USE_S3:
        return f"/{directory_type}/{filename}"
    local_dir = UPLOAD_DIR if directory_type == 'uploads' else RESULTS_DIR
    filepath = os.path.join(local_dir, filename)
    if os.path.exists(filepath):
        with open(filepath, 'rb') as f:
            return save_file(directory_type, filename, f.read())
    return f"/{directory_type}/{filename}"


def get_public_url(directory_type, filename):
    """Get the public-facing URL for a file."""
    if USE_S3:
        # Generate a presigned URL for direct access
        key = f"{directory_type}/{filename}"
        s3 = _get_s3()
        try:
            url = s3.generate_presigned_url(
                'get_object',
                Params={'Bucket': S3_BUCKET, 'Key': key},
                ExpiresIn=3600  # 1 hour
            )
            return url
        except Exception:
            return f"/{directory_type}/{filename}"
    return f"/{directory_type}/{filename}"


def sync_to_s3(filepath):
    """
    Upload a local file to S3 after it's been saved locally.
    Auto-detects whether it belongs to uploads/ or results/.
    Call this after any img.save() or file write to RESULTS_DIR/UPLOAD_DIR.
    """
    if not USE_S3:
        return
    try:
        basename = os.path.basename(filepath)
        if RESULTS_DIR in os.path.abspath(filepath):
            save_local_file_to_storage('results', basename)
        elif UPLOAD_DIR in os.path.abspath(filepath):
            save_local_file_to_storage('uploads', basename)
    except Exception as e:
        print(f"[storage] S3 sync failed for {filepath}: {e}")


def update_object_tags(directory_type, filename, tags, remove_keys=()):
    """Merge lifecycle metadata into an S3 object without deleting its bytes."""
    if not USE_S3:
        return True
    try:
        key = f"{directory_type}/{filename}"
        s3 = _get_s3()
        response = s3.get_object_tagging(Bucket=S3_BUCKET, Key=key)
        merged = {
            item['Key']: item.get('Value', '')
            for item in response.get('TagSet', [])
            if item.get('Key') not in set(remove_keys)
        }
        merged.update({str(key): str(value) for key, value in tags.items() if value is not None})
        s3.put_object_tagging(
            Bucket=S3_BUCKET,
            Key=key,
            Tagging={'TagSet': [{'Key': key, 'Value': value} for key, value in sorted(merged.items())]},
        )
        return True
    except Exception as e:
        print(f"[storage] S3 tag update failed for {directory_type}/{filename}: {e}")
        return False

