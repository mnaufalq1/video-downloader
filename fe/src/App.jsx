import { useState } from 'react';
import { fetchMediaInfo, downloadMedia } from './api.js';
import { sanitizeFilename, formatBytes, codecLabel, sortFormats, formatKindLabel } from './utils.js';
import UrlForm from './components/UrlForm.jsx';
import MediaCard from './components/MediaCard.jsx';
import DownloadProgress from './components/DownloadProgress.jsx';

export default function App() {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState('idle'); // idle | loading | loaded | error
  const [media, setMedia] = useState(null);
  const [selectedFormatId, setSelectedFormatId] = useState(null);
  const [error, setError] = useState(null);

  // State download: null = tidak ada; { progress, phase, displayName }
  const [download, setDownload] = useState(null);

  const handleFetchInfo = async (inputUrl) => {
    setUrl(inputUrl);
    setStatus('loading');
    setError(null);
    setMedia(null);
    setSelectedFormatId(null);
    setDownload(null);

    try {
      const data = await fetchMediaInfo(inputUrl);
      // Urutkan: video (resolusi tinggi ke rendah) dulu, audio-only terakhir.
      const formats = sortFormats(data.formats);
      setMedia({ ...data, formats });

      // Default pilih video H.264 terbaik ≤ 1080p, fallback video tertinggi.
      const videoFormats = formats.filter((f) => f.hasVideo);
      const h264 = videoFormats.filter((f) => /^avc1/i.test(f.vcodec || ''));
      const pick =
        h264.filter((f) => (f.height || 0) <= 1080).sort((a, b) => (b.height || 0) - (a.height || 0))[0] ||
        h264[0] ||
        videoFormats[0];
      setSelectedFormatId(pick ? pick.formatId : undefined);
      setStatus('loaded');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  };

  const handleDownload = async () => {
    const format = media?.formats.find((f) => f.formatId === selectedFormatId);
    if (!format || download) return;

    const kind = format.kind === 'audio' || !format.hasVideo ? 'audio' : 'video';
    const outputExt = kind === 'video' ? 'mp4' : format.outputExtension || format.extension || 'm4a';
    const displayName = sanitizeFilename(
      kind === 'audio' ? `${media.title} [Audio]` : `${media.title} [${format.resolution}]`,
    );
    setDownload({ progress: 0, phase: 'connecting', displayName });

    try {
      const result = await downloadMedia(
        { url, formatId: format.formatId, filename: displayName, kind, vheight: format.height },
        {
          onProgress: (p) => setDownload({ progress: p, phase: 'downloading', displayName }),
          onPhaseChange: (phase) => setDownload({ progress: 0, phase, displayName }),
        },
      );

      setDownload({ progress: 100, phase: 'saving', displayName });

      const finalName = result.filename || `${displayName}.${outputExt}`;
      const objectUrl = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = finalName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);

      setDownload(null);
    } catch (err) {
      setDownload(null);
      setError(err.message);
      setStatus('error');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const reset = () => {
    setStatus('idle');
    setMedia(null);
    setError(null);
    setDownload(null);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">
          <span className="logo">⬇</span> Video Downloader
        </h1>
        <p className="app-subtitle">Paste link video, pilih kualitas, download langsung.</p>
      </header>

      <UrlForm status={status} onFetch={handleFetchInfo} onReset={reset} />

      {error && (
        <div className="error-box" role="alert">
          <strong>⚠ Ops!</strong> {error}
        </div>
      )}

      {status === 'loading' && (
        <div className="center-box">
          <div className="spinner" aria-label="Loading" />
          <p>Ambil info media, moment... ⏳</p>
        </div>
      )}

      {status === 'loaded' && media && (
        <>
          <MediaCard media={media} />
          <div className="formats-section">
            <h2>Pilih format download</h2>
            <ul className="format-list">
              {media.formats.map((f) => (
                <li key={f.formatId}>
                  <label className="format-item">
                    <input
                      type="radio"
                      name="format"
                      value={f.formatId}
                      checked={f.formatId === selectedFormatId}
                      onChange={() => setSelectedFormatId(f.formatId)}
                    />
                    <span className={`format-badge ${f.kind === 'audio' ? 'is-audio' : 'is-video'}`}>
                      {f.kind === 'audio' ? (f.outputExtension || f.extension || 'audio').toUpperCase() : 'MP4'}
                    </span>
                    <span className="format-label">
                      <strong>{f.kind === 'audio' ? 'Audio' : f.resolution}</strong>
                      {f.kind !== 'audio' && <small> · {codecLabel(f.vcodec)}</small>}
                      {f.kind === 'audio' && <em> · hanya suara</em>}
                      {f.kind !== 'audio' && <em> · video + suara</em>}
                    </span>
                    <span className="format-size">
                      {f.filesizeApprox ? formatBytes(f.filesizeApprox) : '—'}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <button
              className="btn btn-primary btn-download"
              onClick={handleDownload}
              disabled={!selectedFormatId || download}
            >
              {download ? 'Downloading...' : `Download ${formatKindLabel(media?.formats.find((f) => f.formatId === selectedFormatId))}`}
            </button>
          </div>
        </>
      )}

      {download && <DownloadProgress download={download} />}

      <footer className="app-footer">
        <small>
          Backend: Express + yt-dlp + ffmpeg · Frontend: React + Vite
        </small>
      </footer>
    </div>
  );
}
