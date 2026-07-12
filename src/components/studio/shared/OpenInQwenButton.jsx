import React from 'react';
import { openInQwenStudio } from '../shared/helpers';

export default function OpenInQwenButton({
    sourceFilename,
    sourceUrl,
    projectId,
    userId,
    currentToken,
    setTool,
    setQwenLaunch,
    setUploads,
    setError,
    className = 'st-quick-action-btn',
    label = 'Open in Qwen Studio',
    onDone,
}) {
    const fname = sourceFilename || (sourceUrl ? sourceUrl.split('/').pop() : '');
    if (!fname && !sourceUrl) return null;

    return (
        <button
            type="button"
            className={className}
            onClick={async (e) => {
                e.stopPropagation?.();
                try {
                    await openInQwenStudio({
                        sourceFilename: fname,
                        sourceUrl,
                        projectId,
                        userId,
                        token: currentToken,
                        setTool,
                        setQwenLaunch,
                        setUploads,
                    });
                    onDone?.();
                } catch (err) {
                    console.error('Open in Qwen Studio failed', err);
                    setError?.(err.message || 'Open in Qwen Studio failed');
                }
            }}
        >
            {label}
        </button>
    );
}
