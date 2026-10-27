import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkHealth } from '../scanApi'

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('checkHealth', () => {
  it('retries an unreachable service and returns the health payload', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse({ status: 'ok', ocr: 'PaddleOCR ready' }))
    vi.stubGlobal('fetch', fetchMock)
    const onRetry = vi.fn()

    await expect(
      checkHealth(undefined, { attempts: 2, intervalMs: 0, onRetry })
    ).resolves.toMatchObject({ ocr: 'PaddleOCR ready' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenCalledWith(1, expect.objectContaining({ offline: true }))
  })

  it('retries a warming server that returns a temporary server error', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ detail: 'Starting' }, 503))
      .mockResolvedValueOnce(jsonResponse({ status: 'ok', ocr: 'PaddleOCR ready' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      checkHealth(undefined, { attempts: 2, intervalMs: 0 })
    ).resolves.toMatchObject({ status: 'ok' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('stops after the final attempt', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)
    const onRetry = vi.fn()

    await expect(checkHealth(undefined, { attempts: 3, intervalMs: 0, onRetry })).rejects.toMatchObject(
      { name: 'ScanApiError', offline: true }
    )
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(onRetry).toHaveBeenCalledTimes(2)
  })

  it('does not retry an aborted request', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'))
    vi.stubGlobal('fetch', fetchMock)
    const onRetry = vi.fn()

    await expect(checkHealth(undefined, { attempts: 3, intervalMs: 0, onRetry })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onRetry).not.toHaveBeenCalled()
  })
})
