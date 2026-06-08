export const ACCEPTED_IMAGE_EXTENSIONS = '.jpg,.jpeg,.png,.webp';
export const ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const EXTENSION_MIME = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
};

export function isImageFile(file) {
    if (!file) return false;
    if (file.type && ACCEPTED_MIME_TYPES.includes(file.type)) return true;
    const ext = file.name?.split('.').pop()?.toLowerCase();
    return Boolean(ext && EXTENSION_MIME[ext]);
}

export function getImageFromDataTransfer(dataTransfer) {
    if (!dataTransfer) return null;
    const files = Array.from(dataTransfer.files || []);
    return files.find(isImageFile) || null;
}

export function getImageFromClipboard(clipboardData) {
    if (!clipboardData?.items) return null;
    for (const item of clipboardData.items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (!file || !isImageFile(file)) continue;
            if (!file.name || file.name === 'image.png') {
                const ext = item.type === 'image/jpeg' ? 'jpg' : item.type.split('/')[1] || 'png';
                return new File([file], `pasted-image.${ext}`, { type: file.type || item.type });
            }
            return file;
        }
    }
    return null;
}

export function isEditableTarget(target) {
    if (!target) return false;
    const tag = target.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (target.isContentEditable) return true;
    return Boolean(target.closest?.('[contenteditable="true"]'));
}
