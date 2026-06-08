import React, { useEffect, useRef, useState } from 'react';

const BOOT_STEPS = [
    'Preparing your studio',
    'Loading projects',
    'Syncing AI tools',
    'Almost ready',
];

export default function StudioBootSplash({ visible, dataReady = false, minDurationMs = 2200, onHidden }) {
    const [mounted, setMounted] = useState(visible);
    const [exiting, setExiting] = useState(false);
    const [stepIndex, setStepIndex] = useState(0);
    const [progress, setProgress] = useState(0);
    const startedAtRef = useRef(Date.now());

    useEffect(() => {
        if (visible) {
            startedAtRef.current = Date.now();
            setMounted(true);
            setExiting(false);
            setProgress(0);
            setStepIndex(0);
            return undefined;
        }

        if (!mounted) return undefined;

        setExiting(true);
        const exitTimer = window.setTimeout(() => {
            setMounted(false);
            setExiting(false);
            onHidden?.();
        }, 480);

        return () => window.clearTimeout(exitTimer);
    }, [visible, mounted, onHidden]);

    useEffect(() => {
        if (!mounted || exiting) return undefined;

        const stepTimer = window.setInterval(() => {
            setStepIndex((prev) => (prev + 1) % BOOT_STEPS.length);
        }, 680);

        const progressTimer = window.setInterval(() => {
            const elapsed = Date.now() - startedAtRef.current;
            const timeProgress = Math.min(90, (elapsed / minDurationMs) * 90);
            const target = dataReady ? 100 : timeProgress;
            setProgress((prev) => Math.max(prev, target));
        }, 45);

        return () => {
            window.clearInterval(stepTimer);
            window.clearInterval(progressTimer);
        };
    }, [mounted, exiting, minDurationMs, dataReady]);

    useEffect(() => {
        if (dataReady) setProgress(100);
    }, [dataReady]);

    if (!mounted) return null;

    return (
        <div className={`rim-boot-splash ${exiting ? 'is-exiting' : ''}`} role="status" aria-live="polite">
            <div className="rim-boot-bg">
                <div className="rim-boot-blob rim-boot-blob-1" />
                <div className="rim-boot-blob rim-boot-blob-2" />
                <div className="rim-boot-grid" />
            </div>

            <div className="rim-boot-content">
                <div className="rim-boot-logo-wrap">
                    <div className="rim-boot-logo-ring" />
                    <div className="rim-boot-logo-ring rim-boot-logo-ring-2" />
                    <span className="rim-boot-logo-badge">RI</span>
                </div>
                <h1 className="rim-boot-title">RIMI AI</h1>
                <p className="rim-boot-subtitle">{BOOT_STEPS[stepIndex]}</p>
                <div className="rim-boot-progress-track">
                    <div className="rim-boot-progress-bar" style={{ width: `${progress}%` }} />
                </div>
            </div>
        </div>
    );
}
