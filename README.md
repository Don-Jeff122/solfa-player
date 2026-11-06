# Solfa Piano

Type tonic solfa and hear it played. Supports Ghanaian hymnal notation,
multiple parts (Soprano/Alto/Tenor/Bass), `Doh = X` keys, chromatic syllables
(`fe` = raised fa, a lone `e` = raised tonic), holds, slurs (underscored notes
sung to one syllable and played legato), ties and repeats, plus WAV recording
and Gemini-assisted reading of printed solfa sheets.

Live at <https://don-jeff122.github.io/solfa-player/>.

## Features

- Solfa input with keys, metre, durations, octave marks and repeats
- Four-part hymnal sheets: `S:`/`A:`/`T:`/`B:` rows are routed to their own
  voice, played together or soloed
- On-screen piano keyboard, voice / sustain / tempo controls
- Playback through a dependency-free Web Audio synth (no samples)
- Audio is prepared automatically before Play and keeps playing when switching
  tabs or apps, or locking the screen
- Record and download a WAV of the playback
- Read an image or PDF with Gemini and turn a solfa page into playable music
- Four-part Gemini results keep their sheet-style layout: title, key, metre,
  composer, braced Soprano/Alto/Tenor/Bass rows and lyric lines, all editable
- General document mode returns editable text with TXT export
- Gemini page reading through an owner-hosted Cloudflare Worker; only the
  current page is sent, after explicit consent
- A visible library of sheets saved in this browser (`localStorage`), with
  update, copy, replace and delete-undo actions

## Getting started

```sh
npm install
npm run dev        # local dev server
npm run test       # vitest
npm run lint       # oxlint
npm run build      # production build -> dist/
npm run preview    # serve the production build locally
```

## Deploying

The repo includes a GitHub Pages workflow (`.github/workflows/deploy.yml`) that
builds the app and publishes it on every push to `main`. The Vite build uses a
relative `base` (`./` in `vite.config.js`) so the app also works from the
Pages subpath.

Gemini page reading requires the repository Actions variable
`GEMINI_PROXY_URL` to be set to the deployed Worker URL before building. If it
is empty, the build succeeds and the Gemini scanner button stays hidden.

## Offline use (installable PWA)

The build is a Progressive Web App: open the deployed site once and install it
(Add to Home Screen / install icon in the address bar). A service worker
(`vite-plugin-pwa` + Workbox) precaches the app shell, so playback, saved sheets
and image/PDF page rendering work without a connection. Gemini page reading is
network-only and fails with a clear message when offline.

## Gemini page reading

The scanner accepts images (JPG, PNG, WebP, BMP) and multi-page PDFs. PDFs are
rendered locally one page at a time; the page image is sent to Gemini only after
you press **Read with Gemini**.

The scanner has two modes:

- **Solfa sheet** returns editable four-part notation. The result keeps the
  printed title, key, metre, composer, lyrics and braced voice rows. The sheet
  text is parsed directly by the player.
- **General document** returns editable page text that can be copied or
  downloaded as `.txt`.

The first Gemini read asks for consent. Later reads send only the page you are
viewing. Gemini recognition can be wrong, so check every row, key, lyric and
word against the original.

The Gemini key must not be placed in this static app. Deploy the included
Cloudflare Worker:

```sh
cd worker
npx wrangler@4 secret put GEMINI_API_KEY
npx wrangler@4 deploy
```

Then set the GitHub Actions repository variable `GEMINI_PROXY_URL` to the
Worker URL and rebuild. The Worker allowlists the GitHub Pages and localhost
origins, validates the page image and mode, and builds the Gemini request
server-side. Add a Cloudflare rate-limiting rule for the Worker route so the
owner's key cannot be abused.

For local development, copy `worker/.dev.vars.example` to `worker/.dev.vars`,
add your Google AI Studio key, run `npx wrangler@4 dev` from `worker/`, and set
`VITE_GEMINI_PROXY_URL=http://127.0.0.1:8787` in `.env.local`.

Gemini processes the page on Google's servers. The app sends only the current
page, after confirmation, and does not save images on the proxy. If the Gemini
API key uses the free tier, Google may use submitted content to improve its
products; use a paid key if that is not acceptable. The Worker uses the current
Interactions API schema and keeps the API key and prompts off the browser.

For Solfa transcription it tries `gemini-3.8-flash`, `gemini-3.6-flash`,
`gemini-3.7-flash` and `gemini-3-flash-preview` before the lite models, because
notation accuracy matters more than the cheapest fallback. The Worker validates
the returned rows with the same parser as the player. If a model returns
unsupported notation, it retries the next model; if every model fails, it
returns the last editable sheet with a correction warning instead of silently
guessing notes. General document mode keeps the lighter fallback order.

## Layout

- `src/lib/parseSolfa.js`: solfa text -> parsed notes/parts
- `src/lib/hymnal.js`: parser for printed hymnal notation (`d : d | m : -`,
  `S:` part rows, `Doh = A` headers)
- `src/audio/Synth.js`, `src/audio/voices.js`: Web Audio synthesizer and
  instrument presets (all plain data, fully unit-tested)
- `src/components/`: piano, controls, saved sheets, Gemini sheet reader
- `src/lib/documentService.js`: lazy image/PDF page rendering with pdf.js
- `src/lib/scan/geminiService.js`: Gemini consent, request and result validation
- `src/lib/scan/geminiResults.js`: combines per-page Gemini results
- `src/lib/scan/geminiSheet.js`: Gemini sheet assembly helpers
- `src/lib/scan/solfaValidation.js`: shared notation checker for the app and Worker
- `worker/gemini-proxy.js`: owner-hosted Cloudflare Worker that keeps the Gemini
  key off the client and builds the structured request
- `src/components/scanner/GeminiDialog.jsx`: first-use consent and Gemini
  progress/error dialog
