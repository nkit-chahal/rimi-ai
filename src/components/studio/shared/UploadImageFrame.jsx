import React, { useEffect, useState } from 'react';
import { I } from './StudioIcons';

/**
 * Wraps a preview image with upload progress overlay and completion flash.
 */
export default function UploadImageFrame({ status, className = '', style, children }) {
    const [showComplete, setShowComplete] = useState(false);

    useEffect(() => {
        if (status !== 'ready') {
            setShowComplete(false);
            return undefined;
        }
        setShowComplete(true);
        const timer = window.setTimeout(() => setShowComplete(false), 2600);
        return () => window.clearTimeout(timer);
    }, [status]);

    const isUploading = status === 'uploading';
    const frameClass = [
        'st-upload-image-frame',
        isUploading ? 'is-uploading' : '',
        showComplete ? 'is-complete' : '',
        status === 'error' ? 'is-error' : '',
        className,
    ].filter(Boolean).join(' ');

    return (
        <div className={frameClass} style={style}>
            {children}
            {isUploading && (
                <div className="st-upload-image-overlay" aria-hidden="true">
                    <span className="st-upload-status-spinner st-upload-status-spinner-lg" />
                    <span>Uploading to server…</span>
                </div>
            )}
            {showComplete && !isUploading && (
                <div className="st-upload-image-complete" aria-hidden="true">
                    <span className="st-upload-complete-icon">
                        <I d="M5 13l4 4L19 7" s={22} />
                    </span>
                </div>
            )}
        </div>
    );
}
