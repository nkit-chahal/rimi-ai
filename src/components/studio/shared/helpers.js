/**
 * Shared helper functions used across all Studio tool components.
 * Extracted from Studio.jsx to avoid duplication.
 */

/**
 * API base URL. Empty string = same origin (Vite dev proxy or nginx in production).
 * Set VITE_API_URL when frontend and backend are on different hosts.
 */
export const API = import.meta.env.VITE_API_URL || '';

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
    
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    
    // Don't set Content-Type for FormData (browser sets it with boundary)
    if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }
    
    const res = await fetch(fullUrl, { ...options, headers });
    
    if (!res.ok) {
        // Auto-logout on 401 (expired or invalid token)
        if (res.status === 401) {
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
