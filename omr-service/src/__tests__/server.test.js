import { mkdtemp, rm } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createOmrServer } from '../server.js'

const quiet = { info() {}, error() {} }
const VALID_XML =
  '<?xml version="1.0"?><score-partwise><work><work-title>Test</work-title></work><part-list><score-part id="P1"><part-name>Soprano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note></measure></part></score-partwise>'

const servers = []
const tempDirs = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve)))
  )
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function request(port, pathName, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: pathName, method, headers },
      (res) => {
        let text = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          text += chunk
        })
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }))
      }
    )
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

async function startTestServer({ fail = false, maxUploadBytes = 1024 * 1024 } = {}) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'solfa-omr-test-'))
  tempDirs.push(tempRoot)
  const runner = {
    async runAudiveris({ onStep }) {
      onStep({ step: 'PAGE', stepIndex: 19, totalSteps: 20, sheet: 1 })
      return { logs: '' }
    },
    async readMusicXmlResult() {
      if (fail) {
        throw Object.assign(new Error('Audiveris did not produce a file.'), {
          code: 'MUSICXML_MISSING',
          retryable: true,
        })
      }
      return { xml: VALID_XML, sourceName: 'score.musicxml' }
    },
  }
  const server = createOmrServer({
    config: {
      allowedOrigins: ['http://example.test'],
      maxUploadBytes,
      jobTimeoutMs: 2000,
      jobTtlMs: 60_000,
      maxConcurrent: 1,
      tempRoot,
      audiverisBin: 'fake-audiveris',
      audiverisVersion: 'test',
    },
    runner,
    logger: quiet,
  })
  servers.push(server)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return server.address().port
}

async function waitForJob(port, id) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await request(port, `/api/omr/jobs/${id}`)
    const job = JSON.parse(response.text)
    if (job.status === 'complete' || job.status === 'failed') return { response, job }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('job did not settle')
}

describe('OMR HTTP service', () => {
  it('uploads a PDF, runs a fake Audiveris job, and returns MusicXML', async () => {
    const port = await startTestServer()
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n')
    const upload = await request(port, '/api/omr/jobs', {
      method: 'POST',
      body: pdf,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': pdf.length,
        'X-File-Name': encodeURIComponent('test score.pdf'),
      },
    })

    expect(upload.status).toBe(202)
    const created = JSON.parse(upload.text)
    expect(created.fileName).toBe('test score.pdf')
    expect(['queued', 'running', 'complete']).toContain(created.status)

    const { response, job } = await waitForJob(port, created.id)
    expect(response.status).toBe(200)
    expect(job.status).toBe('complete')
    expect(job.progress).toBe(100)
    expect(job.summary.parts).toBe(1)
    expect(job.warnings.some((entry) => entry.includes('No key signature'))).toBe(false)

    const download = await request(port, `/api/omr/jobs/${created.id}/musicxml`)
    expect(download.status).toBe(200)
    expect(download.text).toBe(VALID_XML)
    expect(download.headers['content-disposition']).toContain('test score.musicxml')
    expect(download.headers['content-type']).toContain('musicxml')
  })

  it('rejects a body that does not start with a PDF signature', async () => {
    const port = await startTestServer()
    const upload = await request(port, '/api/omr/jobs', {
      method: 'POST',
      body: Buffer.from('not a pdf'),
      headers: { 'Content-Type': 'application/pdf', 'Content-Length': 9 },
    })
    expect(upload.status).toBe(415)
    expect(JSON.parse(upload.text).error.code).toBe('NOT_A_PDF')
  })

  it('stops a chunked upload as soon as it crosses the size limit', async () => {
    const port = await startTestServer({ maxUploadBytes: 8 })
    const upload = await request(port, '/api/omr/jobs', {
      method: 'POST',
      body: Buffer.from('%PDF-1.4\nmore data'),
      headers: { 'Content-Type': 'application/pdf' },
    })

    expect(upload.status).toBe(413)
    expect(JSON.parse(upload.text).error.code).toBe('UPLOAD_TOO_LARGE')
  })

  it('reports a failed job with a retryable error', async () => {
    const port = await startTestServer({ fail: true })
    const pdf = Buffer.from('%PDF-1.4\n')
    const upload = await request(port, '/api/omr/jobs', {
      method: 'POST',
      body: pdf,
      headers: { 'Content-Type': 'application/pdf', 'Content-Length': pdf.length },
    })
    const created = JSON.parse(upload.text)
    const { job } = await waitForJob(port, created.id)

    expect(job.status).toBe('failed')
    expect(job.error.code).toBe('MUSICXML_MISSING')
    expect(job.error.retryable).toBe(true)
    expect(job.failedStage).toBe('generating')
  })

  it('enforces CORS for configured origins', async () => {
    const port = await startTestServer()
    const ok = await request(port, '/api/health', {
      headers: { Origin: 'http://example.test' },
    })
    expect(ok.status).toBe(200)
    expect(ok.headers['access-control-allow-origin']).toBe('http://example.test')

    const denied = await request(port, '/api/health', {
      headers: { Origin: 'http://evil.test' },
    })
    expect(denied.status).toBe(403)
    expect(JSON.parse(denied.text).error.code).toBe('ORIGIN_NOT_ALLOWED')
  })
})
