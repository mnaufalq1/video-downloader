# 🎬 Video Downloader — Frontend (React + Vite)

Frontend untuk backend Express ([`../src`](../src)). Berjalan di `http://localhost:5173` dan
proxy `/api/*` diteruskan ke backend di `http://localhost:5000`.

## Run

```bash
# 1. Install dependsi (di folder ini)
pnpm install --ignore-workspace --prod=false --no-frozen-lockfile

# 2. Start backend Express (di folder root project)
pnpm dev

# 3. Start frontend dev server
pnpm dev
```

> Backend harus berjalan lebih dulu (port 5000) supaya proxy `/api` bisa berfungsi.

## Build production

```bash
pnpm build     # output di frontend/dist
pnpm preview   # serve hasil build lokal
```

## Deploy Netlify

Konfigurasi `netlify.toml` memakai base directory `fe` dan publish directory `dist`
(relatif terhadap base directory). Instalasi memakai `--ignore-workspace` agar
dependency frontend, termasuk Vite, terpasang di `fe/node_modules` tanpa memakai
workspace dan lockfile backend di root. Flag `--prod=false` memastikan dev dependency
ikut terpasang, sedangkan `--no-frozen-lockfile` mengizinkan pembuatan lockfile frontend
yang belum tersedia di repository saat build CI.

## Struktur

```
frontend/
├── index.html
├── vite.config.js        # proxy /api → http://localhost:5000
└── src/
    ├── main.jsx          # entry point
    ├── App.jsx           # state machine utama
    ├── api.js            # helper fetch → POST /api/media/info & GET /api/media/download
    ├── utils.js          # format durasi / ukuran / nama file
    ├── styles.css
    └── components/
        ├── UrlForm.jsx           # input URL + tombol info
        ├── MediaCard.jsx         # thumbnail, judul, uploader, durasi
        └── DownloadProgress.jsx  # progress bar + phase text
```

## API Reference

| Method | Endpoint | Use |
|---|---|---|
| `POST` | `/api/media/info` | Ambil metadata + list format (body: `{ "url": "..." }`) |
| `GET`  | `/api/media/download` | Download media (query: `url`, `formatId`, `filename?`, `kind=video|audio`, `vheight?`) |
