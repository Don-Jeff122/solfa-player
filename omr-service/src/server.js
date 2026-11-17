import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, open, rm } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  isAudiverisAvailable,
  readMusicXmlResult,
  resolveAudiverisBin,
  runAudiveris,
} from './audiveris.js'
import { loadConfig } from './config.js'
import { OmrError, errorDetails } from './errors.js'
import { JobQueue } from './jobs.js'
import { validateMusicXml } from './musicXml.js'

const PDF_MAGIC = '%PDF-'
const PDF_TYPES = new Set(['application/pdf', 'application/x-pdf', 'application/octet-stream'])
const JOB_PATH = /^\/api\/omr\/jobs\/([0-9a-f-]+)$/i
const DOWNLOAD_PATH = /^\/api\/omr\/jobs\/([0-9a-f-]+)\/musicxml$/i

function corsHeaders(origin, allowedOrigins) {
  if (!origin) return {}
  const allowed =
    allowedOrigins.includes('*') || allowedOrigins.some((entry) => entry === origin)
  if (!allowed) return {}
  return {
    'Access-Control-Allow-Origin': allowedOrigins.includes('*') ? '*' : origin,
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-File-Name',
    'Access-Control-Expose-Headers': 'Content-Disposition',
    'Access-Control-Max-Age': '600',
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

function sendError(res, error) {
  const details = errorDetails(error)
  sendJson(res, details.status || 500, {
    error: {
      code: details.code,
      message: details.message,
      detail: details.detail,
      retryable: details.retryable,
      validation: details.validation || undefined,
    },
  })
}

function safeFileName(raw) {
  let value = String(raw || 'score.pdf')
  try {
    value = decodeURIComponent(value)
  } catch {
    /* keep the raw value */
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

function requestToFile(req, destination, maxBytes) {
  return new Promise((resolve, reject) => {
    let stream
    try {
      stream = createWriteStream(destination, { flags: 'wx' })
    } catch (error) {
      reject(
        new OmrError('UPLOAD_FAILED', 'The PDF could not be saved.', {
          status: 500,
          detail: error?.message || String(error),
          retryable: true,
        })
      )
      return
    }

    let total = 0
    let settled = false
    let failure = null

    const fail = (error) => {
      if (settled || failure) return
      failure = error
      stream.destroy()
      try {
        req.resume()
      } catch {
        /* request already closed */
      }
    }

    const close = () => {
      if (settled) return
      settled = true
      if (failure) {
        reject(failure)
        return
      }
      if (!total) {
        reject(new OmrError('UPLOAD_EMPTY', 'The uploaded PDF is empty.', { status: 400 }))
        return
      }
      resolve({ bytes: total })
    }

    req.on('data', (chunk) => {
      if (settled || failure) return
      total += chunk.length
      if (total > maxBytes) {
        fail(
          new OmrError(
            'UPLOAD_TOO_LARGE',
            `PDF is larger than the ${Math.round(maxBytes / (1024 * 1024))} MB limit.`,
            { status: 413, retryable: false }
          )
        )
        return
      }
      if (!stream.write(chunk)) req.pause()
    })
    stream.on('drain', () => {
      try {
        req.resume()
      } catch {
        /* request already closed */
      }
    })
    req.on('end', () => {
      if (!settled && !failure) stream.end()
    })
    stream.on('close', close)
    stream.on('error', fail)
    req.on('error', fail)
    req.on('aborted', () =>
      fail(new OmrError('UPLOAD_ABORTED', 'The upload was interrupted.', { status: 400 }))
    )
  })
}

async function removeDir(directory) {
  try {
    await rm(directory, { recursive: true, force: true })
  } catch {
    /* cleanup failure must not replace the original error */
  }
}

async function assertPdf(filePath) {
  const handle = await open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(PDF_MAGIC.length)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    if (bytesRead !== buffer.length || buffer.toString('latin1') !== PDF_MAGIC) {
      throw new OmrError('NOT_A_PDF', 'Choose a valid PDF file.', {
        status: 415,
        retryable: false,
      })
    }
  } finally {
    await handle.close()
  }
}

async function executeJob(job, update, { config, runner }) {
  const outputDir = path.join(job.tempDir, 'output')
  await mkdir(outputDir, { recursive: true })

  try {
    update({ stage: 'preparing', progress: 8, message: 'Preparing document' })

    let recognized = 22
    update({ stage: 'recognizing', progress: recognized, message: 'Recognizing notation' })

    await runner.runAudiveris({
      bin: config.audiverisBin || resolveAudiverisBin(),
      inputPath: job.inputPath,
      outputDir,
      timeoutMs: config.jobTimeoutMs,
      onStep: ({ step, stepIndex, totalSteps, sheet }) => {
        const pct = 22 + Math.round(((stepIndex + 1) / totalSteps) * 55)
        recognized = Math.max(recognized, Math.min(pct, 77))
        update({
          stage: 'recognizing',
          progress: recognized,
          message: 'Recognizing notation',
          detail: sheet ? `${step} · sheet ${sheet}` : step,
        })
      },
    })

    update({ stage: 'generating', progress: 82, message: 'Generating MusicXML', detail: '' })
    const { xml, sourceName } = await runner.readMusicXmlResult(outputDir)

    update({ stage: 'validating', progress: 90, message: 'Validating MusicXML', detail: sourceName })
    const validation = validateMusicXml(xml, { fileName: sourceName })
    if (!validation.ok) {
      throw new OmrError(
        'INVALID_MUSICXML',
        'Audiveris produced MusicXML, but the score failed structural validation.',
        {
          status: 422,
          detail: validation.errors.join(' '),
          retryable: true,
          validation,
        }
      )
    }

    return {
      xml,
      fileName: downloadName(job.fileName),
      validation,
    }
  } finally {
    await removeDir(job.tempDir)
  }
}

export function createOmrServer({
  config = loadConfig(),
  queue,
  runner = { runAudiveris, readMusicXmlResult },
  logger = console,
} = {}) {
  const jobs =
    queue ||
    new JobQueue({
      maxConcurrent: config.maxConcurrent,
      ttlMs: config.jobTtlMs,
      logger,
    })

  const server = http.createServer((req, res) => {
    handleRequest(req, res, { config, jobs, runner, logger }).catch((error) => {
      if (res.headersSent) {
        res.destroy()
        return
      }
      sendError(res, error)
    })
  })

  server.jobs = jobs
  const cleanup = setInterval(() => jobs.cleanup(), 5 * 60 * 1000)
  cleanup.unref?.()
  server.on('close', () => clearInterval(cleanup))
  return server
}

async function handleRequest(req, res, { config, jobs, runner, logger }) {
  const origin = req.headers.origin
  const cors = corsHeaders(origin, config.allowedOrigins)
  for (const [name, value] of Object.entries(cors)) res.setHeader(name, value)

  if (origin && !Object.keys(cors).length) {
    sendJson(res, 403, {
      error: {
        code: 'ORIGIN_NOT_ALLOWED',
        message: 'This origin is not allowed to use the OMR service.',
        retryable: false,
      },
    })
    return
  }

  res.setHeader('X-Content-Type-Options', 'nosniff')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

  if (req.method === 'GET' && url.pathname === '/api/health') {
    const bin = config.audiverisBin || resolveAudiverisBin()
    sendJson(res, 200, {
      ok: true,
      service: 'solfa-omr',
      audiveris: {
        bin,
        version: config.audiverisVersion,
        available: isAudiverisAvailable(bin),
      },
      limits: {
        maxUploadBytes: config.maxUploadBytes,
        jobTimeoutMs: config.jobTimeoutMs,
      },
    })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/omr/jobs') {
    await createJob(req, res, { config, jobs, runner, logger })
    return
  }

  const jobMatch = url.pathname.match(JOB_PATH)
  const downloadMatch = url.pathname.match(DOWNLOAD_PATH)
  if (req.method === 'GET' && downloadMatch) {
    const job = jobs.get(downloadMatch[1])
    if (!job) {
      sendJson(res, 404, {
        error: { code: 'JOB_NOT_FOUND', message: 'This OMR job no longer exists.', retryable: false },
      })
      return
    }
    if (job.status !== 'complete' || !job.result?.xml) {
      sendJson(res, 409, {
        error: {
          code: 'JOB_NOT_READY',
          message: 'The MusicXML file is not ready yet.',
          retryable: true,
        },
      })
      return
    }
    res.writeHead(200, {
      'Content-Type': 'application/vnd.recordare.musicxml+xml; charset=utf-8',
      'Content-Disposition': contentDisposition(job.fileName),
      'Content-Length': Buffer.byteLength(job.result.xml),
      'Cache-Control': 'no-store',
    })
    res.end(job.result.xml)
    return
  }

  if (req.method === 'GET' && jobMatch) {
    const job = jobs.publicJob(jobMatch[1])
    if (!job) {
      sendJson(res, 404, {
        error: { code: 'JOB_NOT_FOUND', message: 'This OMR job no longer exists.', retryable: false },
      })
      return
    }
    sendJson(res, 200, job)
    return
  }

  if (req.method === 'DELETE' && jobMatch) {
    const job = jobs.get(jobMatch[1])
    if (!job) {
      sendJson(res, 404, {
        error: { code: 'JOB_NOT_FOUND', message: 'This OMR job no longer exists.', retryable: false },
      })
      return
    }
    if (job.status === 'running' || job.status === 'queued') {
      sendJson(res, 409, {
        error: {
          code: 'JOB_ACTIVE',
          message: 'This OMR job is still running.',
          retryable: true,
        },
      })
      return
    }
    jobs.remove(job.id)
    res.writeHead(204)
    res.end()
    return
  }

  sendJson(res, 404, {
    error: { code: 'NOT_FOUND', message: 'Unknown endpoint.', retryable: false },
  })
}

async function createJob(req, res, { config, jobs, runner, logger }) {
  const contentType = String(req.headers['content-type'] || '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  if (contentType && !PDF_TYPES.has(contentType)) {
    throw new OmrError('UNSUPPORTED_FILE', 'Upload a PDF file.', { status: 415 })
  }

  const declaredLength = Number(req.headers['content-length'])
  if (Number.isFinite(declaredLength) && declaredLength > config.maxUploadBytes) {
    throw new OmrError(
      'UPLOAD_TOO_LARGE',
      `PDF is larger than the ${Math.round(config.maxUploadBytes / (1024 * 1024))} MB limit.`,
      { status: 413, retryable: false }
    )
  }

  await mkdir(config.tempRoot, { recursive: true })
  const tempDir = await mkdtemp(path.join(config.tempRoot, 'solfa-omr-'))
  const inputPath = path.join(tempDir, 'source.pdf')
  const fileName = safeFileName(req.headers['x-file-name'])
  let fileSize = 0

  try {
    const uploaded = await requestToFile(req, inputPath, config.maxUploadBytes)
    fileSize = uploaded.bytes
    await assertPdf(inputPath)

    const job = jobs.create({ fileName, fileSize, tempDir, inputPath })
    jobs.enqueue(job.id, (update) =>
      executeJob(job, update, { config, runner }).catch(async (error) => {
        await removeDir(tempDir)
        throw error
      })
    )

    logger.info?.(`OMR job ${job.id} queued for ${fileName} (${fileSize} bytes)`)
    sendJson(res, 202, jobs.publicJob(job.id))
  } catch (error) {
    await removeDir(tempDir)
    throw error
  }
}

export function startServer(config = loadConfig()) {
  const server = createOmrServer({ config })
  server.listen(config.port, config.host, () => {
    console.log(`Solfa OMR service listening on http://${config.host}:${config.port}`)
  })
  const stop = () => server.close(() => process.exit(0))
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  return server
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  startServer()
}
