import { useEffect, useState } from 'react';
import { mediaUrl, resolveMediaUrl, mediaPathNeedsAuth } from './helpers';

/**
 * Image that resolves authenticated /results/ and /uploads/ URLs before rendering.
 */
export default function MediaImg({ src, token, ...props }) {
    const needsAuth = Boolean(src && mediaPathNeedsAuth(src));
    const [resolved, setResolved] = useState(() => (needsAuth ? '' : mediaUrl(src)));

    useEffect(() => {
        if (!src) {
            setResolved('');
            return;
        }
        if (!mediaPathNeedsAuth(src)) {
            setResolved(mediaUrl(src));
            return;
        }
        let cancelled = false;
        setResolved('');
        resolveMediaUrl(src, token).then((url) => {
            if (!cancelled) setResolved(url);
        });
        return () => {
            cancelled = true;
        };
    }, [src, token]);

    if (!resolved) return null;
    return <img src={resolved} {...props} />;
}
