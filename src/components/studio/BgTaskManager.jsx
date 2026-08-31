import React from 'react';
import { I } from './shared/StudioIcons';
import { forceDownload, mediaUrl } from './shared/helpers';
import MediaImg from './shared/MediaImg';

export default function BgTaskManager({
    bgTasks,
    show,
    onToggle,
    onOpenTask,
    onDismissTask,
    onClearFinished,
    onRetryTask,
    canRetryTask,
    currentToken,
}) {
    const containerRef = React.useRef(null);
    const runningCount = bgTasks.filter(task => task.status === 'running').length;
    const finishedCount = bgTasks.length - runningCount;

    React.useEffect(() => {
        if (!show) return undefined;
        const closeOnOutsideClick = event => {
            if (!containerRef.current?.contains(event.target)) onToggle(false);
        };
        const closeOnEscape = event => {
            if (event.key === 'Escape') onToggle(false);
        };
        document.addEventListener('pointerdown', closeOnOutsideClick);
        document.addEventListener('keydown', closeOnEscape);
        return () => {
            document.removeEventListener('pointerdown', closeOnOutsideClick);
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [onToggle, show]);

    return (
        <div className="st-bg-tasks-container" ref={containerRef}>
            <button
                type="button"
                className={`st-icon-btn st-bg-tasks-trigger ${show ? 'is-open' : ''} ${runningCount > 0 ? 'active-pulse' : ''}`}
                aria-expanded={show}
                aria-haspopup="dialog"
                aria-label={runningCount ? `${runningCount} background tasks running` : 'Open recent background tasks'}
                onClick={() => onToggle(!show)}
                title="Background tasks"
            >
                <I d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" s={18} />
                {runningCount > 0 && <span className="st-bg-tasks-badge" aria-hidden="true">{runningCount}</span>}
            </button>

            {show && (
                <section className="st-bg-tasks-dropdown" role="dialog" aria-label="Background tasks">
                    <header className="st-bg-tasks-header">
                        <div>
                            <strong>Background tasks</strong>
                            <span>{runningCount ? `${runningCount} running · ${finishedCount} recent` : `${finishedCount} recent`}</span>
                        </div>
                        {finishedCount > 0 && (
                            <button type="button" className="st-bg-tasks-clear" onClick={onClearFinished}>Clear finished</button>
                        )}
                    </header>

                    <div className="st-bg-tasks-list" aria-live="polite">
                        {bgTasks.length === 0 ? (
                            <div className="st-bg-tasks-empty">
                                <span className="st-bg-tasks-empty-icon"><I d="M4 4h16v16H4zM8 9h8M8 13h5" s={20} /></span>
                                <strong>No recent tasks</strong>
                                <span>Long-running generations will appear here, even while you use another tool.</span>
                            </div>
                        ) : bgTasks.map(task => {
                            const previewUrl = task.resultUrl || task.resultUrls?.[0];
                            const canRetry = task.status === 'failed' && canRetryTask?.(task.id);
                            return (
                                <article className={`st-bg-task st-bg-task-${task.status}`} key={task.id}>
                                    <div className="st-bg-task-heading">
                                        <div>
                                            <strong>{task.label}</strong>
                                            <span title={task.filename}>Input: {task.filename}</span>
                                        </div>
                                        <span className="st-bg-task-status">{task.status}</span>
                                    </div>

                                    {task.status === 'running' && (
                                        <div className="st-bg-task-progress">
                                            <div><span>{task.stage || 'Processing…'}</span><strong>{Math.round(task.progress || 0)}%</strong></div>
                                            <div className="st-bg-task-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(task.progress || 0)}>
                                                <span style={{ width: `${Math.max(2, Math.min(100, task.progress || 0))}%` }} />
                                            </div>
                                        </div>
                                    )}

                                    {task.status === 'failed' && <p className="st-bg-task-error">{task.error || 'The task could not be completed.'}</p>}

                                    {task.status !== 'running' && (
                                        <div className="st-bg-task-actions">
                                            {previewUrl && (
                                                <div className="st-bg-task-thumb">
                                                    <MediaImg src={previewUrl} alt="Generated result" token={currentToken} accessToken={task.fileAccessToken} />
                                                </div>
                                            )}
                                            <div>
                                                {task.status === 'completed' && previewUrl && (
                                                    <>
                                                        <button type="button" onClick={() => { onOpenTask(task); onToggle(false); }}>View</button>
                                                        <button type="button" className="primary" onClick={event => forceDownload(event, mediaUrl(previewUrl), undefined, currentToken)}>Download</button>
                                                    </>
                                                )}
                                                {canRetry && <button type="button" className="primary" onClick={() => onRetryTask(task.id)}>Retry</button>}
                                                <button type="button" onClick={() => onDismissTask(task.id)}>Dismiss</button>
                                            </div>
                                        </div>
                                    )}
                                </article>
                            );
                        })}
                    </div>
                </section>
            )}
        </div>
    );
}
