/**
 * Shared helper functions used across all Studio tool components.
 * Extracted from Studio.jsx to avoid duplication.
 */

const localApiHosts = new Set(['localhost', '127.0.0.1']);
export const API = import.meta.env.VITE_API_URL || (localApiHosts.has(window.location.hostname) ? 'http://localhost:3001' : '');

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
