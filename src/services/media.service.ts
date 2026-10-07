import ytdlp from 'yt-dlp-exec';
import { spawn } from 'child_process';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';
import { mkdir, mkdtemp, rm, readdir, stat, readFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';

const require = createRequire(import.meta.url);
const ytdlpPackageJsonPath = require.resolve('yt-dlp-exec/package.json');
const binaryPath = path.join(path.dirname(ytdlpPackageJsonPath), 'bin', 'yt-dlp.exe');

// ffmpeg-static adalah dependency yang bundle binary ffmpeg untuk merge aliran audio+video
// NB: via require() karena paket ts resolve types yang tidak kompatible dengan NodeNext
const ffmpegBin = require('ffmpeg-static') as unknown as string | null;
const ffmpegDir = path.dirname(ffmpegBin ?? '');

// Membuat Interface/Tipe Data untuk hasil keluaran
export interface FormatItem {
  formatId: string;
  extension: string;
  resolution: string;
  qualityLabel: string;
  hasVideo: boolean;
  hasAudio: boolean;
  filesizeApprox: number | null;
  /** Tinggi resolusi px (mis. 1080). null untuk audio-only. */
  height: number | null;
  /** Codec video mentah dari yt-dlp (mis. "avc1.640028", "vp09...", "av01..."). */
  vcodec: string;
  /** Codec audio mentah dari yt-dlp (mis. "mp4a.40.2", "opus"). */
  acodec: string;
  /**
   * Apa yang benar-benar akan diunduh:
   * - "video" = video + audio, hasil .mp4
   * - "audio" = audio saja, hasil ekstensi asli (m4a/webm/opus)
   */
  kind: 'video' | 'audio';
  /** Ekstensi file yang akan dihasilkan server. */
  outputExtension: string;
  /** Protokol yt-dlp (https / m3u8_native / ...). Dipakai untuk preferensi kualitas. */
  protocol: string;
}

export interface MediaInfoResponse {
  title: string;
  thumbnail: string;
  duration: number;
  uploader: string;
  formats: FormatItem[];
}

export const extractMediaInfo = async (url: string): Promise<MediaInfoResponse> => {
  const output: any = await ytdlp(url, {
    dumpSingleJson: true,
    noCheckCertificate: true,
    noWarnings: true,
    preferFreeFormats: true,
  });

  const rawFormats: any[] = Array.isArray(output.formats) ? output.formats : [];

  // HLS audio-only berekstensi mp4 (mis. format 233/234: vcodec=none,
  // acodec=none, protokol m3u8) menyimpan playlist HLS, BUKAN audio progresif
  // biasa — maka disembunyikan karena membingungkan (dikiranya dapat .mp4).
  // Pengecualian: kalau TIDAK ada satupun audio non-HLS, biarkan agar user
  // tetap punya pilihan audio.
  const hasHttpsAudio = rawFormats.some(
    (f: any) => (f.acodec || 'none') !== 'none' && !String(f.protocol || '').includes('m3u8'),
  );

  const formats: FormatItem[] = rawFormats
    .filter((f: any) => {
      const vc = f.vcodec || 'none';
      const ac = f.acodec || 'none';
      if (vc !== 'none' || ac !== 'none') return true;
      // mhtml storyboard & sejenisnya: tanpa video tanpa audio → buang.
      return false;
    })
    .filter((f: any) => {
      const proto = String(f.protocol || '');
      const isHlsAudioMp4 =
        (f.vcodec || 'none') === 'none' &&
        (f.acodec || 'none') === 'none' &&
        proto.includes('m3u8') &&
        f.ext === 'mp4';
      return !(isHlsAudioMp4 && hasHttpsAudio);
    })
    .map((f: any) => {
      const hasVideo = (f.vcodec || 'none') !== 'none';
      const hasAudio = (f.acodec || 'none') !== 'none';
      // Track video-only tetap diunduh sebagai video+audio (.mp4).
      // Track audio-only diunduh sebagai file audio, bukan .mp4.
      const kind: 'video' | 'audio' = hasVideo ? 'video' : 'audio';
      const proto = String(f.protocol || '');
      // HLS audio mp4 tanpa info codec jelas: anggap audio biasa supaya
      // menu menulis ekstensi & behaviour yang benar.
      const audioExt = f.ext && f.ext !== 'mp4' ? f.ext : (proto.includes('m3u8') && !hasVideo ? 'mp3' : f.ext || 'm4a');
      return {
        formatId: f.format_id,
        extension: f.ext,
        resolution: hasVideo ? `${f.height || '?'}p` : 'Audio',
        qualityLabel: f.format_note || (hasVideo ? 'video' : 'audio'),
        hasVideo,
        hasAudio,
        filesizeApprox: f.filesize || f.filesize_approx || null,
        height: hasVideo ? f.height || null : null,
        vcodec: hasVideo ? f.vcodec || '' : '',
        acodec: f.acodec || '',
        kind,
        outputExtension: hasVideo ? 'mp4' : audioExt,
        protocol: proto,
      };
    });

  return {
    title: output.title,
    thumbnail: output.thumbnail,
    duration: output.duration,
    uploader: output.uploader,
    formats: formats,
  };
};

export interface DownloadedMedia {
  /** lokasi file hasil akhir di disk (temp) */
  filePath: string;
  /** ukuran file dalam bytes */
  size: number;
  /** ekstension file hasil (mp4, webm, ...) */
  extension: string;
  /** delete file + folder temp */
  cleanup: () => void;
}

export interface DownloadOptions {
  /** Called periodically; return true untuk abort (e.g. klien koneksi putus). */
  shouldCancel?: () => boolean;
  /** Max ms menunggu. Default 30 min. */
  timeoutMs?: number;
  /**
   * true  = VIDEO: video + audio, container mp4.
   * false = AUDIO: file audio asli, jangan dipaksa jadi mp4.
   * Default true (backward-compatible).
   */
  addBestAudio?: boolean;
  /** Target tinggi resolusi (px) untuk request video. */
  height?: number | null;
  /** format_id video yang dipilih user. Dipakai agar resolusi yang diunduh = yang dipilih. */
  videoFormatId?: string | null;
}

const readTailFile = async (filePath: string, maxChars = 2000): Promise<string> => {
  try {
    const data = await readFile(filePath, { encoding: 'utf8' });
    return data.slice(-maxChars);
  } catch {
    return '';
  }
};

/**
 * Cek apakah file berisi stream video ('v') atau audio ('a') menggunakan ffmpeg.
 * Teknik: `-map 0:v` / `-map 0:a` → exit code 0 = ada, selainnya = tidak ada.
 */
const streamExists = (
  ffmpegBinPath: string,
  filePath: string,
  streamType: 'v' | 'a',
): Promise<boolean> =>
  new Promise((resolve) => {
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(
        ffmpegBinPath,
        ['-v', 'error', '-i', filePath, '-map', `0:${streamType}`, '-f', 'null', '-'],
        { stdio: ['ignore', 'ignore', 'pipe'] },
      );
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
      resolve(false);
    }, 15_000);

    proc.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });

/**
 * Download video + audio dan merge menjadi 1 file playable dengan ffmpeg.
 *
 * Kenapa tidak lagi stream stdout (approah lama `-o -`)?
 * - YouTube modern hanya memberikan format DASH split (video SEPARAT dari audio).
 *   Stream langsung ke stdout hanya bisa 1 format -> video tanpa audio / atau fail
 *   karena format lama (ex: 18) sudah tidak tersedia.
 * - Jadi: download ke folder temp -> merge dengan ffmpeg (ffmpeg-static) -> hasil
 *   file siap untuk stream ke klien -> cleanup.
 */
export const downloadMediaToFile = async (
  url: string,
  formatId: string,
  options: DownloadOptions = {}
): Promise<DownloadedMedia> => {
  const { shouldCancel, timeoutMs = 30 * 60 * 1000 } = options;

  // --- Format selector ---
  // YouTube modern memisah video dan audio (DASH). Karena itu:
  //   VIDEO  -> selalu gabungkan video yang DIPILIH + audio AAC, hasil .mp4.
  //            Jangan pakai selector "best" tanpa filter video: itu bisa jatuh
  //            ke audio-only, sehingga menu "video" mengunduh file tanpa gambar.
  //   AUDIO  -> ambil format audio asli. Jangan --remux-video mp4, karena itu
  //            yang membuat audio-only tersimpan sebagai .mp4.
  const wantsCombined = formatId.includes('+');
  const videoRequest = options.addBestAudio !== false;
  const targetHeight = options.height && options.height > 0 ? options.height : null;
  const pickedVideoId = options.videoFormatId || (!wantsCombined ? formatId : null);

  let effectiveFormat: string;
  if (wantsCombined) {
    effectiveFormat = formatId;
  } else if (!videoRequest) {
    effectiveFormat = `${formatId}/bestaudio[ext=m4a]/bestaudio`;
  } else {
    // GABUNG SELALU BERPASANGAN: tiap kandidat video + tiap kandidat audio.
    // yt-dlp `-f` pakai "/" sebagai fallback dan "+" sebagai merge. Pola
    // `A/B+C/D` bisa diparse sebagai `A` lalu `B+C` lalu `D` — kandidat tunggal
    // seperti `140` (audio saja) atau `160` (video saja) akan dipilih tanpa
    // pasangan dan menghasilkan file yang salah. Karena itu tiap alternatif
    // di bawah SELALU berbentuk `VIDEO+AUDIO` atau `VIDEO+AUDIO/VIDEO+AUDIO`.
    // Untuk video, pakai format_id EXACT dulu (yang dipilih user di menu),
    // lalu bestvideo se-resolusi sebagai cadangan. Tidak ada fallback `best`
    // polos karena `best` sistem bisa berupa audio-only (vcodec=none).
    const heightFilter = targetHeight ? `[height<=${targetHeight}]` : '';
    const videoAlternatives = [
      pickedVideoId,
      pickedVideoId ? `bestvideo[format_id=${pickedVideoId}]` : '',
      `bestvideo${heightFilter}[vcodec^=avc1][ext=mp4]`,
      `bestvideo${heightFilter}[vcodec^=avc1]`,
      `bestvideo${heightFilter}[ext=mp4]`,
      `bestvideo${heightFilter}`,
    ].filter(Boolean) as string[];
    const audioAlternatives = [
      'bestaudio[ext=m4a]',
      'bestaudio[acodec^=mp4a]',
      'bestaudio[protocol^=https]',
      'bestaudio',
    ];
    effectiveFormat = videoAlternatives
      .map((v) => audioAlternatives.map((a) => `${v}+${a}`).join('/'))
      .join('/');
  }

  // --- Folder temp unik per download ---
  const tmpRoot = path.join(process.env.TEMP || process.env.TMP || '.', 'video-downloader-apps');
  try {
    await mkdir(tmpRoot, { recursive: true });
  } catch (error: any) {
    if (error?.code !== 'EEXIST') throw error;
  }
  const jobDir = await mkdtemp(path.join(tmpRoot, `dl-${crypto.randomUUID()}-`));
  const stderrLogPath = path.join(jobDir, 'ytdlp.stderr.log');
  const outputTemplate = path.join(jobDir, 'media.%(ext)s');

  const args: string[] = [
    url,
    '-f', effectiveFormat,
    '-o', outputTemplate,
    // Hanya percaya merge + remux ke mp4 ketika hasilnya diharapkan video.
    // Untuk audio-only, biarkan ekstensi asli (m4a/webm).
    ...(wantsCombined || videoRequest
      ? ['--merge-output-format', 'mp4', '--remux-video', 'mp4']
      : []),
    '--ffmpeg-location', ffmpegDir,
    '--no-check-certificates',
    '--no-warnings',
    '--no-progress',
  ];

  const proc = spawn(binaryPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });

  let cleanedUp = false;
  const cleanupNow = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    try {
      proc.kill();
    } catch {
      /* proses sudah exit */
    }
    rm(jobDir, { recursive: true, force: true }).catch(() => {});
  };

  // KRITIS: stderr harus terus drain (pipe => file log), sinon buffer OS
  // (64KB) penuh dan yt-dlp hanging selama download besar.
  if (proc.stderr) {
    proc.stderr.pipe(createWriteStream(stderrLogPath));
  }

  let timedOut = false;
  let exitCode: number | null = null;
  let spawned = false;

  const exitPromise = new Promise<void>((resolve, reject) => {
    proc.on('spawn', () => {
      spawned = true;
    });
    proc.on('exit', (code: number | null) => {
      exitCode = code;
      resolve();
    });
    // fire jika proses gagal spawn (binary path sai / permission)
    proc.on('error', (err: Error) => reject(err));
  });

  // Watchdog: timeout atau klien cancel -> kill process
  const watchdog = setTimeout(() => {
    timedOut = true;
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
  }, timeoutMs);
  const cancelPoller = setInterval(() => {
    if (shouldCancel?.()) {
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
    }
  }, 2000);

  try {
    await exitPromise;
  } catch (error) {
    clearTimeout(watchdog);
    clearInterval(cancelPoller);
    cleanupNow();
    throw error;
  }
  clearTimeout(watchdog);
  clearInterval(cancelPoller);

  if (timedOut) {
    cleanupNow();
    throw new Error(`Download timeout (${timeoutMs} ms).`);
  }
  if (!spawned) {
    cleanupNow();
    throw new Error('Gagal launch proses yt-dlp.');
  }
  if (exitCode !== 0) {
    const tail = await readTailFile(stderrLogPath);
    cleanupNow();
    throw new Error(`yt-dlp exit code ${exitCode}: ${tail || 'unknown error'}`);
  }

  // --- Detecta file output dari yt-dlp (media.<ext>) ---
  let names: string[] = [];
  try {
    names = await readdir(jobDir);
  } catch {
    names = [];
  }

  // skip fragment file (media.f137.mp4, media.f251.webm) dari proses merge
  const mediaName = names.find((n) => n.startsWith('media.') && !n.startsWith('media.f') && n !== 'ytdlp.stderr.log');

  if (!mediaName) {
    const tail = await readTailFile(stderrLogPath);
    cleanupNow();
    throw new Error(
      `Download gagal: format "${formatId}" tidak tersedia atau tidak ada output file. ${tail || '(no stderr)'}`,
    );
  }

  const filePath = path.join(jobDir, mediaName);
  const meta = await stat(filePath);
  const extension = path.extname(mediaName).replace('.', '');

  // --- Safety net: pastikan stream sesuai permintaan benar-benar ada ---
  // Misal user minta VIDEO tapi hasil ternyata hanya audio (tanpa track video),
  // jangan diam-diam kirim file yang salah — lebih baik error yang jelas.
  if (ffmpegBin) {
    const streamType: 'v' | 'a' = videoRequest ? 'v' : 'a';
    const hasStream = await streamExists(ffmpegBin, filePath, streamType);
    if (!hasStream) {
      const readable = streamType === 'v' ? 'video' : 'audio';
      cleanupNow();
      throw new Error(
        `Hasil download tidak mengandung stream ${readable} (format "${formatId}"). Coba format lain.`,
      );
    }
  }

  return {
    filePath,
    size: meta.size,
    extension,
    cleanup: cleanupNow,
  };
};
