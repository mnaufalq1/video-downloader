import { formatDuration } from '../utils.js';

/**
 * Card info media: thumbnail, judul, uploader, durasi.
 */
export default function MediaCard({ media }) {
  return (
    <section className="media-card">
      <div className="media-thumb-wrap">
        {media.thumbnail ? (
          <img className="media-thumb" src={media.thumbnail} alt={`Thumbnail: ${media.title}`} loading="lazy" />
        ) : (
          <div className="media-thumb media-thumb-placeholder">🎬</div>
        )}
      </div>
      <div className="media-meta">
        <h2 className="media-title" title={media.title}>
          {media.title || 'Untitled'}
        </h2>
        <div className="media-info-row">
          {media.uploader && (
            <span className="info-chip">
              <span className="chip-icon">📺</span> {media.uploader}
            </span>
          )}
          {media.duration && (
            <span className="info-chip">
              <span className="chip-icon">⏱</span> {formatDuration(media.duration)}
            </span>
          )}
          <span className="info-chip">
            <span className="chip-icon">🧩</span> {media.formats.length} format
          </span>
        </div>
      </div>
    </section>
  );
}