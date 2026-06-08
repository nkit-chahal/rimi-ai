/**
 * Shared helper functions used across all Studio tool components.
 * Extracted from Studio.jsx to avoid duplication.
 */

/**
 * API base URL. Empty string = same origin (Vite dev proxy or nginx in production).
 * Set VITE_API_URL when frontend and backend are on different hosts.
 */
export const API = import.meta.env.VITE_API_URL || '';

/** Normalize JWT strings from API responses / localStorage. */
export function normalizeToken(token) {
    if (!token || typeof token !== 'string') return null;
    const cleaned = token.trim();
    return cleaned.length > 0 ? cleaned : null;
}

const STUDIO_PREFETCH_KEY = 'rim_studio_prefetch';

/** Warm studio-state while login UI is still visible. */
export function prefetchStudioState(token, projectId = 1) {
    const authToken = normalizeToken(token);
    if (!authToken) return;
    const url = `${API}/api/studio-state?projectId=${projectId}`;
    fetch(url, { headers: { Authorization: `Bearer ${authToken}` } })
        .then((r) => r.json())
        .then((d) => {
            if (d?.success && d.state) {
                sessionStorage.setItem(STUDIO_PREFETCH_KEY, JSON.stringify(d));
            }
        })
        .catch(() => {});
}

/** Read and clear prefetched studio-state from session storage. */
export function consumeStudioPrefetch() {
    try {
        const raw = sessionStorage.getItem(STUDIO_PREFETCH_KEY);
        if (!raw) return null;
        sessionStorage.removeItem(STUDIO_PREFETCH_KEY);
        const parsed = JSON.parse(raw);
        return parsed?.success && parsed.state ? parsed : null;
    } catch {
        sessionStorage.removeItem(STUDIO_PREFETCH_KEY);
        return null;
    }
}

/**
 * Crop an image element based on a ReactCrop crop object.
 */
export async function getCroppedImg(imageElement, crop, fileName) {
    const canvas = document.createElement('canvas');
    const scaleX = imageElement.naturalWidth / imageElement.width;
    const scaleY = imageElement.naturalHeight / imageElement.height;
    canvas.width = crop.width * scaleX;
    canvas.height = crop.height * scaleY;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(
        imageElement,
        crop.x * scaleX,
        crop.y * scaleY,
        crop.width * scaleX,
        crop.height * scaleY,
        0, 0,
        crop.width * scaleX,
        crop.height * scaleY
    );
    return new Promise((resolve) => {
        canvas.toBlob((blob) => {
            if (!blob) { resolve(null); return; }
            resolve(new File([blob], fileName, { type: 'image/png' }));
        }, 'image/png');
    });
}

/**
 * Force-download a file from a URL by using a temporary anchor tag.
 */
export function forceDownload(e, url) {
    if (e) e.preventDefault();
    const a = document.createElement('a');
    a.href = url;
    a.download = url.split('/').pop() || 'download';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

/**
 * Parse an API response and update credits if present.
 * Returns the parsed JSON data.
 */
export function updateCreditsFromJson(data, setUser) {
    if (data && data.creditsUsed !== undefined && setUser) {
        setUser(prev => ({
            ...prev,
            creditsUsed: data.creditsUsed,
            creditsLimit: data.creditsLimit || prev.creditsLimit,
        }));
    }
}

/**
 * Centralized API fetch wrapper with authentication and error handling.
 * Automatically includes Authorization header and checks response status.
 * @param {string} url - The API endpoint URL (full URL or path starting with /api/)
 * @param {object} options - Fetch options (method, body, headers, etc.)
 * @param {string} token - Optional JWT token for authentication
 * @returns {Promise<object>} Parsed JSON response
 */
export async function apiFetch(url, options = {}, token = null) {
    const fullUrl = url.startsWith('http') ? url : `${API}${url}`;
    const headers = { ...options.headers };
    const authToken = normalizeToken(token);

    if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
    }
    
    // Don't set Content-Type for FormData (browser sets it with boundary)
    if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }
    
    let res;
    try {
        res = await fetch(fullUrl, { ...options, headers });
    } catch {
        throw new Error(
            'Could not reach the server. Long AI jobs (mockups, patterns) can take 1–2 minutes — if this keeps failing, retry with fewer products or check that the backend is running.'
        );
    }

    if (!res.ok) {
        // Only logout when we sent a session token that the server rejected
        if (res.status === 401 && authToken) {
            window.dispatchEvent(new CustomEvent('rim:session-expired'));
        }
        let errorMessage = `Request failed (${res.status})`;
        try {
            const errorData = await res.json();
            errorMessage = errorData.error || errorMessage;
        } catch {
            // Response wasn't JSON
        }
        const err = new Error(errorMessage);
        err.status = res.status;
        throw err;
    }
    
    return res.json();
}
