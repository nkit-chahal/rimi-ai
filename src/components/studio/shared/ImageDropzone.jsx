import React from 'react';
import { I } from './StudioIcons';
import { useImageDropzone } from './useImageDropzone';
import { ACCEPTED_IMAGE_EXTENSIONS } from './imageUpload';

export default function ImageDropzone({
    variant = 'creative',
    title,
    description,
    badges = [],
    preview,
    previewLabel,
    previewHint = 'Click to replace',
    icon,
    onFile,
    disabled = false,
    accept = ACCEPTED_IMAGE_EXTENSIONS,
    onInvalidFile,
    onPasteSuccess,
    className = '',
    children,
}) {
    const { isDrag, rootProps, inputProps, openFilePicker } = useImageDropzone({
        onFile,
        disabled,
        accept,
        onInvalidFile,
        onPasteSuccess,
    });

    if (variant === 'custom') {
        return (
            <div {...rootProps} className={className}>
                {children}
                <input {...inputProps} />
            </div>
        );
    }

    if (variant === 'compact') {
        return (
            <div
                {...rootProps}
                className={`st-upload ${isDrag ? 'dragging' : ''} ${preview ? 'has-image' : ''} ${className}`.trim()}
            >
                {preview ? (
                    <div className="st-upload-preview">
                        <img src={preview} alt="Uploaded" />
                        <div>
                            <span className="st-upload-name">{previewLabel || 'Image'}</span>
                            <span className="st-upload-hint">{previewHint}</span>
                        </div>
                    </div>
                ) : (
                    <div className="st-upload-empty">
                        <I d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                        <span>Upload Image</span>
                        <span className="st-upload-hint">Drag, paste, or click</span>
                    </div>
                )}
                <input {...inputProps} />
            </div>
        );
    }

    if (variant === 'inline') {
        return (
            <div className={className}>
                <button
                    type="button"
                    className={`st-inspire-upload-zone ${preview ? 'has-image' : ''} ${isDrag ? 'dragging' : ''}`}
                    {...rootProps}
                >
                    {preview ? (
                        <img src={preview} alt="Uploaded reference" />
                    ) : (
                        <span>Drag, paste, or click to upload</span>
                    )}
                </button>
                <input {...inputProps} />
            </div>
        );
    }

    // creative (default)
    return (
        <div
            {...rootProps}
            className={`st-dropzone-creative ${isDrag ? 'dragging' : ''} ${className}`.trim()}
        >
            <div className="st-particles">
                <div className="st-particle" />
                <div className="st-particle" />
                <div className="st-particle" />
                <div className="st-particle" />
            </div>
            <div className="st-dropzone-icon-wrap">
                {icon || <I d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" s={36} />}
            </div>
            {title && <h2 className="st-dropzone-title">{title}</h2>}
            {description && <p className="st-dropzone-desc">{description}</p>}
            {badges.length > 0 && (
                <div className="st-dropzone-badges">
                    {badges.map((badge) => (
                        <span key={badge} className="st-dropzone-badge">{badge}</span>
                    ))}
                </div>
            )}
            <input {...inputProps} />
        </div>
    );
}

export { useImageDropzone };
