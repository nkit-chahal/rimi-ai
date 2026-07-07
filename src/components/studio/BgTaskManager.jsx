import React from 'react';
import { I } from './shared/StudioIcons';
import { forceDownload, mediaUrl } from './shared/helpers';
import MediaImg from './shared/MediaImg';

export default function BgTaskManager({ bgTasks, show, onToggle, setTool, setResultUrl, setQwenLaunch, currentToken }) {
    const runningCount = bgTasks.filter(t => t.status === 'running').length;

    return (
        <div className="st-bg-tasks-container" style={{ position: 'relative' }}>
            <button
                type="button"
                className={`st-icon-btn ${runningCount > 0 ? 'active-pulse' : ''}`}
                aria-expanded={show}
                aria-haspopup="true"
                onClick={() => onToggle(!show)}
                title="AI Background Queue Manager"
                style={{
                    position: 'relative',
                    background: show ? 'rgba(99, 102, 241, 0.08)' : 'transparent',
                    color: runningCount > 0 ? '#6366f1' : '#64748b'
                }}
            >
                <I d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" s={18} />
                {runningCount > 0 && (
                    <span className="st-bg-tasks-badge" style={{
                        position: 'absolute',
                        top: '-2px',
                        right: '-2px',
                        background: '#6366f1',
                        color: '#fff',
                        borderRadius: '50%',
                        width: '14px',
                        height: '14px',
                        fontSize: '8px',
                        fontWeight: 800,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 2px 6px rgba(99, 102, 241, 0.4)'
                    }}>
                        {runningCount}
                    </span>
                )}
            </button>

            {show && (
                <div className="st-bg-tasks-dropdown st-glassmorphic-dropdown" style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    marginTop: '6px',
                    width: '320px',
                    background: '#fff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '10px',
                    boxShadow: '0 18px 42px rgba(15, 23, 42, 0.16)',
                    zIndex: 9999,
                    padding: '12px'
                }}>
                    <div style={{ fontWeight: 800, fontSize: '0.88rem', color: '#0f172a', marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>Background Tasks</span>
                        <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 500 }}>{bgTasks.length} total</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '300px', overflowY: 'auto' }}>
                        {bgTasks.length === 0 ? (
                            <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8', fontSize: '0.82rem' }}>No background tasks active</div>
                        ) : (
                            bgTasks.map(t => (
                                <div key={t.id} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e293b' }}>{t.label}</span>
                                        <span style={{
                                            fontSize: '0.65rem',
                                            fontWeight: 800,
                                            padding: '2px 6px',
                                            borderRadius: '4px',
                                            textTransform: 'uppercase',
                                            background: t.status === 'completed' ? '#dcfce7' : t.status === 'failed' ? '#fee2e2' : '#e0e7ff',
                                            color: t.status === 'completed' ? '#15803d' : t.status === 'failed' ? '#b91c1c' : '#4338ca',
                                        }}>{t.status}</span>
                                    </div>
                                    <div style={{ fontSize: '0.72rem', color: '#64748b' }}>Input: {t.filename}</div>
                                    {t.status === 'running' && (
                                        <div style={{ width: '100%' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: '#6366f1', fontWeight: 700, marginBottom: '2px' }}>
                                                <span>Processing...</span>
                                                <span>{t.progress}%</span>
                                            </div>
                                            <div style={{ width: '100%', height: '4px', background: '#e2e8f0', borderRadius: '99px', overflow: 'hidden' }}>
                                                <div style={{ width: `${t.progress}%`, height: '100%', background: 'linear-gradient(90deg, #6366f1, #ec4899)' }} />
                                            </div>
                                        </div>
                                    )}
                                    {t.status === 'completed' && t.resultUrl && (
                                        <div style={{ display: 'flex', gap: '8px', marginTop: '4px', alignItems: 'center' }}>
                                            <div style={{ width: '32px', height: '32px', borderRadius: '4px', overflow: 'hidden', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <MediaImg src={t.resultUrl} alt="Result" token={currentToken} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                            </div>
                                            <div style={{ display: 'flex', gap: '6px', flex: 1, justifyContent: 'flex-end' }}>
                                                <button onClick={() => {
                                                    if (t.type === 'imagelayers' && setQwenLaunch && t.sessionId) {
                                                        setQwenLaunch({ sessionId: t.sessionId });
                                                    }
                                                    setTool(t.type);
                                                    setResultUrl(t.type, t.resultUrls || t.resultUrl);
                                                    onToggle(false);
                                                }} style={{ padding: '4px 10px', fontSize: '0.72rem', background: 'rgba(99, 102, 241, 0.08)', color: '#6366f1', border: 'none', borderRadius: '6px', fontWeight: 700, cursor: 'pointer' }}>View</button>
                                                <button type="button" onClick={(e) => forceDownload(e, mediaUrl(t.resultUrl), undefined, currentToken)} style={{ padding: '4px 10px', fontSize: '0.72rem', background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)', color: '#fff', borderRadius: '6px', fontWeight: 700, border: 'none', cursor: 'pointer' }}>Download</button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
