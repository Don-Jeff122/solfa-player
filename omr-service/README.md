# Solfa OMR service

Standalone PDF-to-MusicXML backend for Solfa Piano. It accepts printed PDF
scores, runs Audiveris 5.11.0 in batch mode, validates the generated partwise
MusicXML, and returns the file through a small HTTP API.

The frontend is a static GitHub Pages app. Audiveris needs Java and a real
operating system process, so this service must run separately on a host that
allows long-running jobs. GitHub Pages and Cloudflare Workers cannot run it.

## Requirements

- Node.js 20 or newer
- Audiveris 5.11.0 installed locally, or Docker
- A host with enough CPU/RAM for OMR jobs (one job at a time by default)

Audiveris supports printed notation. It does not transcribe handwriting. Poor
scans still produce wrong notes, missing rests, bad beams, or split voices;
users must compare the MusicXML with the original page.

## Local setup

1. Install Audiveris:
   - Windows: install `Audiveris-5.11.0-windowsConsole-x86_64.msi` or the normal
     Windows MSI from the official release.
   - Ubuntu 22.04/24.04: install the matching `.deb` from the official release.
2. Point `AUDIVERIS_BIN` at the executable if it is not in a default location.
3. Start the service:

```sh
npm --prefix omr-service start
```

The service listens on `http://0.0.0.0:8788` by default.

Set the frontend build variable:

```sh
VITE_OMR_API_URL=http://127.0.0.1:8788
```

For production, set the GitHub Actions repository variable `OMR_API_URL` to the
public HTTPS URL of this service. If it is unset, the frontend hides the
**PDF to MusicXML** button.

## Docker

Build from the repository root so the shared XML parser is included:

```sh
docker build -f omr-service/Dockerfile -t solfa-omr .
docker run --rm -p 8788:8788 --memory=4g solfa-omr
```

The image installs Audiveris 5.11.0 for Ubuntu 24.04 and wraps it in `xvfb-run`,
because Audiveris uses Java/AWT even during batch processing.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8788` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `OMR_ALLOWED_ORIGINS` | localhost + `https://don-jeff122.github.io` | Comma-separated CORS origins |
| `OMR_MAX_UPLOAD_BYTES` | `26214400` (25 MB) | Maximum PDF upload size |
| `OMR_JOB_TIMEOUT_MS` | `600000` (10 min) | Audiveris process timeout |
| `OMR_JOB_TTL_MS` | `3600000` (1 hour) | How long finished jobs stay in memory |
| `OMR_MAX_CONCURRENT` | `1` | Concurrent Audiveris processes |
| `OMR_TEMP_DIR` | OS temp directory | Upload/output working directory |
| `AUDIVERIS_BIN` | auto-detected | Audiveris executable or wrapper |
| `AUDIVERIS_VERSION` | `5.11.0` | Reported by `/api/health` |

## API

### `POST /api/omr/jobs`

Send the raw PDF as the request body.

```http
Content-Type: application/pdf
X-File-Name: hymn.pdf
```

Returns `202` with a job object. The filename header must be URI-encoded when it
contains non-ASCII characters.

### `GET /api/omr/jobs/:id`

Returns job status, stage, progress, warnings, summary, and any error. Stages:

- `queued`
- `preparing`
- `recognizing`
- `generating`
- `validating`
- `complete`
- `failed`

### `GET /api/omr/jobs/:id/musicxml`

Downloads the validated MusicXML after completion. Returns `409` before the job
is complete.

### `DELETE /api/omr/jobs/:id`

Deletes a finished or failed job. Active jobs return `409`.

### `GET /api/health`

Reports the configured Audiveris executable and upload/timeout limits.

## Deployment notes

- Put the service behind HTTPS and a reverse proxy with a request timeout of at
  least the job timeout.
- Keep `OMR_MAX_CONCURRENT=1` on small servers. Audiveris is CPU and memory
  hungry.
- This service has no user authentication. Add a proxy-level rate limit and a
  request-size cap before exposing it publicly, otherwise any client that can
  reach the URL can consume CPU and memory.
- Do not put API keys in the frontend. This service has no keys; it only runs a
  local executable.
- Uploads and outputs are deleted after each job. Job metadata remains in memory
  for `OMR_JOB_TTL_MS`.
- An in-memory job store is intentional for this single-instance service. If you
  run multiple replicas, add shared storage and sticky job routing first.

## Audiveris licence

Audiveris is licensed under **AGPL V3**. This repository invokes the installed
Audiveris binary as a separate process; it does not copy Audiveris source or
link it into the frontend. If you modify Audiveris or distribute a Docker image
containing it, comply with the AGPL, including providing the corresponding
source and licence notices. The Dockerfile downloads the unmodified official
release from the Audiveris GitHub project:

<https://github.com/Audiveris/audiveris>

## Tests

Backend tests run with the repository test command:

```sh
npm test
```

They use a fake Audiveris runner; they do not require Java or a real PDF.
The service has also been smoke-tested against Audiveris 5.11.0 on Windows with
single- and multi-page PDFs, including the full frontend upload, progress, and
MusicXML download flow.
