# Solfa Piano

Type tonic solfa and hear it played. Supports Ghanaian hymnal notation —
multiple parts (Soprano/Alto/Tenor/Bass), `Doh = X` keys, chromatic syllables
(`fe` = raised fa, a lone `e` = raised tonic), holds, ties and repeats — plus
WAV recording and OCR of printed solfa sheets.

Live at <https://don-jeff122.github.io/solfa-player/>.

## Features

- Solfa input with keys, metre, durations, octave marks and repeats
- Four-part hymnal sheets: `S:`/`A:`/`T:`/`B:` rows are routed to their own
  voice, played together or soloed
- On-screen piano keyboard, voice / sustain / tempo controls
- Playback through a dependency-free Web Audio synth (no samples)
- Record and download a WAV of the playback
- Scan a printed page or PDF with Tesseract (loaded on demand) and turn it
  into playable solfa
- Sheets persist in the browser (`localStorage`); a fresh browser is seeded
  with the built-in "Abide with Me" sample

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

## Layout

- `src/lib/parseSolfa.js` — solfa text → parsed notes/parts
- `src/lib/hymnal.js` — scanners for printed hymnal sheets (`d : d | m : -`,
  `S:` part rows, `Doh = A` headers)
- `src/audio/Synth.js`, `src/audio/voices.js` — Web Audio synthesizer and
  instrument presets (all plain data, fully unit-tested)
- `src/components/` — piano, controls, saved sheets, sheet scanner
- `src/lib/ocr.js`, `src/lib/ocrService.js` — Tesseract OCR + PDF handling,
  loaded lazily when the scanner opens