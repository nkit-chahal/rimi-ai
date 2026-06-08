import { useCallback, useRef, useState } from 'react';
import {
    ACCEPTED_IMAGE_EXTENSIONS,
    getImageFromClipboard,
    getImageFromDataTransfer,
    isEditableTarget,
    isImageFile,
} from './imageUpload';

export function useImageDropzone({
    onFile,
    disabled = false,
    accept = ACCEPTED_IMAGE_EXTENSIONS,
    onInvalidFile,
    onPasteSuccess,
    isValidFile = isImageFile,
}) {
    const fileInputRef = useRef(null);
    const [isDrag, setIsDrag] = useState(false);

    const handleFile = useCallback((file, source = 'pick') => {
        if (disabled || !file) return;
        if (!isValidFile(file)) {
            onInvalidFile?.('Invalid file type. Supported: JPG, PNG, WEBP');
            return;
        }
        onFile(file);
        if (source === 'paste') onPasteSuccess?.();
    }, [disabled, onFile, onInvalidFile, onPasteSuccess, isValidFile]);

    const openFilePicker = useCallback(() => {
        if (!disabled) fileInputRef.current?.click();
    }, [disabled]);

    const rootProps = {
        role: 'button',
        tabIndex: disabled ? -1 : 0,
        'aria-disabled': disabled || undefined,
        onClick: (e) => {
            if (disabled) return;
            if (e.target.closest('button, a, input, textarea, select')) return;
            openFilePicker();
        },
        onKeyDown: (e) => {
            if (disabled) return;
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openFilePicker();
            }
        },
        onDragOver: (e) => {
            if (disabled) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            setIsDrag(true);
        },
        onDragLeave: (e) => {
            if (disabled) return;
            if (!e.currentTarget.contains(e.relatedTarget)) setIsDrag(false);
        },
        onDrop: (e) => {
            if (disabled) return;
            e.preventDefault();
            setIsDrag(false);
            const file = getImageFromDataTransfer(e.dataTransfer);
            handleFile(file, 'drop');
        },
        onPaste: (e) => {
            if (disabled || isEditableTarget(e.target)) return;
            const file = getImageFromClipboard(e.clipboardData);
            if (!file) return;
            e.preventDefault();
            handleFile(file, 'paste');
        },
    };

    const inputProps = {
        ref: fileInputRef,
        type: 'file',
        accept,
        hidden: true,
        onChange: (e) => {
            const file = e.target.files?.[0];
            handleFile(file, 'pick');
            e.target.value = '';
        },
    };

    const pasteProps = {
        onPaste: rootProps.onPaste,
        tabIndex: disabled ? -1 : 0,
    };

    return {
        isDrag,
        rootProps,
        pasteProps,
        inputProps,
        openFilePicker,
        fileInputRef,
        handleFile,
    };
}
