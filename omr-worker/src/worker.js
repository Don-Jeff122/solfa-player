const PDF_MAGIC = '%PDF-'
const DEFAULT_MAX_PDF_BYTES = 25 * 1024 * 1024
const DEFAULT_MAX_RESULT_BYTES = 64 * 1024 * 1024
const DEFAULT_CHUNK_BYTES = 2 * 1024 * 1024
const DEFAULT_MAX_UPLOADS_PER_HOUR = 4
const DEFAULT_MAX_UPLOADS_PER_DAY = 8
const DEFAULT_MAX_ACTIVE_JOBS = 2
const DEFAULT_JOB_TTL_SECONDS = 2 * 60 * 60
const DEFAULT_ORIGINS = [
  'https://don-jeff122.github.io',
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://127.0.0.1:4173',
  'http://localhost:4173',
]
const PDF_TYPES = new Set(['application/pdf', 'application/x-pdf', 'application/octet-stream'])
const FINAL_STATUSES = new Set(['complete', 'failed'])
const FINAL_SEQ = 9999

function positiveInt(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback
}

function parseOrigins(value) {
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  }
  return DEFAULT_ORIGINS
}

function workerConfig(env) {
  return {
    maxPdfBytes: positiveInt(env.MAX_PDF_BYTES, DEFAULT_MAX_PDF_BYTES),
    maxResultBytes: positiveInt(env.MAX_RESULT_BYTES, DEFAULT_MAX_RESULT_BYTES),
    chunkBytes: positiveInt(env.CHUNK_BYTES, DEFAULT_CHUNK_BYTES),
    maxUploadsPerHour: positiveInt(env.MAX_UPLOADS_PER_HOUR, DEFAULT_MAX_UPLOADS_PER_HOUR),
    maxUploadsPerDay: positiveInt(env.MAX_UPLOADS_PER_DAY, DEFAULT_MAX_UPLOADS_PER_DAY),
    maxActiveJobs: positiveInt(env.MAX_ACTIVE_JOBS, DEFAULT_MAX_ACTIVE_JOBS),
    jobTtlSeconds: Math.max(60, positiveInt(env.JOB_TTL_SECONDS, DEFAULT_JOB_TTL_SECONDS)),
    allowedOrigins: parseOrigins(env.ALLOWED_ORIGINS),
  }
}

function corsHeaders(origin) {
  if (!origin) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-File-Name',
    'Access-Control-Expose-Headers': 'Content-Disposition',
    'Access-Control-Max-Age': '600',
  }
}

function jsonResponse(body, status, cors = {}, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...cors,
      ...extra,
    },
  })
}

function errorResponse(status, code, message, cors = {}, extra = {}) {
  return jsonResponse(
    {
      error: {
        code,
        message,
        detail: '',
        retryable: status === 429 || status >= 500,
        validation: null,
      },
    },
    status,
    cors,
    extra
  )
}

function noContent(cors = {}) {
  return new Response(null, { status: 204, headers: { ...cors } })
}

function toArrayBuffer(value) {
  if (value instanceof ArrayBuffer) return value
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
  }
  if (Array.isArray(value)) return new Uint8Array(value).buffer
  return new TextEncoder().encode(String(value ?? '')).buffer
}

function fromArrayBuffer(value) {
  return new TextDecoder().decode(toArrayBuffer(value))
}

function prefixUpperBound(prefix) {
  if (!prefix) return '\uffff'
  return prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1)
}

class D1Storage {
  constructor(db) {
    this.db = db
  }

  async get(key, type) {
    const result = await this.db
      .prepare(
        'SELECT value FROM kv_store WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)'
      )
      .bind(key, Date.now())
      .all()
    const value = result.results?.[0]?.value
    if (value === undefined || value === null) return null
    if (type === 'arrayBuffer') return toArrayBuffer(value)
    const text = typeof value === 'string' ? value : fromArrayBuffer(value)
    if (type === 'json') return JSON.parse(text)
    return text
  }

  putStatement(key, value, options = {}) {
    const expiresAt = Number(options.expirationTtl)
      ? Date.now() + Math.floor(Number(options.expirationTtl)) * 1000
      : null
    const stored = value instanceof ArrayBuffer || ArrayBuffer.isView(value)
      ? toArrayBuffer(value)
      : String(value)
    return this.db
      .prepare('INSERT OR REPLACE INTO kv_store (key, value, expires_at) VALUES (?, ?, ?)')
      .bind(key, stored, expiresAt)
  }

  async put(key, value, options = {}) {
    await this.putStatement(key, value, options).run()
  }

  async putMany(entries) {
    if (!entries.length) return
    await this.db.batch(entries.map(([key, value, options]) => this.putStatement(key, value, options)))
  }

  async list({ prefix = '', cursor, limit } = {}) {
    const size = Math.min(Math.max(Number(limit) || 1000, 1), 1000)
    const offset = Math.max(Number(cursor) || 0, 0)
    const result = await this.db
      .prepare(
        'SELECT key FROM kv_store WHERE key >= ? AND key < ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY key LIMIT ? OFFSET ?'
      )
      .bind(prefix, prefixUpperBound(prefix), Date.now(), size, offset)
      .all()
    const keys = (result.results || []).map((row) => ({ name: row.key }))
    return {
      keys,
      list_complete: keys.length < size,
      cursor: keys.length < size ? undefined : String(offset + size),
    }
  }

  async delete(key) {
    await this.db.prepare('DELETE FROM kv_store WHERE key = ?').bind(key).run()
  }

  async deletePrefix(prefix) {
    await this.db
      .prepare('DELETE FROM kv_store WHERE key >= ? AND key < ?')
      .bind(prefix, prefixUpperBound(prefix))
      .run()
  }
}

export function storageFor(env) {
  if (env.STORAGE_BACKEND === 'd1') return env.OMR_DB ? new D1Storage(env.OMR_DB) : null
  return env.OMR_KV || null
}

function padSeq(seq) {
  return String(seq).padStart(4, '0')
}

function clampProgress(value, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(0, Math.min(100, Math.round(number)))
}

function isFinalStatus(status) {
  return Boolean(status && FINAL_STATUSES.has(status.status))
}

function safeFileName(raw) {
  let value = String(raw || 'score.pdf')
  try {
    value = decodeURIComponent(value)
  } catch {
    value = String(raw || 'score.pdf')
  }
  const cleaned = [...value]
    .map((character) =>
      character.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(character) ? '_' : character
    )
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(-140)
  return cleaned || 'score.pdf'
}

function downloadName(fileName) {
  const base = safeFileName(fileName).replace(/\.pdf$/i, '')
  return `${base || 'score'}.musicxml`
}

function contentDisposition(fileName) {
  const name = downloadName(fileName)
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

function jobIdFrom(match) {
  if (!match?.[1]) return null
  let id = match[1]
  try {
    id = decodeURIComponent(id)
  } catch {
    return null
  }
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null
}

async function sha256Bytes(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)))
  return new Uint8Array(digest)
}

async function sha256Hex(value) {
  const bytes = await sha256Bytes(value)
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function constantTimeEqual(left, right) {
  if (left.byteLength !== right.byteLength) return false
  let difference = 0
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index] ^ right[index]
  }
  return difference === 0
}

async function isAuthorized(request, secret) {
  if (typeof secret !== 'string' || !secret) return false
  const header = (request.headers.get('Authorization') || '').trim()
  const match = /^Bearer\s+(\S+)$/i.exec(header)
  if (!match) return false
  const [provided, expected] = await Promise.all([sha256Bytes(match[1]), sha256Bytes(secret)])
  return constantTimeEqual(provided, expected)
}

function clientIp(request) {
  const connecting = request.headers.get('CF-Connecting-IP')
  if (connecting?.trim()) return connecting.trim()
  const forwarded = request.headers.get('X-Forwarded-For')
  if (forwarded?.trim()) return forwarded.split(',')[0].trim()
  return request.headers.get('X-Real-IP')?.trim() || 'unknown'
}

function utcDayKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10).replaceAll('-', '')
}

async function readBodyWithLimit(request, maxBytes) {
  const declared = Number(request.headers.get('Content-Length') || 0)
  if (Number.isFinite(declared) && declared > maxBytes) return { tooLarge: true, bytes: null }
  if (!request.body) return { tooLarge: false, bytes: new Uint8Array(0) }
  const reader = request.body.getReader()
  const parts = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        return { tooLarge: true, bytes: null }
      }
      parts.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const result = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.byteLength
  }
  return { tooLarge: false, bytes: result }
}

function hasPdfMagic(bytes) {
  if (!bytes || bytes.byteLength < PDF_MAGIC.length) return false
  return new TextDecoder().decode(bytes.slice(0, PDF_MAGIC.length)) === PDF_MAGIC
}

function hasXmlStart(bytes) {
  if (!bytes || !bytes.byteLength) return false
  let offset = 0
  while (offset < bytes.byteLength && bytes[offset] <= 32) offset += 1
  return bytes[offset] === 0x3c
}

async function listAll(kv, prefix) {
  const keys = []
  let cursor = null
  for (;;) {
    const page = await kv.list(cursor ? { prefix, cursor } : { prefix })
    for (const entry of page.keys || []) keys.push(entry.name)
    if (page.list_complete || !page.cursor || page.cursor === cursor) break
    cursor = page.cursor
  }
  return keys.sort()
}

async function getLatestStatus(kv, id) {
  const keys = await listAll(kv, `job:${id}:status:`)
  if (!keys.length) return null
  return (await kv.get(keys[keys.length - 1], 'json')) || null
}

function publicJob(meta, status) {
  const state = status || {}
  return {
    id: meta.id,
    status: state.status || 'queued',
    stage: state.stage || 'queued',
    progress: clampProgress(state.progress, 0),
    message: state.message || 'Queued for conversion',
    detail: state.detail || '',
    fileName: meta.fileName,
    fileSize: meta.fileSize,
    createdAt: meta.createdAt,
    updatedAt: state.updatedAt || meta.updatedAt || meta.createdAt,
    summary: state.summary ?? null,
    warnings: Array.isArray(state.warnings) ? state.warnings : [],
    error: state.error ?? null,
    failedStage: state.failedStage ?? null,
  }
}

async function writeChunks(kv, prefix, bytes, chunkBytes, ttlSeconds) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const options = ttlSeconds ? { expirationTtl: ttlSeconds } : undefined
  const entries = []
  for (let offset = 0; offset < data.byteLength; offset += chunkBytes) {
    const end = Math.min(offset + chunkBytes, data.byteLength)
    entries.push([`${prefix}:${padSeq(entries.length)}`, data.slice(offset, end), options])
  }
  if (typeof kv.putMany === 'function') {
    await kv.putMany(entries)
  } else {
    for (const [key, value, valueOptions] of entries) {
      await kv.put(key, value, valueOptions)
    }
  }
  return entries.length
}

async function readChunks(kv, prefix) {
  const keys = await listAll(kv, `${prefix}:`)
  if (!keys.length) return new Uint8Array(0)
  const parts = await Promise.all(keys.map((key) => kv.get(key, 'arrayBuffer')))
  let total = 0
  for (const part of parts) {
    if (part) total += part.byteLength
  }
  const result = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    if (!part) continue
    result.set(new Uint8Array(part), offset)
    offset += part.byteLength
  }
  return result
}

async function deleteKeysWithPrefix(kv, prefix) {
  if (typeof kv.deletePrefix === 'function') {
    await kv.deletePrefix(prefix)
    return
  }
  const keys = await listAll(kv, prefix)
  await Promise.all(keys.map((key) => kv.delete(key)))
}

async function deleteDataChunks(kv, id) {
  await Promise.all([
    deleteKeysWithPrefix(kv, `job:${id}:input:`),
    deleteKeysWithPrefix(kv, `job:${id}:result:`),
  ])
}

async function deleteJob(kv, id) {
  await Promise.all([
    kv.delete(`meta:${id}`),
    kv.delete(`active:${id}`),
    deleteKeysWithPrefix(kv, `job:${id}:`),
  ])
}

function decodeBase64UrlJson(raw) {
  if (typeof raw !== 'string' || !raw) return null
  try {
    let encoded = raw.replace(/-/g, '+').replace(/_/g, '/')
    while (encoded.length % 4) encoded += '='
    const binary = atob(encoded)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
}

async function dispatchWorkflow(request, env, id, fileName) {
  const fetchImpl = env.FETCH_IMPL || globalThis.fetch
  const { GITHUB_REPOSITORY, GITHUB_WORKFLOW, GITHUB_REF, GITHUB_TOKEN } = env
  if (typeof fetchImpl !== 'function') return false
  if (!GITHUB_REPOSITORY || !GITHUB_WORKFLOW || !GITHUB_REF || !GITHUB_TOKEN) return false
  const url = `https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/workflows/${GITHUB_WORKFLOW}/dispatches`
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'solfa-omr-worker',
    },
    body: JSON.stringify({
      ref: GITHUB_REF,
      inputs: {
        job_id: id,
        worker_url: new URL(request.url).origin,
        file_name: fileName,
      },
    }),
  })
  return Boolean(response?.ok)
}

async function markDispatchFailure(kv, id, ttlSeconds) {
  await kv.put(
    `job:${id}:status:${FINAL_SEQ}`,
    JSON.stringify({
      seq: FINAL_SEQ,
      status: 'failed',
      stage: 'failed',
      progress: 0,
      message: 'The conversion could not be started.',
      detail: '',
      summary: null,
      warnings: [],
      error: {
        code: 'DISPATCH_FAILED',
        message: 'The conversion could not be started.',
        detail: '',
        retryable: true,
        validation: null,
      },
      failedStage: 'queued',
      updatedAt: Date.now(),
    }),
    { expirationTtl: ttlSeconds }
  )
  await kv.delete(`active:${id}`)
  await deleteDataChunks(kv, id)
}

async function handleHealth(cors) {
  return jsonResponse({ ok: true, service: 'solfa-omr-worker' }, 200, cors)
}

async function handleUpload(request, env, cfg, cors) {
  const kv = storageFor(env)
  const contentType = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase()
  if (contentType && !PDF_TYPES.has(contentType)) {
    return errorResponse(415, 'UNSUPPORTED_FILE', 'Upload a PDF file.', cors)
  }
  const declared = Number(request.headers.get('Content-Length') || 0)
  if (Number.isFinite(declared) && declared > cfg.maxPdfBytes) {
    return errorResponse(413, 'UPLOAD_TOO_LARGE', 'The PDF is too large.', cors)
  }

  const now = Date.now()
  const ipHash = await sha256Hex(clientIp(request))
  const hour = Math.floor(now / 3_600_000)
  const ratePrefix = `rate:${ipHash}:${hour}:`
  const dayPrefix = `day:${utcDayKey(now)}:`
  const [rateKeys, dayKeys, activeKeys] = await Promise.all([
    listAll(kv, ratePrefix),
    listAll(kv, dayPrefix),
    listAll(kv, 'active:'),
  ])
  if (rateKeys.length >= cfg.maxUploadsPerHour) {
    return errorResponse(429, 'RATE_LIMITED', 'Too many PDF uploads. Try again later.', cors, {
      'Retry-After': '3600',
    })
  }
  if (dayKeys.length >= cfg.maxUploadsPerDay) {
    return errorResponse(429, 'DAILY_LIMIT_REACHED', 'Today’s free OMR quota has been used.', cors, {
      'Retry-After': '86400',
    })
  }
  if (activeKeys.length >= cfg.maxActiveJobs) {
    return errorResponse(429, 'QUEUE_FULL', 'The OMR queue is full. Try again shortly.', cors, {
      'Retry-After': '60',
    })
  }

  const body = await readBodyWithLimit(request, cfg.maxPdfBytes)
  if (body.tooLarge) {
    return errorResponse(413, 'UPLOAD_TOO_LARGE', 'The PDF is too large.', cors)
  }
  if (!hasPdfMagic(body.bytes)) {
    return errorResponse(415, 'NOT_A_PDF', 'Choose a valid PDF file.', cors)
  }

  const id = crypto.randomUUID()
  const meta = {
    id,
    fileName: safeFileName(request.headers.get('X-File-Name')),
    fileSize: body.bytes.byteLength,
    createdAt: now,
    updatedAt: now,
  }
  const initial = {
    seq: 0,
    status: 'queued',
    stage: 'queued',
    progress: 0,
    message: 'Queued for conversion',
    detail: '',
    summary: null,
    warnings: [],
    error: null,
    failedStage: null,
    updatedAt: now,
  }

  const dataTtl = cfg.jobTtlSeconds + 300
  await kv.put(`meta:${id}`, JSON.stringify(meta), { expirationTtl: cfg.jobTtlSeconds })
  await writeChunks(kv, `job:${id}:input`, body.bytes, cfg.chunkBytes, dataTtl)
  await kv.put(`job:${id}:status:0000`, JSON.stringify(initial), {
    expirationTtl: cfg.jobTtlSeconds,
  })
  await kv.put(`active:${id}`, JSON.stringify({ id, createdAt: now }), {
    expirationTtl: cfg.jobTtlSeconds,
  })
  const rateTtl = Math.max(1, Math.ceil((3_600_000 - (now % 3_600_000)) / 1000))
  await kv.put(`${ratePrefix}${crypto.randomUUID()}`, '1', { expirationTtl: rateTtl })
  await kv.put(`${dayPrefix}${crypto.randomUUID()}`, '1', { expirationTtl: 2 * 24 * 60 * 60 })

  let dispatched = false
  try {
    dispatched = await dispatchWorkflow(request, env, id, meta.fileName)
  } catch {
    dispatched = false
  }
  if (!dispatched) {
    await markDispatchFailure(kv, id, cfg.jobTtlSeconds)
    return errorResponse(503, 'DISPATCH_FAILED', 'The conversion could not be started.', cors)
  }

  return jsonResponse(publicJob(meta, initial), 202, cors)
}

async function handleGetJob(kv, id, cors) {
  const meta = await kv.get(`meta:${id}`, 'json')
  if (!meta) {
    return errorResponse(404, 'JOB_NOT_FOUND', 'This OMR job no longer exists.', cors)
  }
  const status = await getLatestStatus(kv, id)
  return jsonResponse(publicJob(meta, status), 200, cors)
}

async function handleDownload(kv, id, cors) {
  const meta = await kv.get(`meta:${id}`, 'json')
  if (!meta) {
    return errorResponse(404, 'JOB_NOT_FOUND', 'This OMR job no longer exists.', cors)
  }
  const status = await getLatestStatus(kv, id)
  if (status?.status !== 'complete') {
    return errorResponse(409, 'JOB_NOT_READY', 'The MusicXML file is not ready yet.', cors)
  }
  const bytes = await readChunks(kv, `job:${id}:result`)
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.recordare.musicxml+xml; charset=utf-8',
      'Content-Disposition': contentDisposition(meta.fileName),
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...cors,
    },
  })
}

async function handleDelete(kv, id, cors) {
  const meta = await kv.get(`meta:${id}`, 'json')
  if (!meta) {
    return errorResponse(404, 'JOB_NOT_FOUND', 'This OMR job no longer exists.', cors)
  }
  const status = await getLatestStatus(kv, id)
  if (status?.status === 'queued' || status?.status === 'running') {
    return errorResponse(409, 'JOB_ACTIVE', 'This OMR job is still running.', cors)
  }
  await deleteJob(kv, id)
  return noContent(cors)
}

async function handleInternalInput(kv, id) {
  const meta = await kv.get(`meta:${id}`, 'json')
  if (!meta) {
    return errorResponse(404, 'JOB_NOT_FOUND', 'This OMR job no longer exists.')
  }
  const bytes = await readChunks(kv, `job:${id}:input`)
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'no-store',
    },
  })
}

async function handleInternalProgress(kv, id, request, cfg) {
  let body
  try {
    body = await request.json()
  } catch {
    return errorResponse(400, 'INVALID_JSON', 'Send a JSON body.')
  }
  const seq = Number(body?.seq)
  if (!Number.isInteger(seq) || seq < 2 || seq > 98) {
    return errorResponse(400, 'INVALID_SEQ', 'seq must be an integer between 2 and 98.')
  }
  const meta = await kv.get(`meta:${id}`, 'json')
  if (!meta) return noContent()
  const latest = await getLatestStatus(kv, id)
  if (isFinalStatus(latest) && Number(latest.seq ?? FINAL_SEQ) >= seq) return noContent()

  await kv.put(
    `job:${id}:status:${padSeq(seq)}`,
    JSON.stringify({
      seq,
      status: typeof body.status === 'string' && body.status ? body.status : 'running',
      stage: typeof body.stage === 'string' ? body.stage : 'processing',
      progress: clampProgress(body.progress, 0),
      message: typeof body.message === 'string' ? body.message : '',
      detail: typeof body.detail === 'string' ? body.detail : '',
      summary: body.summary ?? null,
      warnings: Array.isArray(body.warnings) ? body.warnings : [],
      updatedAt: Date.now(),
    }),
    { expirationTtl: cfg.jobTtlSeconds }
  )
  return noContent()
}

async function handleInternalResult(kv, id, request, cfg) {
  const meta = await kv.get(`meta:${id}`, 'json')
  if (!meta) return noContent()
  const latest = await getLatestStatus(kv, id)
  if (isFinalStatus(latest)) return noContent()

  const body = await readBodyWithLimit(request, cfg.maxResultBytes)
  if (body.tooLarge) {
    return errorResponse(413, 'RESULT_TOO_LARGE', 'The MusicXML result is too large.')
  }
  if (!hasXmlStart(body.bytes)) {
    return errorResponse(400, 'INVALID_MUSICXML', 'The MusicXML result must be XML.')
  }
  const summary = decodeBase64UrlJson(request.headers.get('X-OMR-Summary'))
  const warnings = decodeBase64UrlJson(request.headers.get('X-OMR-Warnings'))

  await deleteKeysWithPrefix(kv, `job:${id}:result:`)
  await writeChunks(kv, `job:${id}:result`, body.bytes, cfg.chunkBytes, cfg.jobTtlSeconds + 300)
  await kv.put(
    `job:${id}:status:${FINAL_SEQ}`,
    JSON.stringify({
      seq: FINAL_SEQ,
      status: 'complete',
      stage: 'complete',
      progress: 100,
      message: 'MusicXML ready',
      detail: '',
      summary: summary ?? null,
      warnings: Array.isArray(warnings) ? warnings : [],
      updatedAt: Date.now(),
    }),
    { expirationTtl: cfg.jobTtlSeconds }
  )
  await kv.delete(`active:${id}`)
  return noContent()
}

async function handleInternalFailure(kv, id, request, cfg) {
  const meta = await kv.get(`meta:${id}`, 'json')
  if (!meta) return noContent()
  const latest = await getLatestStatus(kv, id)
  if (isFinalStatus(latest)) return noContent()
  let body
  try {
    body = await request.json()
  } catch {
    return errorResponse(400, 'INVALID_JSON', 'Send a JSON body.')
  }

  const message =
    typeof body?.message === 'string' && body.message
      ? body.message
      : 'The PDF could not be converted.'
  const detail = typeof body?.detail === 'string' ? body.detail : ''
  await kv.put(
    `job:${id}:status:${FINAL_SEQ}`,
    JSON.stringify({
      seq: FINAL_SEQ,
      status: 'failed',
      stage: 'failed',
      progress: clampProgress(latest?.progress, 0),
      message,
      detail,
      summary: null,
      warnings: [],
      error: {
        code: typeof body?.code === 'string' && body.code ? body.code : 'OMR_FAILED',
        message,
        detail,
        retryable: true,
        validation: body?.validation ?? null,
      },
      failedStage: latest?.stage && latest.stage !== 'queued' ? latest.stage : 'preparing',
      updatedAt: Date.now(),
    }),
    { expirationTtl: cfg.jobTtlSeconds }
  )
  await kv.delete(`active:${id}`)
  return noContent()
}

export async function fetch(request, env = {}, _ctx) {
  const url = new URL(request.url)
  const path = url.pathname
  const cfg = workerConfig(env)

  if (path.startsWith('/internal/') && request.method !== 'OPTIONS') {
    if (!(await isAuthorized(request, env.OMR_INTERNAL_SECRET))) {
      return errorResponse(401, 'UNAUTHORIZED', 'Invalid internal credentials.')
    }
    const kv = storageFor(env)
    if (!kv) {
      return errorResponse(500, 'NOT_CONFIGURED', 'The OMR worker is not configured.')
    }
    const inputId = jobIdFrom(path.match(/^\/internal\/jobs\/([^/]+)\/input$/))
    if (inputId && request.method === 'GET') return handleInternalInput(kv, inputId)
    const progressId = jobIdFrom(path.match(/^\/internal\/jobs\/([^/]+)\/progress$/))
    if (progressId && request.method === 'POST') {
      return handleInternalProgress(kv, progressId, request, cfg)
    }
    const resultId = jobIdFrom(path.match(/^\/internal\/jobs\/([^/]+)\/result$/))
    if (resultId && request.method === 'POST') {
      return handleInternalResult(kv, resultId, request, cfg)
    }
    const failureId = jobIdFrom(path.match(/^\/internal\/jobs\/([^/]+)\/failure$/))
    if (failureId && request.method === 'POST') {
      return handleInternalFailure(kv, failureId, request, cfg)
    }
    return errorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.')
  }

  const origin = request.headers.get('Origin') || ''
  if (origin && !cfg.allowedOrigins.includes(origin)) {
    return errorResponse(403, 'ORIGIN_NOT_ALLOWED', 'This origin is not allowed to use the OMR worker.')
  }
  const cors = corsHeaders(origin)

  if (request.method === 'OPTIONS') return noContent(cors)
  if (request.method === 'GET' && path === '/api/health') return handleHealth(cors)
  const kv = storageFor(env)
  if (!kv) {
    return errorResponse(500, 'NOT_CONFIGURED', 'The OMR worker is not configured.', cors)
  }
  if (request.method === 'POST' && path === '/api/omr/jobs') {
    return handleUpload(request, env, cfg, cors)
  }
  const downloadId = jobIdFrom(path.match(/^\/api\/omr\/jobs\/([^/]+)\/musicxml$/))
  if (downloadId && request.method === 'GET') return handleDownload(kv, downloadId, cors)
  const jobId = jobIdFrom(path.match(/^\/api\/omr\/jobs\/([^/]+)$/))
  if (jobId && request.method === 'GET') return handleGetJob(kv, jobId, cors)
  if (jobId && request.method === 'DELETE') return handleDelete(kv, jobId, cors)
  return errorResponse(404, 'NOT_FOUND', 'Unknown endpoint.', cors)
}

export async function scheduled(_controller, env = {}, _ctx) {
  const kv = storageFor(env)
  if (!kv) return
  const ttlMs = positiveInt(env.JOB_TTL_SECONDS, DEFAULT_JOB_TTL_SECONDS) * 1000
  const now = Date.now()
  const metas = await listAll(kv, 'meta:')
  let deleted = 0
  for (const key of metas) {
    if (deleted >= 10) break
    const meta = await kv.get(key, 'json')
    if (!meta) continue
    const updatedAt = Number(meta.updatedAt ?? meta.createdAt)
    if (!Number.isFinite(updatedAt) || now - updatedAt <= ttlMs) continue
    await deleteJob(kv, String(meta.id || key.slice(5)))
    deleted += 1
  }
}

export default { fetch, scheduled }
