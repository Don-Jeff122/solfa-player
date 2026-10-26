# Solfa Piano

Type tonic solfa and hear it played. Supports Ghanaian hymnal notation,
multiple parts (Soprano/Alto/Tenor/Bass), `Doh = X` keys, chromatic syllables
(`fe` = raised fa, a lone `e` = raised tonic), holds, slurs (underscored notes
sung to one syllable and played legato), ties and repeats, plus WAV recording.

Live at <https://don-jeff122.github.io/solfa-player/>.

## Features

- Solfa input with keys, metre, durations, octave marks and repeats
- Four-part hymnal sheets: `S:`/`A:`/`T:`/`B:` rows are routed to their own
  voice, played together or soloed
- On-screen piano keyboard, voice / sustain / tempo controls
- Playback through a dependency-free Web Audio synth (no samples)
- Record and download a WAV of the playback
- Sheets persist in the browser (`localStorage`); a fresh browser is seeded
  with the built-in "Abide with Me" sample
- Optional layout-aware scan of images and PDFs with editable OCR corrections
  (requires the local FastAPI backend described below)

## Getting started

```sh
npm install
npm run dev        # local dev server
npm run test       # vitest
npm run lint       # oxlint
npm run build      # production build -> dist/
npm run preview    # serve the production build locally
```

## Scanning solfa sheets

“Scan Solfa” uploads a PNG/JPG/JPEG or PDF to a local FastAPI service, rebuilds
the approximate page layout from PaddleOCR text boxes, and shows the source and
reconstructed layout side by side plus an editable-text view. Characters can be
corrected individually, with undo/redo, and the result can be copied or exported
as TXT or SVG. OCR confidence and uncertain characters stay visible; recognition
is never presented as guaranteed.

The existing frontend is JavaScript/JSX, so the scanner follows that convention
rather than introducing a TypeScript build.

### Backend setup

Python 3.13 and the backend virtual environment are used locally:

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

The first scan downloads the PP-OCRv6 detection and recognition models. On some
Windows CPUs, oneDNN is incompatible with these models; `PaddleOcrEngine` sets
`PADDLE_PDX_ENABLE_MKLDNN_BYDEFAULT=False` unless that variable is explicitly
overridden.

Read `backend/.env.example` for optional limits and OCR settings. The backend
reads normal process environment variables and does not load `.env` files
automatically. API documentation is served at <http://127.0.0.1:8000/docs>.

### Frontend configuration

The frontend defaults to `http://127.0.0.1:8000`. Point it elsewhere with
`VITE_SCAN_API_URL` at build/dev time, and allow the deployed origin through
`SOLFA_SCAN_CORS_ORIGINS` on the backend. Some browsers block an HTTPS deployment
from calling a plain-HTTP loopback service, so use a local frontend or an HTTPS
backend when scanning from the hosted site. Playback and the rest of the app
remain static and work without the backend; only scanning needs it.

### Scanner tests

```powershell
# Frontend helpers and the rest of the app
npm test

cd backend
# Backend API/layout tests (real OCR test is skipped by default)
.\.venv\Scripts\python.exe -m pytest
# Real PaddleOCR smoke test
$env:SOLFA_RUN_OCR_TESTS="1"
.\.venv\Scripts\python.exe -m pytest tests/test_ocr_integration.py
Remove-Item Env:SOLFA_RUN_OCR_TESTS
```

### Scanner limitations

- Character boxes are estimated inside OCR line boxes; they are not native
  per-glyph detections.
- Braces, multi-line stacks and other structural marks are preserved only when
  detected by OCR/rules. Photos with strong perspective are not fully unwarped.
- Uploads, jobs and corrections live in the backend process and its temporary
  directory. Defaults: 25 MB, 40 pages, two-hour cleanup. Restarting the backend
  clears them.
- Layout export is SVG and editable export is TXT. PDF export is intentionally
  absent: browser-printed HTML would not remain editable or faithful.
- Printed SVG/TXT must be reviewed against the source; uncertain marks are
  surfaced for that reason.
- The PWA caches the app shell for offline playback, but scanning still needs a
  reachable backend.

## Deploying

The repo includes a GitHub Pages workflow (`.github/workflows/deploy.yml`) that
builds the app and publishes it on every push to `main`. The Vite build uses a
relative `base` (`./` in `vite.config.js`) so the app also works from the
Pages subpath.

## Offline use (installable PWA)

The build is a Progressive Web App: open the deployed site once and install it
(Add to Home Screen / install icon in the address bar). A service worker
(`vite-plugin-pwa` + Workbox) precaches the app shell so playback and saved
sheets work with no connection.

## Layout

- `src/lib/parseSolfa.js`: solfa text → parsed notes/parts
- `src/lib/hymnal.js`: parser for Ghanaian hymnal notation (`d : d | m : -`,
  `S:` part rows, `Doh = A` headers)
- `src/audio/Synth.js`, `src/audio/voices.js`: Web Audio synthesizer and
  instrument presets (all plain data, fully unit-tested)
- `src/components/`: piano, controls, saved sheets and the scanner overlay
- `src/lib/scanApi.js`, `src/lib/scanLayout.js`: scanner client and layout/export
  helpers
- `backend/app/`: FastAPI routes, temporary scan jobs, image/PDF preprocessing,
  PaddleOCR adapter and solfa layout reconstruction
- `backend/tests/`: API, layout and opt-in real-OCR tests
