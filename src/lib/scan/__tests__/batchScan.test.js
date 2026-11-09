import { describe, expect, it, vi } from 'vitest'
import { runBatchScan } from '../batchScan.js'

describe('Gemini batch scan', () => {
  it('reads pages sequentially in numeric order and reports progress', async () => {
    const order = []
    const progress = []
    const result = await runBatchScan({
      pages: [3, 1, 2, 2],
      delayMs: 0,
      scanPage: vi.fn(async (pageNumber) => {
        order.push(pageNumber)
        return { pageNumber }
      }),
      onProgress: (value) => progress.push(value),
    })

    expect(order).toEqual([1, 2, 3])
    expect(result.completed).toEqual([1, 2, 3])
    expect(result.failed).toEqual([])
    expect(result.remaining).toEqual([])
    expect(result.stopReason).toBeNull()
    expect(progress.at(-1)).toMatchObject({
      total: 3,
      completed: 3,
      failed: 0,
    })
  })

  it('continues after a page-level failure', async () => {
    const result = await runBatchScan({
      pages: [1, 2, 3],
      delayMs: 0,
      scanPage: async (pageNumber) => {
        if (pageNumber === 2) throw new Error('Gemini found no solfa')
        return { pageNumber }
      },
    })

    expect(result.completed).toEqual([1, 3])
    expect(result.failed).toEqual([
      expect.objectContaining({ pageNumber: 2, message: 'Gemini found no solfa' }),
    ])
    expect(result.remaining).toEqual([])
    expect(result.stopReason).toBeNull()
  })

  it('stops immediately on a rate limit', async () => {
    const scanPage = vi.fn(async () => {
      throw Object.assign(new Error('Gemini request limit reached.'), { status: 429 })
    })
    const result = await runBatchScan({
      pages: [1, 2, 3],
      delayMs: 0,
      scanPage,
    })

    expect(scanPage).toHaveBeenCalledTimes(1)
    expect(result.completed).toEqual([])
    expect(result.failed).toEqual([
      expect.objectContaining({ pageNumber: 1, status: 429 }),
    ])
    expect(result.remaining).toEqual([2, 3])
    expect(result.stopReason).toBe('rate-limit')
  })

  it('pauses after consecutive infrastructure failures', async () => {
    const scanPage = vi.fn(async () => {
      throw Object.assign(new Error('Gemini is busy.'), { status: 503 })
    })
    const result = await runBatchScan({
      pages: [1, 2, 3],
      delayMs: 0,
      scanPage,
    })

    expect(scanPage).toHaveBeenCalledTimes(2)
    expect(result.completed).toEqual([])
    expect(result.failed).toHaveLength(2)
    expect(result.remaining).toEqual([3])
    expect(result.stopReason).toBe('unavailable')
  })

  it('stops immediately on a configuration error', async () => {
    const result = await runBatchScan({
      pages: [1, 2],
      delayMs: 0,
      scanPage: async () => {
        throw Object.assign(new Error('Origin not allowed.'), { status: 403 })
      },
    })

    expect(result.failed).toHaveLength(1)
    expect(result.remaining).toEqual([2])
    expect(result.stopReason).toBe('fatal')
  })

  it('cancels between pages and keeps completed pages', async () => {
    const controller = new AbortController()
    const scanPage = vi.fn(async (pageNumber) => ({ pageNumber }))
    const result = await runBatchScan({
      pages: [1, 2, 3],
      delayMs: 10,
      signal: controller.signal,
      scanPage,
      onPageSuccess: () => controller.abort(),
    })

    expect(scanPage).toHaveBeenCalledTimes(1)
    expect(result.completed).toEqual([1])
    expect(result.remaining).toEqual([2, 3])
    expect(result.canceled).toBe(true)
    expect(result.stopReason).toBe('canceled')
  })

  it('treats a caller cancellation as a stop, not a page failure', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await runBatchScan({
      pages: [1, 2],
      delayMs: 0,
      signal: controller.signal,
      scanPage: vi.fn(),
    })

    expect(result.completed).toEqual([])
    expect(result.failed).toEqual([])
    expect(result.remaining).toEqual([1, 2])
    expect(result.stopReason).toBe('canceled')
  })
})
