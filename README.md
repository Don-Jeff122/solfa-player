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
- Optional layout-aware scan of images and PDFs with editable OCR corrections,
  measure-aligned part review and source-linked notes (requires the local FastAPI
  backend described below)

## Getting started

```sh
npm install
npm run dev        # local dev server
npm run test       # vitest
npm run lint       # oxlint
npm run typecheck  # TypeScript score/review layer
npm run build      # production build -> dist/
npm run preview    # serve the production build locally
```

## Scanning solfa sheets

“Scan Solfa” uploads a PNG/JPG/JPEG or PDF to a local FastAPI service, rebuilds
the approximate page layout from PaddleOCR text boxes, and shows the source and
reconstructed layout side by side plus an editable-text view. Characters can be
corrected individually, with undo/redo, and the result can be copied or exported
as TXT or SVG.

The Parts view builds a measure-aligned score from the recognized lines. It
keeps Soprano, Alto, Tenor and Bass rows separate, infers missing labels from
vertical order only when the evidence supports it, preserves page/system/measure
source links, and fills short voices with rests instead of moving notes. Part
assignments can be corrected with undo/redo. Recognized playable text is sent to
the existing player; if a line still needs a part or a score error remains, the
send is blocked instead of silently dropping music. OCR confidence and uncertain
characters stay visible; recognition is never presented as guaranteed.

The score and review layer is TypeScript (`src/lib/scanScore.ts` and
`src/components/scanner/MusicReview.tsx`); the rest of the scanner stays JSX.
`npm run typecheck` checks the typed layer.

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
from calling a plain-HTTP loopback service, so use a local frontend or the HTTPS
backend described under [Deploying](#deploying). Playback and the rest of the app
remain static and work without the backend; only scanning needs it.

When the hosted OCR service has been idle, the scanner retries the health check
for up to about a minute and shows "Waking OCR service…" while it starts.

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
- Part names and four-part layouts are not assumed. Unlabelled lines are inferred
  only from a clear four-row system or a single melody; ambiguous lines stay
  unassigned and block playback until reviewed.
- A score error or unreadable music line blocks sending. Short bars are padded
  with rests; the printed metre is omitted from playback when every bar does not
  fit it, and a warning explains why.
- Braces, multi-line stacks and other structural marks are preserved only when
  detected by OCR/rules. Photos with strong perspective are not fully unwarped.
- Uploads, jobs and corrections live in the backend process and its temporary
  directory. Defaults: 25 MB, 40 pages, two-hour cleanup. Restarting the backend
  clears them.
- Layout export is SVG and editable export is TXT. PDF export is intentionally
  absent: browser-printed HTML would not remain editable or faithful.
- Printed SVG/TXT must be reviewed against the source; uncertain marks are
  surfaced for that reason.
- The PWA caches the app shell for offline playback. Browser OCR assets are cached after the first load.

## Deploying

The repo includes a GitHub Pages workflow (`.github/workflows/deploy.yml`) that
builds the app and publishes it on every push to `main`. The Vite build uses a
relative `base` (`./` in `vite.config.js`) so the app also works from the
Pages subpath.

GitHub Pages cannot run FastAPI or PaddleOCR. The live scanner therefore uses a
separate public Docker Space on Hugging Face, kept in sync by a second workflow.

### Hugging Face backend setup

A Hugging Face PRO account is required for Docker Spaces. The public Space uses
the CPU Basic runtime (2 vCPU, 16 GB RAM).

1. Create a Hugging Face write token with access to Spaces:
   <https://huggingface.co/settings/tokens>.
2. Add it to the GitHub repository as the secret `HF_TOKEN`.
3. Add the repository variable `HF_SPACE_ID` using
   `<your-hf-username>/solfa-scan-api`.
4. Run the **Deploy backend to Hugging Face** workflow. It creates the public
   Docker Space if needed and uploads `backend/`; do not edit the Space files
   directly.
5. Wait for the Space to finish building, then open its direct URL,
   `https://<your-hf-username>-solfa-scan-api.hf.space`. Check
   `/api/health` returns an OCR description.
6. Add the repository variable `VITE_SCAN_API_URL` with that URL, then rerun the
   **Deploy to GitHub Pages** workflow.

The Space builds the OCR models into the image, so restarts do not re-download
them. It sleeps after prolonged inactivity and wakes on the next request; the
scanner retries while it starts.

`backend/Dockerfile` allows the production Pages origin
`https://don-jeff122.github.io`. Update `SOLFA_SCAN_CORS_ORIGINS` there if the
frontend origin changes. Uploads, jobs and corrections remain temporary and are
cleared when the Space restarts; do not scan sensitive documents.

To return to the pre-deployment state, check out the `pre-hf-deploy` tag,
remove `VITE_SCAN_API_URL` from the repository variables, rerun the Pages
workflow, and pause or delete the Hugging Face Space.

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
- `src/lib/scanScore.ts`: typed part/system/measure score builder, alignment,
  warnings and canonical player text
- `src/components/scanner/MusicReview.tsx`: part assignment, source-linked note
  review and aligned-text preview
- `backend/app/`: FastAPI routes, temporary scan jobs, image/PDF preprocessing,
  PaddleOCR adapter and solfa layout reconstruction
- `backend/Dockerfile`, `backend/README.md`: Hugging Face Docker Space packaging
- `backend/tests/`: API, layout and opt-in real-OCR tests
- `.github/workflows/deploy-backend.yml`: mirrors `backend/` to Hugging Face
