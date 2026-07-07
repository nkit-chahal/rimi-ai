import { useEffect, useState } from 'react';
import { mediaUrl, resolveMediaUrl, mediaPathNeedsAuth, mediaFilenameFromPath, fetchMediaToken } from './helpers';

function urlHasAccessToken(url) {
    return Boolean(url && url.includes('access_token='));
}

function resolveInitialSrc(src, accessToken) {
    if (!src) return '';
    if (!mediaPathNeedsAuth(src)) return mediaUrl(src);
    const withToken = mediaUrl(src, accessToken);
    if (urlHasAccessToken(withToken)) return withToken;
    const cached = mediaUrl(src);
    if (urlHasAccessToken(cached)) return cached;
    return '';
}

/**
 * Image that resolves authenticated /results/ and /uploads/ URLs before rendering.
 */
export default function MediaImg({ src, token, accessToken, ...props }) {
    const [resolved, setResolved] = useState(() => resolveInitialSrc(src, accessToken));
    const [retryKey, setRetryKey] = useState(0);

    useEffect(() => {
        if (!src) {
            setResolved('');
            return;
        }
        if (!mediaPathNeedsAuth(src)) {
            setResolved(mediaUrl(src));
            return;
        }

        const immediate = resolveInitialSrc(src, accessToken);
        if (immediate) {
            setResolved(immediate);
            return;
        }

        let cancelled = false;
        setResolved('');
        resolveMediaUrl(src, token).then((url) => {
            if (!cancelled) setResolved(url || '');
        });
        return () => {
            cancelled = true;
        };
    }, [src, token, accessToken, retryKey]);

    const handleError = () => {
        if (!src || !mediaPathNeedsAuth(src)) return;
        const filename = mediaFilenameFromPath(src);
        if (!filename) return;
        fetchMediaToken(filename, token).then((freshToken) => {
            if (!freshToken) return;
            const retryUrl = mediaUrl(src, freshToken);
            if (retryUrl && retryUrl !== resolved) {
                setResolved(retryUrl);
            } else {
                setRetryKey((k) => k + 1);
            }
        });
    };

    if (!src) return null;

    if (!resolved) {
        return (
            <div
                aria-hidden
                style={{
                    width: '100%',
                    height: '100%',
                    minHeight: 48,
                    background: '#f1f5f9',
                    ...(props.style || {}),
                }}
            />
        );
    }

    const { style, onError, ...imgProps } = props;
    return (
        <img
            src={resolved}
            {...imgProps}
            style={style}
            onError={(e) => {
                handleError();
                onError?.(e);
            }}
        />
    );
}
