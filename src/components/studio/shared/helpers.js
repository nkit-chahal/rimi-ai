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

function filenameFromUrl(url, fallback = 'download') {
    try {
        const path = url.startsWith('http') ? new URL(url).pathname : url;
        const base = path.split('/').pop()?.split('?')[0];
        return base || fallback;
    } catch {
        return url.split('/').pop()?.split('?')[0] || fallback;
    }
}

function triggerBlobDownload(href, filename) {
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

/** Resolve a user-facing URL to the path/query the download proxy understands. */
function toDownloadTarget(url) {
    if (url.startsWith('blob:') || url.startsWith('data:')) return url;

    const absolute = url.startsWith('http')
        ? url
        : `${API}${url.startsWith('/') ? url : `/${url}`}`;

    try {
        const parsed = new URL(absolute);
        if (!url.startsWith('http') || (API && absolute.startsWith(API))) {
            return parsed.pathname;
        }
        return absolute;
    } catch {
        return url;
    }
}

/**
 * Force-download a file. Cross-origin assets (Vercel UI + Railway API) cannot use
 * <a download> directly — we fetch via /api/download and save as a blob instead.
 */
export async function forceDownload(e, url, filename, token = null) {
    if (e?.preventDefault) e.preventDefault();
    if (!url) return;

    const name = filename || filenameFromUrl(url);

    if (url.startsWith('blob:') || url.startsWith('data:')) {
        triggerBlobDownload(url, name);
        return;
    }

    const target = toDownloadTarget(url);
    const proxyUrl = `${API}/api/download?url=${encodeURIComponent(target)}`;
    const authToken = normalizeToken(token) || normalizeToken(localStorage.getItem('rim_token'));
    const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};

    try {
        const res = await fetch(proxyUrl, { headers });
        if (!res.ok) throw new Error(`Download failed (${res.status})`);
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        triggerBlobDownload(objectUrl, name);
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
    } catch {
        // Last resort: navigate to proxy URL (server sets Content-Disposition: attachment)
        window.location.assign(proxyUrl);
    }
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
const DEFAULT_FETCH_TIMEOUT_MS = 30000;

export async function apiFetch(url, options = {}, token = null) {
    const fullUrl = url.startsWith('http') ? url : `${API}${url}`;
    const headers = { ...options.headers };
    const authToken = normalizeToken(token) || normalizeToken(options.token);
    const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    const { timeoutMs: _omit, token: _tokenOpt, ...fetchOptions } = options;

    if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
    }
    
    // Don't set Content-Type for FormData (browser sets it with boundary)
    if (fetchOptions.body && !(fetchOptions.body instanceof FormData) && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    
    let res;
    try {
        res = await fetch(fullUrl, { ...fetchOptions, headers, signal: controller.signal });
    } catch (err) {
        if (err?.name === 'AbortError') {
            throw new Error('Request timed out. The server may be busy — please try again.');
        }
        throw new Error(
            'Could not reach the server. Long AI jobs (mockups, patterns) can take 1–2 minutes — if this keeps failing, retry with fewer products or check that the backend is running.'
        );
    } finally {
        window.clearTimeout(timeoutId);
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

/** Poll a background job until it completes. */
export async function waitForJob(jobId, token, { onProgress, intervalMs = 600, signal } = {}) {
    const authToken = normalizeToken(token);
    while (true) {
        if (signal?.aborted) {
            throw new Error('Job cancelled');
        }
        const data = await apiFetch(`/api/jobs/${jobId}`, {}, authToken);
        const job = data.job;
        onProgress?.(job);
        if (job.status === 'completed') {
            return job.result;
        }
        if (job.status === 'failed') {
            throw new Error(job.error || 'Job failed');
        }
        await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
    }
}

/** Submit an async API job and wait for the result with live progress. */
export async function runAsyncJob(endpoint, body, token, { onProgress, signal } = {}) {
    const data = await apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({ ...body, async: true }),
    }, token);
    if (data.sync && data.result) {
        onProgress?.({ status: 'completed', progressPct: 100, stage: 'Complete', result: data.result });
        return data.result;
    }
    if (!data.jobId) {
        throw new Error('Async job did not return a job id');
    }
    return waitForJob(data.jobId, token, { onProgress, signal });
}
