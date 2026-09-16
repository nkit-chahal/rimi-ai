import { useEffect, useRef, useState } from 'react';
import { I } from './StudioIcons';
import '../../../styles/new-project-modal.css';

/**
 * Name a project before working in it.
 *
 * Two modes. Normal: opened from Home or the project switcher, closable. Locked: shown when the
 * account has no project at all — there is no close, no overlay dismiss and no Escape, because
 * every tool writes into a project and a nameless one is how "My First Project" rows used to
 * pile up in production. The user picks a real name, once, and never sees this again.
 */
export default function NewProjectModal({ open, ...rest }) {
    // The dialog mounts fresh every time it opens, so its name/error state starts clean without
    // any effect having to reset it.
    if (!open) return null;
    return <NewProjectDialog {...rest} />;
}

function NewProjectDialog({
    locked = false,
    busy = false,
    onClose,
    onCreate,
    title,
    subtitle,
}) {
    const [name, setName] = useState('');
    const [error, setError] = useState('');
    const inputRef = useRef(null);

    useEffect(() => {
        const t = window.setTimeout(() => inputRef.current?.focus(), 30);
        const onKey = (e) => {
            if (e.key === 'Escape' && !locked) onClose?.();
        };
        document.addEventListener('keydown', onKey);
        return () => {
            window.clearTimeout(t);
            document.removeEventListener('keydown', onKey);
        };
    }, [locked, onClose]);

    const submit = async (e) => {
        e.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) {
            setError('Give the project a name to continue.');
            inputRef.current?.focus();
            return;
        }
        if (trimmed.length > 80) {
            setError('Keep it under 80 characters.');
            return;
        }
        setError('');
        await onCreate?.(trimmed);
    };

    return (
        <div
            className={`st-modal-overlay st-newproj-overlay ${locked ? 'is-locked' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="st-newproj-title"
            onClick={(e) => {
                if (!locked && e.target === e.currentTarget) onClose?.();
            }}
        >
            <form className="st-newproj" onSubmit={submit} noValidate>
                <div className="st-newproj-head">
                    <span className="st-newproj-mark" aria-hidden="true">
                        <I d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" s={18} />
                    </span>
                    <div>
                        <h3 id="st-newproj-title">{title || (locked ? 'Name your first project' : 'New project')}</h3>
                        <p>
                            {subtitle || (locked
                                ? 'Everything you make — repeats, colourways, mockups, exports — is saved into a project. Give this one a name to get started.'
                                : 'A project keeps one design and everything derived from it together.')}
                        </p>
                    </div>
                    {!locked && (
                        <button type="button" className="st-newproj-close" aria-label="Close" onClick={onClose}>
                            <I d="M6 18L18 6M6 6l12 12" s={16} />
                        </button>
                    )}
                </div>

                <label className="st-newproj-field">
                    <span>Project name</span>
                    <input
                        ref={inputRef}
                        type="text"
                        value={name}
                        maxLength={80}
                        placeholder="e.g. Spring Florals — Bedding"
                        aria-invalid={Boolean(error)}
                        aria-describedby={error ? 'st-newproj-error' : undefined}
                        onChange={(e) => { setName(e.target.value); if (error) setError(''); }}
                        disabled={busy}
                    />
                </label>
                {error && <p id="st-newproj-error" className="st-newproj-error" role="alert">{error}</p>}

                <div className="st-newproj-actions">
                    {!locked && (
                        <button type="button" className="st-newproj-btn ghost" onClick={onClose} disabled={busy}>
                            Cancel
                        </button>
                    )}
                    <button type="submit" className="st-newproj-btn primary" disabled={busy}>
                        {busy ? 'Creating…' : (locked ? 'Create project and continue' : 'Create project')}
                    </button>
                </div>
            </form>
        </div>
    );
}
