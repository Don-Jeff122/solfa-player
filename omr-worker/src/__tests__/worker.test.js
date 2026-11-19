import { describe, expect, it } from 'vitest'
import { fetch as workerFetch, scheduled } from '../worker.js'

const ORIGIN = 'https://don-jeff122.github.io'
const SECRET = 'internal-test-secret'
const PDF = new TextEncoder().encode('%PDF-1.4\nhymnal page\n%%EOF')
const XML =
  '<?xml version="1.0" encoding="utf-8"?><score-partwise version="4.0"><part-list/><part id="P1"/></score-partwise>'

class MemoryKV {
  constructor() {
    this.store = new Map()
    this.expirations = new Map()
  }

  toBytes(value) {
    if (value instanceof Uint8Array) return value
    if (value instanceof ArrayBuffer) return new Uint8Array(value)
    return new TextEncoder().encode(String(value))
  }

  async get(key, type) {
    if (!this.store.has(key)) return null
    const value = this.store.get(key)
    if (type === 'json') return JSON.parse(new TextDecoder().decode(this.toBytes(value)))
    if (type === 'arrayBuffer') {
      const bytes = this.toBytes(value)
      return bytes.slice().buffer
    }
    if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
      return new TextDecoder().decode(this.toBytes(value))
    }
    return value
  }

  async put(key, value, options = {}) {
    this.store.set(key, value instanceof ArrayBuffer ? new Uint8Array(value) : value)
    if (options.expirationTtl) {
      this.expirations.set(key, Date.now() + options.expirationTtl * 1000)
    }
  }

  async list({ prefix = '', cursor, limit } = {}) {
    const names = [...this.store.keys()].filter((key) => key.startsWith(prefix)).sort()
    const start = cursor ? Number(cursor) : 0
    const end = limit ? Math.min(start + limit, names.length) : names.length
    const complete = end >= names.length
    return {
      keys: names.slice(start, end).map((name) => ({ name })),
      list_complete: complete,
      cursor: complete ? undefined : String(end),
    }
  }

  async delete(key) {
    this.store.delete(key)
    this.expirations.delete(key)
  }
}

function makeEnv(kv, extra = {}) {
  return {
    OMR_KV: kv,
    OMR_INTERNAL_SECRET: SECRET,
    GITHUB_REPOSITORY: 'don-jeff122/solfa-player',
    GITHUB_WORKFLOW: 'omr-conversion.yml',
    GITHUB_REF: 'main',
    GITHUB_TOKEN: 'ghp_test',
    ALLOWED_ORIGINS: ORIGIN,
    MAX_PDF_BYTES: '1024',
    MAX_RESULT_BYTES: '1024',
    CHUNK_BYTES: '8',
      MAX_UPLOADS_PER_HOUR: '5',
      MAX_UPLOADS_PER_DAY: '8',
      MAX_ACTIVE_JOBS: '3',
    JOB_TTL_SECONDS: '60',
    ...extra,
  }
}

function publicRequest(path, init = {}) {
  const { headers, ...rest } = init
  return new Request(`https://omr.test${path}`, {
    ...rest,
    headers: { Origin: ORIGIN, ...headers },
  })
}

function internalRequest(path, { method = 'GET', body, headers = {}, token = SECRET } = {}) {
  return new Request(`https://omr.test${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...headers },
    body,
  })
}

function createFetchStub() {
  const calls = []
  const impl = async (url, init) => {
    calls.push({ url, init })
    return new Response(null, { status: 204 })
  }
  return { calls, impl }
}

async function readAllChunks(kv, prefix) {
  const page = await kv.list({ prefix: `${prefix}:` })
  const parts = await Promise.all(page.keys.map((entry) => kv.get(entry.name, 'arrayBuffer')))
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    bytes.set(new Uint8Array(part), offset)
    offset += part.byteLength
  }
  return bytes
}

function encodeBase64UrlJson(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function createJob(env) {
  const response = await workerFetch(
    publicRequest('/api/omr/jobs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/pdf',
        'X-File-Name': encodeURIComponent('my score.PDF'),
      },
      body: PDF,
    }),
    env
  )
  expect(response.status).toBe(202)
  return response.json()
}

describe('OMR worker public endpoints', () => {
  it('answers health for allowed, missing, and disallowed origins', async () => {
    const kv = new MemoryKV()
    const env = makeEnv(kv)

    const response = await workerFetch(publicRequest('/api/health'), env)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, service: 'solfa-omr-worker' })
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)

    const direct = await workerFetch(new Request('https://omr.test/api/health'), env)
    expect(direct.status).toBe(200)
    expect(direct.headers.get('Access-Control-Allow-Origin')).toBeNull()

    const rejected = await workerFetch(
      new Request('https://omr.test/api/health', { headers: { Origin: 'https://evil.test' } }),
      env
    )
    expect(rejected.status).toBe(403)
    expect(rejected.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('answers CORS preflight for any path', async () => {
    const response = await workerFetch(
      publicRequest('/api/omr/jobs', { method: 'OPTIONS' }),
      makeEnv(new MemoryKV())
    )
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('X-File-Name')
  })

  it('stores PDF chunks and metadata, dispatches the workflow and returns 202', async () => {
    const kv = new MemoryKV()
    const stub = createFetchStub()
    const env = makeEnv(kv, { FETCH_IMPL: stub.impl })

    const response = await workerFetch(
      publicRequest('/api/omr/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/pdf',
          'X-File-Name': encodeURIComponent('my score.PDF'),
        },
        body: PDF,
      }),
      env
    )
    expect(response.status).toBe(202)
    const job = await response.json()
    expect(job).toMatchObject({
      id: expect.any(String),
      status: 'queued',
      stage: 'queued',
      progress: 0,
      fileName: 'my score.PDF',
      fileSize: PDF.byteLength,
      summary: null,
      warnings: [],
      error: null,
      failedStage: null,
    })
    expect(job.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(Number.isFinite(job.createdAt)).toBe(true)

    expect(await kv.get(`meta:${job.id}`, 'json')).toMatchObject({
      id: job.id,
      fileName: 'my score.PDF',
      fileSize: PDF.byteLength,
    })
    const statusKeys = await kv.list({ prefix: `job:${job.id}:status:` })
    expect(statusKeys.keys.map((entry) => entry.name)).toContain(`job:${job.id}:status:0000`)
    const inputKeys = await kv.list({ prefix: `job:${job.id}:input:` })
    expect(inputKeys.keys.length).toBeGreaterThan(1)
    expect(await kv.get(`active:${job.id}`, 'json')).toMatchObject({ id: job.id })
    expect(new TextDecoder().decode(await readAllChunks(kv, `job:${job.id}:input`))).toBe(
      new TextDecoder().decode(PDF)
    )
    expect((await kv.list({ prefix: 'rate:' })).keys).toHaveLength(1)
    expect((await kv.list({ prefix: 'day:' })).keys).toHaveLength(1)

    expect(stub.calls).toHaveLength(1)
    expect(stub.calls[0].url).toBe(
      'https://api.github.com/repos/don-jeff122/solfa-player/actions/workflows/omr-conversion.yml/dispatches'
    )
    expect(JSON.parse(stub.calls[0].init.body)).toEqual({
      ref: 'main',
      inputs: {
        job_id: job.id,
        worker_url: 'https://omr.test',
        file_name: 'my score.PDF',
      },
    })
    expect(stub.calls[0].init.headers.Authorization).toBe('Bearer ghp_test')
  })

  it('rejects a payload without the PDF magic and does not dispatch', async () => {
    const kv = new MemoryKV()
    const stub = createFetchStub()
    const response = await workerFetch(
      publicRequest('/api/omr/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/pdf' },
        body: new TextEncoder().encode('not a pdf'),
      }),
      makeEnv(kv, { FETCH_IMPL: stub.impl })
    )
    expect(response.status).toBe(415)
    expect((await response.json()).error.code).toBe('NOT_A_PDF')
    expect(stub.calls).toHaveLength(0)
    expect((await kv.list({ prefix: 'meta:' })).keys).toHaveLength(0)
  })

  it('enforces the global daily upload cap', async () => {
    const kv = new MemoryKV()
    const stub = createFetchStub()
    const env = makeEnv(kv, { FETCH_IMPL: stub.impl, MAX_UPLOADS_PER_DAY: '1' })
    await createJob(env)

    const rejected = await workerFetch(
      publicRequest('/api/omr/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/pdf' },
        body: PDF,
      }),
      env
    )
    expect(rejected.status).toBe(429)
    expect((await rejected.json()).error.code).toBe('DAILY_LIMIT_REACHED')
    expect(stub.calls).toHaveLength(1)
  })

  it('records failed status and releases the job when dispatch fails', async () => {
    const kv = new MemoryKV()
    const env = makeEnv(kv, {
      FETCH_IMPL: async () => new Response(null, { status: 500 }),
    })
    const response = await workerFetch(
      publicRequest('/api/omr/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/pdf' },
        body: PDF,
      }),
      env
    )
    expect(response.status).toBe(503)
    const metas = await kv.list({ prefix: 'meta:' })
    expect(metas.keys).toHaveLength(1)
    const id = metas.keys[0].name.slice(5)
    expect(await kv.get(`job:${id}:status:9999`, 'json')).toMatchObject({
      status: 'failed',
      error: { code: 'DISPATCH_FAILED' },
    })
    expect(await kv.get(`active:${id}`)).toBeNull()
    expect((await kv.list({ prefix: `job:${id}:input:` })).keys).toHaveLength(0)
  })

  it('reports progress through status keys and merges it with metadata', async () => {
    const kv = new MemoryKV()
    const env = makeEnv(kv, { FETCH_IMPL: createFetchStub().impl })
    const job = await createJob(env)

    const progress = await workerFetch(
      internalRequest(`/internal/jobs/${job.id}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seq: 7,
          status: 'running',
          stage: 'recognizing',
          progress: 42,
          message: 'Recognizing notation',
          detail: 'sheet 2',
          warnings: ['low confidence'],
        }),
      }),
      env
    )
    expect(progress.status).toBe(204)
    expect(await kv.get(`job:${job.id}:status:0007`, 'json')).toMatchObject({
      seq: 7,
      stage: 'recognizing',
      progress: 42,
    })

    const response = await workerFetch(publicRequest(`/api/omr/jobs/${job.id}`), env)
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload).toMatchObject({
      id: job.id,
      status: 'running',
      stage: 'recognizing',
      progress: 42,
      detail: 'sheet 2',
      fileName: 'my score.PDF',
    })
    expect(payload.warnings).toEqual(['low confidence'])

    const notReady = await workerFetch(publicRequest(`/api/omr/jobs/${job.id}/musicxml`), env)
    expect(notReady.status).toBe(409)
    expect((await notReady.json()).error.code).toBe('JOB_NOT_READY')
  })

  it('reconstructs result chunks for download with a safe content disposition', async () => {
    const kv = new MemoryKV()
    const env = makeEnv(kv, { FETCH_IMPL: createFetchStub().impl })
    const job = await createJob(env)
    const summary = { title: 'Hymn', pages: 1 }
    const warnings = ['Check bar 4']

    const result = await workerFetch(
      internalRequest(`/internal/jobs/${job.id}/result`, {
        method: 'POST',
        headers: {
          'X-OMR-Summary': encodeBase64UrlJson(summary),
          'X-OMR-Warnings': encodeBase64UrlJson(warnings),
        },
        body: XML,
      }),
      env
    )
    expect(result.status).toBe(204)
    const final = await kv.get(`job:${job.id}:status:9999`, 'json')
    expect(final).toMatchObject({
      status: 'complete',
      stage: 'complete',
      progress: 100,
      message: 'MusicXML ready',
      resultBytes: XML.length,
    })
    expect(final.summary).toEqual(summary)
    expect(final.warnings).toEqual(warnings)
    expect(await kv.get(`active:${job.id}`)).toBeNull()
    expect((await kv.list({ prefix: `job:${job.id}:result:` })).keys.length).toBeGreaterThan(1)
    expect(new TextDecoder().decode(await readAllChunks(kv, `job:${job.id}:result`))).toBe(XML)

    const payload = await (
      await workerFetch(publicRequest(`/api/omr/jobs/${job.id}`), env)
    ).json()
    expect(payload.status).toBe('complete')
    expect(payload.summary).toEqual(summary)

    const download = await workerFetch(publicRequest(`/api/omr/jobs/${job.id}/musicxml`), env)
    expect(download.status).toBe(200)
    expect(download.headers.get('Content-Type')).toBe(
      'application/vnd.recordare.musicxml+xml; charset=utf-8'
    )
    expect(download.headers.get('Content-Disposition')).toContain('my score.musicxml')
    expect(download.headers.get('Access-Control-Expose-Headers')).toContain('Content-Disposition')
    expect(await download.text()).toBe(XML)
  })

  it('serves the reconstructed PDF to authenticated internal callers', async () => {
    const kv = new MemoryKV()
    const env = makeEnv(kv, { FETCH_IMPL: createFetchStub().impl })
    const job = await createJob(env)
    const response = await workerFetch(internalRequest(`/internal/jobs/${job.id}/input`), env)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/pdf')
    expect(new TextDecoder().decode(await response.arrayBuffer())).toBe(
      new TextDecoder().decode(PDF)
    )
  })

  it('writes a failed final status with the latest stage and releases the slot', async () => {
    const kv = new MemoryKV()
    const env = makeEnv(kv, { FETCH_IMPL: createFetchStub().impl })
    const job = await createJob(env)
    await workerFetch(
      internalRequest(`/internal/jobs/${job.id}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seq: 3,
          stage: 'recognizing',
          progress: 31,
          message: 'Recognizing notation',
        }),
      }),
      env
    )
    const failure = await workerFetch(
      internalRequest(`/internal/jobs/${job.id}/failure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'INVALID_MUSICXML',
          message: 'The score failed validation.',
          detail: 'missing part list',
          validation: { ok: false },
        }),
      }),
      env
    )
    expect(failure.status).toBe(204)
    const status = await kv.get(`job:${job.id}:status:9999`, 'json')
    expect(status).toMatchObject({
      status: 'failed',
      stage: 'failed',
      failedStage: 'recognizing',
      progress: 31,
      error: { code: 'INVALID_MUSICXML', validation: { ok: false } },
    })
    expect(await kv.get(`active:${job.id}`)).toBeNull()
    expect((await kv.list({ prefix: `job:${job.id}:input:` })).keys.length).toBeGreaterThan(0)

    const payload = await (
      await workerFetch(publicRequest(`/api/omr/jobs/${job.id}`), env)
    ).json()
    expect(payload.status).toBe('failed')

    const ignored = await workerFetch(
      internalRequest(`/internal/jobs/${job.id}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seq: 9, stage: 'later', progress: 90, message: 'late' }),
      }),
      env
    )
    expect(ignored.status).toBe(204)
    expect(await kv.get(`job:${job.id}:status:0009`, 'json')).toBeNull()
  })

  it('rejects internal calls without valid bearer credentials and adds no CORS', async () => {
    const env = makeEnv(new MemoryKV())
    const requests = [
      new Request('https://omr.test/internal/jobs/abc/input'),
      internalRequest('/internal/jobs/abc/progress', { method: 'POST', token: 'wrong' }),
      internalRequest('/internal/jobs/abc/result', { method: 'POST', token: 'wrong', body: XML }),
      internalRequest('/internal/jobs/abc/failure', { method: 'POST', token: 'wrong' }),
    ]
    for (const request of requests) {
      const response = await workerFetch(request, env)
      expect(response.status).toBe(401)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
    }
  })

  it('refuses to delete an active job and removes finished job keys', async () => {
    const kv = new MemoryKV()
    const env = makeEnv(kv, { FETCH_IMPL: createFetchStub().impl })
    const job = await createJob(env)

    const active = await workerFetch(publicRequest(`/api/omr/jobs/${job.id}`, { method: 'DELETE' }), env)
    expect(active.status).toBe(409)
    expect((await active.json()).error.code).toBe('JOB_ACTIVE')

    await workerFetch(
      internalRequest(`/internal/jobs/${job.id}/result`, {
        method: 'POST',
        body: XML,
      }),
      env
    )
    const deleted = await workerFetch(
      publicRequest(`/api/omr/jobs/${job.id}`, { method: 'DELETE' }),
      env
    )
    expect(deleted.status).toBe(204)
    expect(await kv.get(`meta:${job.id}`, 'json')).toBeNull()
    expect((await kv.list({ prefix: `job:${job.id}:` })).keys).toHaveLength(0)
    expect(await kv.get(`active:${job.id}`)).toBeNull()
  })
})

describe('OMR worker scheduled cleanup', () => {
  it('removes only expired jobs, at most ten per run', async () => {
    const kv = new MemoryKV()
    const env = makeEnv(kv, { JOB_TTL_SECONDS: '10' })
    for (let index = 0; index < 12; index += 1) {
      const id = `job-${index}`
      await kv.put(
        `meta:${id}`,
        JSON.stringify({ id, fileName: 'old.pdf', fileSize: 4, createdAt: 1, updatedAt: 1 })
      )
      await kv.put(`job:${id}:status:9999`, JSON.stringify({ status: 'complete' }))
      await kv.put(`active:${id}`, '1')
    }
    await kv.put(
      'meta:fresh',
      JSON.stringify({ id: 'fresh', fileName: 'new.pdf', fileSize: 4, updatedAt: Date.now() })
    )

    await scheduled(null, env, null)
    expect((await kv.list({ prefix: 'meta:' })).keys).toHaveLength(3)

    await scheduled(null, env, null)
    const remaining = (await kv.list({ prefix: 'meta:' })).keys
    expect(remaining).toHaveLength(1)
    expect(remaining[0].name).toBe('meta:fresh')
    expect((await kv.list({ prefix: 'job:' })).keys).toHaveLength(0)
    expect((await kv.list({ prefix: 'active:' })).keys).toHaveLength(0)
  })
})
