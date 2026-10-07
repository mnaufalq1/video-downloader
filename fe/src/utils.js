/** Format duration (sekon) menjadi "mm:ss" atau "h:mm:ss" */
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Format ukuran file bytes → "12.5 MB" / "1.2 GB" */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = Number(bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(decimals)} ${units[unit]}`;
}

/** Sanitize nama file untuk browser download */
export function sanitizeFilename(name) {
  const base = (name || 'download')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return base.slice(0, 160) || 'download';
}

/**
 * Label ramah-codec dari vcodec yt-dlp.
 * Contoh: "avc1.640028" -> "H.264", "vp09.00.10.08" -> "VP9", "av01..." -> "AV1".
 */
export function codecLabel(vcodec) {
  if (!vcodec) return null;
  if (/^avc1|^h264/i.test(vcodec)) return 'H.264';
  if (/^hev1|^h265/i.test(vcodec)) return 'H.265';
  if (/^vp0?9/i.test(vcodec)) return 'VP9';
  if (/^av0?1/i.test(vcodec)) return 'AV1';
  if (/^vp8/i.test(vcodec)) return 'VP8';
  return vcodec;
}

/**
 * Urutkan format: video (by tinggi desc, H.264 dulu) lalu audio-only.
 * Format video yang sama resolusi+codecnya digabung jadi satu pilihan.
 */
export function sortFormats(formats) {
  const videos = [];
  const audios = [];
  const seenVideo = new Set();

  for (const raw of formats || []) {
    const kind = raw.kind || (raw.hasVideo ? 'video' : 'audio');
    if (kind === 'video') {
      const codec = codecLabel(raw.vcodec) || 'Video';
      const key = `${raw.height || raw.resolution}|${codec}`;
      if (seenVideo.has(key)) continue;
      seenVideo.add(key);
      videos.push({
        ...raw,
        kind: 'video',
        outputExtension: 'mp4',
        resolution: raw.height ? `${raw.height}p` : raw.resolution || 'Video',
      });
    } else {
      audios.push({
        ...raw,
        kind: 'audio',
        hasVideo: false,
        outputExtension: raw.outputExtension || raw.extension || 'm4a',
        resolution: 'Audio',
      });
    }
  }

  videos.sort((a, b) => {
    const heightDiff = (b.height || 0) - (a.height || 0);
    if (heightDiff) return heightDiff;
    const aH264 = /^avc1|^h264/i.test(a.vcodec || '') ? 0 : 1;
    const bH264 = /^avc1|^h264/i.test(b.vcodec || '') ? 0 : 1;
    return aH264 - bH264;
  });

  return [...videos, ...audios];
}

export function formatKindLabel(format) {
  if (!format) return 'Media';
  if (format.kind === 'audio' || !format.hasVideo) return 'Audio';
  return [format.resolution, codecLabel(format.vcodec)].filter(Boolean).join(' · ');
}