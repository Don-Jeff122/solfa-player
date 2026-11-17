import os from 'node:os'

const DEFAULT_ORIGINS = [
  'https://don-jeff122.github.io',
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://127.0.0.1:4173',
  'http://localhost:4173',
]

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function origins(value) {
  if (!value) return DEFAULT_ORIGINS
  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export function loadConfig(env = process.env) {
  return {
    port: positiveInt(env.PORT, 8788),
    host: env.HOST || '0.0.0.0',
    allowedOrigins: origins(env.OMR_ALLOWED_ORIGINS),
    maxUploadBytes: positiveInt(env.OMR_MAX_UPLOAD_BYTES, 25 * 1024 * 1024),
    jobTimeoutMs: positiveInt(env.OMR_JOB_TIMEOUT_MS, 10 * 60 * 1000),
    jobTtlMs: positiveInt(env.OMR_JOB_TTL_MS, 60 * 60 * 1000),
    maxConcurrent: positiveInt(env.OMR_MAX_CONCURRENT, 1),
    maxPending: positiveInt(env.OMR_MAX_PENDING, 4),
    maxJobs: positiveInt(env.OMR_MAX_JOBS, 50),
    uploadsPerWindow: positiveInt(env.OMR_UPLOADS_PER_WINDOW, 10),
    uploadWindowMs: positiveInt(env.OMR_UPLOAD_WINDOW_MS, 60 * 60 * 1000),
    tempRoot: env.OMR_TEMP_DIR || os.tmpdir(),
    audiverisBin: env.AUDIVERIS_BIN || '',
    audiverisVersion: env.AUDIVERIS_VERSION || '5.11.0',
  }
}
