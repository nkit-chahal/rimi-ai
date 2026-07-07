import React, { useEffect, useState } from 'react';
import { I } from './StudioIcons';

/**
 * Pill badge for image upload progress: uploading spinner → ready checkmark.
 */
export default function UploadStatusBadge({ status, className = '' }) {
    const [showReadyPulse, setShowReadyPulse] = useState(false);

    useEffect(() => {
        if (status !== 'ready') {
            setShowReadyPulse(false);
            return undefined;
        }
        setShowReadyPulse(true);
        const timer = window.setTimeout(() => setShowReadyPulse(false), 2600);
        return () => window.clearTimeout(timer);
    }, [status]);

    if (!status || status === 'idle') return null;

    if (status === 'uploading') {
        return (
            <span className={`st-upload-status-badge is-uploading ${className}`.trim()} aria-live="polite">
                <span className="st-upload-status-spinner" aria-hidden="true" />
                Uploading…
            </span>
        );
    }

    if (status === 'ready') {
        return (
            <span
                className={`st-upload-status-badge is-ready ${showReadyPulse ? 'pulse' : ''} ${className}`.trim()}
                aria-live="polite"
            >
                <I d="M5 13l4 4L19 7" s={14} />
                Ready
            </span>
        );
    }

    if (status === 'error') {
        return (
            <span className={`st-upload-status-badge is-error ${className}`.trim()} aria-live="polite">
                <I d="M6 18L18 6M6 6l12 12" s={14} />
                Upload failed
            </span>
        );
    }

    return null;
}
