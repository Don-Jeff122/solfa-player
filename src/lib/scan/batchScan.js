function normalizePages(pages) {
  return [...new Set(
    (Array.isArray(pages) ? pages : [])
      .map((page) => Number(page))
      .filter((page) => Number.isInteger(page) && page > 0)
  )].sort((a, b) => a - b)
}

function isRateLimit(error) {
  return Number(error?.status) === 429
}

function isFatal(error) {
  const status = Number(error?.status)
  return status === 401 || status === 403 || status === 413 || status === 415
}

function isInfrastructureFailure(error) {
  const status = Number(error?.status)
  return (
    error?.code === 'NETWORK' ||
    error?.code === 'TIMEOUT' ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  )
}

function isCanceled(error, signal) {
  return Boolean(signal?.aborted) || error?.code === 'CANCELED' || error?.name === 'AbortError'
}

function wait(ms, signal) {
  if (!ms || ms <= 0) return Promise.resolve(!signal?.aborted)
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false)
      return
    }
    function cleanup() {
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
    }
    function onAbort() {
      cleanup()
      resolve(false)
    }
    const timer = setTimeout(() => {
      cleanup()
      resolve(true)
    }, ms)
    signal?.addEventListener?.('abort', onAbort, { once: true })
  })
}

export async function runBatchScan({
  pages = [],
  scanPage,
  signal,
  delayMs = 500,
  maxConsecutiveInfrastructureFailures = 2,
  onPageStart,
  onPageSuccess,
  onPageFailure,
  onProgress,
} = {}) {
  const queue = normalizePages(pages)
  const completed = []
  const failed = []
  let stopReason = null
  let remaining = []
  let consecutiveInfrastructureFailures = 0

  if (typeof scanPage !== 'function') {
    throw new Error('A page reader is required.')
  }

  for (let index = 0; index < queue.length; index += 1) {
    const pageNumber = queue[index]

    if (signal?.aborted) {
      stopReason = 'canceled'
      remaining = queue.slice(index)
      break
    }

    onPageStart?.(pageNumber, { index, total: queue.length })
    try {
      const page = await scanPage(pageNumber, { signal })
      if (signal?.aborted) {
        stopReason = 'canceled'
        remaining = queue.slice(index)
        break
      }
      completed.push(pageNumber)
      consecutiveInfrastructureFailures = 0
      onPageSuccess?.(pageNumber, page, { index, total: queue.length })
    } catch (reason) {
      if (isCanceled(reason, signal)) {
        stopReason = 'canceled'
        remaining = queue.slice(index)
        break
      }

      const failure = {
        pageNumber,
        message: reason?.message || 'Gemini could not read this page.',
        status: reason?.status ?? null,
        code: reason?.code ?? null,
      }
      failed.push(failure)
      onPageFailure?.(failure, { index, total: queue.length })

      if (isRateLimit(reason)) {
        stopReason = 'rate-limit'
        remaining = queue.slice(index + 1)
        break
      }
      if (isFatal(reason)) {
        stopReason = 'fatal'
        remaining = queue.slice(index + 1)
        break
      }
      if (isInfrastructureFailure(reason)) {
        consecutiveInfrastructureFailures += 1
        if (consecutiveInfrastructureFailures >= maxConsecutiveInfrastructureFailures) {
          stopReason = 'unavailable'
          remaining = queue.slice(index + 1)
          break
        }
      } else {
        consecutiveInfrastructureFailures = 0
      }
    }

    onProgress?.({
      pageNumber,
      total: queue.length,
      completed: completed.length,
      failed: failed.length,
    })

    if (index < queue.length - 1) {
      const finished = await wait(delayMs, signal)
      if (!finished) {
        stopReason = 'canceled'
        remaining = queue.slice(index + 1)
        break
      }
    }
  }

  return {
    total: queue.length,
    completed,
    failed,
    remaining,
    stopReason,
    canceled: stopReason === 'canceled',
  }
}
