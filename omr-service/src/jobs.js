import { randomUUID } from 'node:crypto'

function clampProgress(value, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(0, Math.min(100, Math.round(number)))
}

export class JobQueue {
  constructor({
    maxConcurrent = 1,
    ttlMs = 60 * 60 * 1000,
    now = () => Date.now(),
    logger = console,
  } = {}) {
    this.maxConcurrent = Math.max(1, maxConcurrent)
    this.ttlMs = ttlMs
    this.now = now
    this.logger = logger
    this.jobs = new Map()
    this.pending = []
    this.active = 0
  }

  create({ fileName, fileSize, tempDir, inputPath }) {
    const id = randomUUID()
    const at = this.now()
    const job = {
      id,
      status: 'queued',
      stage: 'queued',
      progress: 0,
      message: 'Queued for conversion',
      detail: '',
      fileName,
      fileSize,
      createdAt: at,
      updatedAt: at,
      tempDir,
      inputPath,
      summary: null,
      warnings: [],
      error: null,
      failedStage: null,
      result: null,
    }
    this.jobs.set(id, job)
    return job
  }

  enqueue(id, worker) {
    this.pending.push({ id, worker })
    this.drain()
    return id
  }

  update(id, patch = {}) {
    const job = this.jobs.get(id)
    if (!job) return null
    const next = { ...patch }
    if ('progress' in next) {
      next.progress = clampProgress(next.progress, job.progress)
    }
    if ('warnings' in next && !Array.isArray(next.warnings)) delete next.warnings
    Object.assign(job, next)
    job.updatedAt = this.now()
    return job
  }

  finish(id, result) {
    const job = this.jobs.get(id)
    if (!job) return
    job.result = result
    job.summary = result?.validation?.summary || null
    job.warnings = result?.validation?.warnings || []
    job.status = 'complete'
    job.stage = 'complete'
    job.progress = 100
    job.message = 'MusicXML ready'
    job.detail = ''
    job.updatedAt = this.now()
  }

  fail(id, error) {
    const job = this.jobs.get(id)
    if (!job) return
    job.failedStage = job.stage === 'queued' ? 'preparing' : job.stage
    job.status = 'failed'
    job.stage = 'failed'
    job.error = {
      code: error?.code || 'OMR_FAILED',
      message: error?.message || 'The OMR conversion failed.',
      detail: error?.detail || '',
      retryable: error?.retryable !== false,
      validation: error?.validation || null,
    }
    job.updatedAt = this.now()
  }

  async drain() {
    while (this.active < this.maxConcurrent && this.pending.length) {
      const { id, worker } = this.pending.shift()
      const job = this.jobs.get(id)
      if (!job) continue
      this.active += 1
      job.status = 'running'
      job.updatedAt = this.now()
      try {
        const result = await worker((patch) => this.update(id, patch))
        this.finish(id, result)
      } catch (error) {
        this.fail(id, error)
        this.logger.error?.(`OMR job ${id} failed: ${error?.message || error}`)
      } finally {
        this.active -= 1
        this.drain()
      }
    }
  }

  get(id) {
    return this.jobs.get(id) || null
  }

  publicJob(id) {
    const job = this.jobs.get(id)
    if (!job) return null
    return {
      id: job.id,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      message: job.message,
      detail: job.detail,
      fileName: job.fileName,
      fileSize: job.fileSize,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      summary: job.summary,
      warnings: job.warnings,
      error: job.error,
      failedStage: job.failedStage,
    }
  }

  remove(id) {
    const job = this.jobs.get(id)
    if (!job) return false
    if (job.status === 'running') return false
    this.jobs.delete(id)
    return true
  }

  cleanup(now = this.now()) {
    for (const [id, job] of this.jobs) {
      if (job.status === 'running' || job.status === 'queued') continue
      if (now - job.updatedAt > this.ttlMs) this.jobs.delete(id)
    }
  }

  get size() {
    return this.jobs.size
  }
}
