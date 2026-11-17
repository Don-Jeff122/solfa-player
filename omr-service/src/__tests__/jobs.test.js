import { describe, expect, it } from 'vitest'
import { JobQueue } from '../jobs.js'

const quiet = { info() {}, error() {} }

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('JobQueue', () => {
  it('runs one job at a time and preserves queue order', async () => {
    const queue = new JobQueue({ maxConcurrent: 1, logger: quiet })
    const first = deferred()
    const second = deferred()

    const a = queue.create({ fileName: 'a.pdf', fileSize: 10, tempDir: 'a', inputPath: 'a.pdf' })
    const b = queue.create({ fileName: 'b.pdf', fileSize: 10, tempDir: 'b', inputPath: 'b.pdf' })

    queue.enqueue(a.id, () => first.promise)
    queue.enqueue(b.id, () => second.promise)
    await Promise.resolve()

    expect(queue.get(a.id).status).toBe('running')
    expect(queue.get(b.id).status).toBe('queued')

    first.resolve({ xml: 'a' })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(queue.get(a.id).status).toBe('complete')
    expect(queue.get(b.id).status).toBe('running')

    second.resolve({ xml: 'b' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(queue.get(b.id).status).toBe('complete')
  })

  it('records a failure at the last running stage', async () => {
    const queue = new JobQueue({ maxConcurrent: 1, logger: quiet })
    const job = queue.create({ fileName: 'a.pdf', fileSize: 10, tempDir: 'a', inputPath: 'a.pdf' })

    queue.enqueue(job.id, async (update) => {
      update({ stage: 'recognizing', progress: 30 })
      throw Object.assign(new Error('bad scan'), {
        code: 'AUDIVERIS_FAILED',
        retryable: true,
      })
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    const failed = queue.get(job.id)
    expect(failed.status).toBe('failed')
    expect(failed.failedStage).toBe('recognizing')
    expect(failed.error).toMatchObject({
      code: 'AUDIVERIS_FAILED',
      message: 'bad scan',
      retryable: true,
    })
  })

  it('exposes a public job without temp paths or XML', () => {
    const queue = new JobQueue({ maxConcurrent: 1, logger: quiet })
    const job = queue.create({ fileName: 'a.pdf', fileSize: 10, tempDir: 'a', inputPath: 'a.pdf' })
    queue.finish(job.id, {
      xml: '<score/>',
      fileName: 'a.musicxml',
      validation: { summary: { parts: 1 }, warnings: ['w'] },
    })

    const publicJob = queue.publicJob(job.id)
    expect(publicJob).not.toHaveProperty('tempDir')
    expect(publicJob).not.toHaveProperty('inputPath')
    expect(publicJob).not.toHaveProperty('result')
    expect(publicJob.status).toBe('complete')
    expect(publicJob.summary).toEqual({ parts: 1 })
    expect(publicJob.warnings).toEqual(['w'])
  })

  it('removes only settled jobs and expires them after the TTL', () => {
    let now = 1000
    const queue = new JobQueue({ ttlMs: 100, now: () => now, logger: quiet })
    const done = queue.create({ fileName: 'done.pdf', fileSize: 1, tempDir: 'd', inputPath: 'd.pdf' })
    const running = queue.create({ fileName: 'run.pdf', fileSize: 1, tempDir: 'r', inputPath: 'r.pdf' })
    queue.finish(done.id, { xml: '<score/>', validation: {} })
    running.status = 'running'

    expect(queue.remove(running.id)).toBe(false)
    now = 1200
    queue.cleanup()
    expect(queue.get(done.id)).toBeNull()
    expect(queue.get(running.id)).not.toBeNull()
  })
})
