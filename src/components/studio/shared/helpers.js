/**
 * Shared helper functions used across all Studio tool components.
 * Extracted from Studio.jsx to avoid duplication.
 */

/**
 * API base URL. Empty string = same origin (Vite dev proxy or nginx in production).
 * Set VITE_API_URL when frontend and backend are on different hosts.
 */
export const API = import.meta.env.VITE_API_URL || '';

const MEDIA_TOKEN_CACHE = new Map();
const MEDIA_TOKEN_TTL_MS = 50 * 60 * 1000;

/** Extract bare filename from a /results/ or /uploads/ path. */
export function mediaFilenameFromPath(path) {
    if (!path || typeof path !== 'string') return null;
    if (path.startsWith('blob:') || path.startsWith('data:')) return null;
    let normalized = path;
    if (API && normalized.startsWith(API)) normalized = normalized.slice(API.length);
    if (normalized.startsWith('http')) {
        try {
            normalized = new URL(normalized).pathname;
        } catch {
            return null;
        }
    }
    const base = normalized.split('?')[0];
    const name = base.split('/').pop();
    return name || null;
}

/** True when the path is served by authenticated /results or /uploads routes. */
export function mediaPathNeedsAuth(path) {
    if (!path || typeof path !== 'string') return false;
    if (path.startsWith('blob:') || path.startsWith('data:')) return false;
    let p = path;
    if (API && p.startsWith(API)) p = p.slice(API.length);
    if (p.startsWith('http')) {
        try {
            p = new URL(p).pathname;
        } catch {
            return false;
        }
    }
    return p.startsWith('/results/') || p.startsWith('/uploads/');
}

export function cacheFileAccessToken(pathOrFilename, token) {
    const filename = pathOrFilename?.includes('/')
        ? mediaFilenameFromPath(pathOrFilename)
        : pathOrFilename;
    if (!filename || !token) return;
    MEDIA_TOKEN_CACHE.set(filename, { token, expires: Date.now() + MEDIA_TOKEN_TTL_MS });
}

export function cacheFileAccessTokens(tokens = {}) {
    Object.entries(tokens).forEach(([filename, token]) => cacheFileAccessToken(filename, token));
}

/** Cache tokens bundled with API responses (resultUrl + fileAccessToken). */
export function cacheMediaFromResponse(data) {
    if (!data || typeof data !== 'object') return;
    if (data.fileAccessToken) {
        const path = data.resultUrl || data.fileUrl || data.url || data.maskUrl || data.mockupUrl;
        if (path) cacheFileAccessToken(path, data.fileAccessToken);
        if (data.filename) cacheFileAccessToken(data.filename, data.fileAccessToken);
    }
    const nestedLists = [data.results, data.layers].filter(Array.isArray);
    nestedLists.forEach((list) => {
        list.forEach((row) => {
            if (row?.fileAccessToken && (row.resultUrl || row.url || row.filename)) {
                cacheFileAccessToken(row.resultUrl || row.url || row.filename, row.fileAccessToken);
            }
        });
    });
}

function cachedTokenForFilename(filename) {
    if (!filename) return null;
    const entry = MEDIA_TOKEN_CACHE.get(filename);
    if (!entry) return null;
    if (entry.expires <= Date.now()) {
        MEDIA_TOKEN_CACHE.delete(filename);
        return null;
    }
    return entry.token;
}

export async function fetchMediaToken(filename, jwt = null) {
    const name = filename?.includes('/') ? mediaFilenameFromPath(filename) : filename;
    if (!name) return null;
    const cached = cachedTokenForFilename(name);
    if (cached) return cached;

    const authToken = normalizeToken(jwt) || normalizeToken(localStorage.getItem('rim_token'));
    const res = await fetch(`${API}/api/file-access-token?filename=${encodeURIComponent(name)}`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    });
    const d = await res.json().catch(() => ({}));
    if (d.success && d.accessToken) {
        cacheFileAccessToken(name, d.accessToken);
        return d.accessToken;
    }
    return null;
}

/**
 * Build a browser-loadable URL for /results/ and /uploads/ assets.
 * Appends a cached or provided access_token query param when needed.
 */
export function mediaUrl(path, accessToken = null) {
    if (!path) return '';
    if (path.startsWith('blob:') || path.startsWith('data:')) return path;
    if (path.startsWith('http') && (!API || !path.startsWith(API))) return path;

    let relative = path;
    if (API && relative.startsWith(API)) relative = relative.slice(API.length);
    if (!relative.startsWith('/')) relative = `/${relative}`;

    const base = `${API}${relative.split('?')[0]}`;
    if (!mediaPathNeedsAuth(relative)) return base;

    const filename = mediaFilenameFromPath(relative);
    const token = accessToken || cachedTokenForFilename(filename);
    if (!token) return base;
    return `${base}?access_token=${encodeURIComponent(token)}`;
}

/** Fetch a file access token if needed, then return mediaUrl. */
export async function resolveMediaUrl(path, jwt = null) {
    if (!path || !mediaPathNeedsAuth(path)) return mediaUrl(path);
    const filename = mediaFilenameFromPath(path);
    if (!filename) return mediaUrl(path);
    const token = await fetchMediaToken(filename, jwt);
    return mediaUrl(path, token);
}

/** Normalize JWT strings from API responses / localStorage. */
export function normalizeToken(token) {
    if (!token || typeof token !== 'string') return null;
    const cleaned = token.trim();
    return cleaned.length > 0 ? cleaned : null;
}

/** JSON fetch headers with optional Bearer auth. */
export function jsonAuthHeaders(token, extra = {}) {
    const headers = { 'Content-Type': 'application/json', ...extra };
    const authToken = normalizeToken(token);
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    return headers;
}

/** Headers with Bearer auth only (e.g. FormData uploads). */
export function bearerAuthHeaders(token, extra = {}) {
    const headers = { ...extra };
    const authToken = normalizeToken(token);
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    return headers;
}

/**
 * Resolve filename/imageUrl for API calls that process an uploaded or hero image.
 * Returns null if no image source, { pending: true } if upload has not finished.
 */
export function resolveImagePayload({ uploaded, preview, heroImageUrl } = {}) {
    const serverFilename = uploaded?.filename;
    if (serverFilename) {
        return { filename: serverFilename, imageUrl: null };
    }

    const activeUrl = preview || heroImageUrl || null;
    if (uploaded && !serverFilename) {
        if (!activeUrl || activeUrl.startsWith('blob:')) {
            return { pending: true };
        }
    }
    if (!activeUrl) return null;

    if (activeUrl.startsWith('blob:')) {
        return uploaded ? { pending: true } : null;
    }

    if (activeUrl.startsWith('http')) {
        const basename = activeUrl.split('/').pop()?.split('?')[0];
        return {
            filename: basename && basename.includes('.') ? basename : '',
            imageUrl: activeUrl,
        };
    }

    const name = activeUrl.split('/').pop()?.split('?')[0];
    return name ? { filename: name, imageUrl: null } : null;
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

    const data = await res.json();
    cacheMediaFromResponse(data);
    return data;
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

/** Cross-tool handoff: open a file URL in another studio tool. */
export function openFileInTool({ url, filename }, targetTool, setters = {}) {
    const {
        setTool,
        setEnhUrl,
        setSeamlessUrl,
        setRepeatUrl,
        setVecUrl,
        setUpscaleUrl,
        setRemoveBgUrl,
        setCwUrl,
        setUploads,
        tool,
    } = setters;

    const resolvedUrl = url?.startsWith('http') ? url : (url?.startsWith('/') ? url : `/results/${filename || url}`);
    const baseName = filename || filenameFromUrl(resolvedUrl);

    const toolSetters = {
        pattern: setEnhUrl,
        seamless: setSeamlessUrl,
        repeat: setRepeatUrl,
        vectorize: setVecUrl,
        upscale: setUpscaleUrl,
        removebg: setRemoveBgUrl,
        colorways: setCwUrl,
    };

    const setter = toolSetters[targetTool];
    if (setter) setter(resolvedUrl);
    if (setUploads && tool) {
        setUploads((prev) => ({
            ...prev,
            [targetTool]: { file: null, url: resolvedUrl, filename: baseName },
        }));
    }
    if (setTool) setTool(targetTool);
}

/** Create a Qwen session from a source file and switch to Image Layers. */
export async function openInQwenStudio({
    sourceFilename,
    sourceUrl,
    projectId,
    userId,
    token,
    setTool,
    setQwenLaunch,
    setUploads,
    sessionName,
}) {
    const fname = sourceFilename || filenameFromUrl(sourceUrl || '');
    const previewUrl = sourceUrl
        ? (sourceUrl.startsWith('http') || sourceUrl.startsWith('/') ? sourceUrl : `/results/${sourceUrl}`)
        : (fname ? `/results/${fname}` : null);

    const res = await apiFetch('/api/qwen-sessions', {
        method: 'POST',
        body: JSON.stringify({
            projectId,
            userId,
            sourceFilename: fname,
            name: sessionName || `Qwen Studio — ${fname}`,
        }),
    }, token);

    if (!res?.success && !res?.session) {
        throw new Error(res?.error || 'Failed to open Qwen Studio session');
    }

    if (setUploads && fname) {
        setUploads((prev) => ({
            ...prev,
            imagelayers: {
                // Studio derives `uploaded` from uploads[tool].file — keep a file-like object
                file: { filename: fname, originalName: fname },
                url: previewUrl,
                filename: fname,
                originalName: fname,
                status: 'ready',
            },
        }));
    }

    if (setQwenLaunch) {
        setQwenLaunch({
            sessionId: res.session?.id,
            sourceFilename: fname,
            sourceUrl: previewUrl,
        });
    }
    if (setTool) setTool('imagelayers');
    return res.session;
}
