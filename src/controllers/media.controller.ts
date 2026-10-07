import { Request, Response } from 'express';
import { extractMediaInfo, downloadMediaToFile } from '../services/media.service.js';
import { open } from 'node:fs/promises';

export const getMediaInfo = async (req: Request, res: Response): Promise<Response> => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL tidak boleh kosong!' });
  }

  try {
    const data = await extractMediaInfo(url);
    return res.json(data);
  } catch (error: any) {
    console.error('Error pada getMediaInfo:', error.message);
    return res.status(500).json({
      error: `Gagal memproses URL tersebut. ${error.message || 'Pastikan tautan valid dan publik.'}`,
    });
  }
};

const sanitizeFilename = (name: string | undefined, extension: string): string => {
  const base = (name || `video.${extension}`)
    .replace(/[^\w\-. ]+/g, '_')
    .replace(/\.+$/g, '')
    .slice(0, 200);
  return base.endsWith(`.${extension}`) ? base : `${base}.${extension}`;
};

export const downloadMedia = async (req: Request, res: Response): Promise<void> => {
  const { url, formatId, filename } = req.query;

  if (!url || !formatId) {
    res.status(400).json({ error: 'Parameter url dan formatId wajib diisi!' });
    return;
  }

  // Jika klien koneksi putus (cancel), signal ke proses download untuk stop
  let aborted = false;
  req.on('close', () => {
    aborted = true;
  });

  // kind=audio  ATAU audioOnly=1 => unduh audio saja, ekstensi asli (bukan .mp4).
  // kind=video (default)       => unduh video yang dipilih + audio AAC, hasil .mp4.
  // vheight                    => cadangan resolusi jika format_id video tidak ada.
  const isAudioOnly = req.query.kind === 'audio' || req.query.audioOnly === '1';
  const height = Number(req.query.vheight) || null;
  const videoFormatId = isAudioOnly ? null : String(formatId);

  let download;
  try {
    download = await downloadMediaToFile(url as string, formatId as string, {
      shouldCancel: () => aborted,
      addBestAudio: !isAudioOnly,
      height,
      videoFormatId,
    });
  } catch (error: any) {
    console.error('Error pada downloadMedia (proses download):', error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: `Gagal mengunduh media: ${error.message}` });
    }
    return;
  }

  const cleanFilename = sanitizeFilename(filename as string | undefined, download.extension);

  // Set Header agar browser mengenali ini sebagai file unduhan (Attachment)
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="video.${download.extension}"; filename*=UTF-8''${encodeURIComponent(cleanFilename)}`,
  );
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', String(download.size));

  // Stream file hasil ke klien + cleanup folder temp
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    download.cleanup();
  };

  try {
    const handle = await open(download.filePath);
    const stream = handle.createReadStream();

    stream.on('error', (err: Error) => {
      console.error('Stream media error:', err.message);
      cleanup();
    });

    // cleanup setelah response finish / koneksi close (abort klien)
    res.on('finish', cleanup);
    res.on('close', cleanup);

    stream.pipe(res as any); // Express ServerResponse as pipe destination
  } catch (error: any) {
    console.error('Error pada downloadMedia (stream):', error.message);
    cleanup();
    if (!res.headersSent) {
      res.status(500).json({ error: 'Gagal mengunduh media.' });
    }
  }
};