import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { API } from '../components/studio/shared/helpers';

export default function SharePage() {
  const { token } = useParams();
  const [share, setShare] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    fetch(`${API}/api/share/${token}`)
      .then((res) => res.json())
      .then((data) => {
        if (!data.success) {
          throw new Error(data.error || 'Share link not found');
        }
        setShare(data);
        document.title = `${data.projectName} · RIMI AI`;
        const ogImage = document.querySelector('meta[property="og:image"]') || document.createElement('meta');
        ogImage.setAttribute('property', 'og:image');
        ogImage.setAttribute('content', `${API}${data.previewUrl}`);
        if (!ogImage.parentNode) document.head.appendChild(ogImage);
        const ogTitle = document.querySelector('meta[property="og:title"]') || document.createElement('meta');
        ogTitle.setAttribute('property', 'og:title');
        ogTitle.setAttribute('content', `${data.projectName} · Made with RIMI AI`);
        if (!ogTitle.parentNode) document.head.appendChild(ogTitle);
      })
      .catch((err) => setError(err.message || 'Unable to load share link'))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="share-page">
        <div className="share-card">
          <div className="share-loading">Loading design…</div>
        </div>
      </div>
    );
  }

  if (error || !share) {
    return (
      <div className="share-page">
        <div className="share-card">
          <h1>Link unavailable</h1>
          <p>{error || 'This share link is invalid or has expired.'}</p>
          <Link to="/login" className="share-cta">Try RIMI AI</Link>
        </div>
      </div>
    );
  }

  const previewUrl = `${API}${share.previewUrl}`;
  const downloadUrl = `${API}${share.downloadUrl}`;

  return (
    <div className="share-page">
      <div className="share-shell">
        <header className="share-header">
          <div className="share-brand">RIMI AI</div>
          <Link to="/login" className="share-cta subtle">Create your own</Link>
        </header>

        <div className="share-card">
          <div className="share-copy">
            <p className="share-eyebrow">Shared design</p>
            <h1>{share.projectName}</h1>
            <p className="share-subtitle">
              {share.watermarked
                ? 'Preview includes a RIMI AI watermark on free plans.'
                : 'High-quality textile design shared from RIMI AI Studio.'}
            </p>
            <div className="share-actions">
              <a href={downloadUrl} className="share-cta" download>
                Download
              </a>
              <a href={previewUrl} className="share-cta ghost" target="_blank" rel="noreferrer">
                Open full preview
              </a>
            </div>
            <p className="share-footer-note">Made with RIMI AI · Expires {new Date(share.expiresAt).toLocaleDateString()}</p>
          </div>

          <div className="share-preview-wrap">
            <img src={previewUrl} alt={share.projectName} className="share-preview" />
          </div>
        </div>
      </div>
    </div>
  );
}
