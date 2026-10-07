// Helper semua call ke API backend.
// - Dev lokal: pakai relative path `/api/...` -> diteruskan Vite proxy
//   ke backend Express (localhost:5000), jadi frontend bisa run dari host mana pun.
// - Production: set VITE_API_URL (mis. URL Railway) -> request langsung ke backend itu.
const API_URL = (import.meta.env.VITE_API_URL || '').trim().replace(/\/$/, '');
const API_BASE = API_URL ? `${API_URL}/api/media` : '/api/media';

/**
 * GET-info media dari URL (POST /api/media/info)
 * @param {string} url
 * @returns {Promise<{title:string, thumbnail:string, duration:number, uploader:string, formats:Array}>}
 */
export async function fetchMediaInfo(url) {
  const res = await fetch(`${API_BASE}/info`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Gagal memproses URL tersebut (HTTP ${res.status}).`);
  }
  return data;
}

/**
 * Download media dengan progress callback (GET /api/media/download)
 * @param {{url:string, formatId:string, filename?:string, kind?:'video'|'audio', vheight?:number|null}} payload
 * @param {{onProgress?: (percent:number)=>void, onPhaseChange?: (phase:'connecting'|'downloading'|'saving')=>void}} callbacks
 * @returns {Promise<{blob:Blob, filename:string, totalBytes:number}>}
 */
export async function downloadMedia({ url, formatId, filename, kind, vheight }, callbacks = {}) {
  const params = new URLSearchParams({ url, formatId });
  // kind wajib dikirim supaya backend tidak menebak jenis file dari format_id.
  params.set('kind', kind === 'audio' ? 'audio' : 'video');
  if (kind !== 'audio' && vheight) params.set('vheight', String(vheight));
  if (filename) params.set('filename', filename);

  callbacks.onPhaseChange?.('connecting');

  const res = await fetch(`${API_BASE}/download?${params.toString()}`, {
    headers: { Accept: 'application/octet-stream' },
  });

  if (!res.ok) {
    let message = `Download gagal (HTTP ${res.status}).`;
    try {
      const data = await res.json();
      if (data.error) message = data.error;
    } catch {
      /* body bukan JSON — ini bukan error dari backend */
    }
    throw new Error(message);
  }

  // Backend mengembalikan nama file final di header Content-Disposition
  const serverFilename = extractFilename(res.headers.get('Content-Disposition'));

  const total = Number(res.headers.get('Content-Length')) || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;

  callbacks.onPhaseChange?.('downloading');

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (typeof callbacks.onProgress === 'function' && total > 0) {
      callbacks.onProgress(Math.min(100, (received / total) * 100));
    }
  }

  const blob = new Blob(chunks, { type: 'application/octet-stream' });
  return { blob, totalBytes: received, filename: serverFilename || filename || '' };
}

/** Ambil nama file dari header Content-Disposition (dukung bentuk filename*=UTF-8'') */
function extractFilename(disposition) {
  if (!disposition) return null;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (star) return star[1];
  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  return plain ? plain[1] : null;
}