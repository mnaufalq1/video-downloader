const PHASE_LABELS = {
  connecting: 'Menghubungi server & memproses video... (merge audio+video pakai ffmpeg)',
  downloading: 'Downloading aliran media...',
  saving: 'Simpan file ke device...',
};

/**
 * Progress bar download.
 * download: { progress: 0-100, phase: 'connecting'|'downloading'|'saving', displayName }
 */
export default function DownloadProgress({ download }) {
  const pct = Math.max(0, Math.min(100, download.progress));
  return (
    <div className="download-progress" role="status" aria-live="polite">
      <div className="progress-header">
        <span className="progress-file" title={download.displayName}>
          {download.displayName}
        </span>
        <span className="progress-percent">{Math.round(pct)}%</span>
      </div>
      <div className="progress-track">
        <div className="progress-bar" style={{ width: `${pct}%` }} />
      </div>
      <p className="progress-phase">{PHASE_LABELS[download.phase] || download.phase}</p>
    </div>
  );
}