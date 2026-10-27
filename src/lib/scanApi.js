const configured = import.meta.env.VITE_SCAN_API_URL || 'http://127.0.0.1:8000'
export const API_BASE = configured.replace(/\/+$/, '')
const localApi = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(API_BASE)
const hostedWithoutBackend =
  localApi && typeof window !== 'undefined' && window.location.protocol === 'https:'

export class ScanApiError extends Error {
  constructor(message, { status = 0, hint = '', offline = false } = {}) {
    super(message)
    this.name = 'ScanApiError'
    this.status = status
    this.hint = hint
    this.offline = offline
  }
}

function abortReason(signal) {
  if (signal?.reason instanceof Error) return signal.reason
  const error = new Error('This operation was aborted')
  error.name = 'AbortError'
  return error
}

function wait(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortReason(signal))
  return new Promise((resolve, reject) => {
    let timer
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortReason(signal))
    }
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function apiUrl(path) {
  if (!path) return ''
  if (/^https?:\/\//i.test(path)) return path
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`
}

async function request(path, options = {}) {
  let response
  try {
    response = await fetch(apiUrl(path), options)
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    throw new ScanApiError('Could not reach the scanner backend.', {
      offline: true,
      hint: hostedWithoutBackend
        ? 'This hosted build has no OCR backend URL. Set VITE_SCAN_API_URL and redeploy GitHub Pages.'
        : `Start the FastAPI service at ${API_BASE} and check VITE_SCAN_API_URL if it runs elsewhere.`,
    })
  }
  let payload = null
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    try {
      payload = await response.json()
    } catch {
      payload = null
    }
  }
  if (!response.ok) {
    const detail = payload?.detail
    const message = Array.isArray(detail)
      ? detail.map((item) => item?.msg || 'Invalid request').join('; ')
      : detail || `Scanner request failed (${response.status}).`
    throw new ScanApiError(message, {
      status: response.status,
      hint: payload?.hint || '',
    })
  }
  return payload
}

export async function uploadDocument(file, signal) {
  const form = new FormData()
  form.append('file', file, file.name)
  return request('/api/documents', { method: 'POST', body: form, signal })
}

export async function startDocumentScan(documentId, pages, signal) {
  return request(`/api/documents/${documentId}/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pages }),
    signal,
  })
}

export async function getScan(documentId, signal) {
  return request(`/api/scan/${documentId}`, { signal })
}

export async function getScanPage(documentId, page, signal) {
  return request(`/api/scan/${documentId}/pages/${page}`, { signal })
}

export async function saveCorrections(documentId, corrections, signal) {
  return request(`/api/scan/${documentId}/corrections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ corrections }),
    signal,
  })
}

export async function deleteDocument(documentId) {
  return request(`/api/documents/${documentId}`, { method: 'DELETE' })
}

export async function checkHealth(
  signal,
  { attempts = localApi ? 2 : 8, intervalMs = localApi ? 1500 : 7000, onRetry } = {}
) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await request('/api/health', { signal })
    } catch (err) {
      lastError = err
      const transient = err?.offline || (err?.status >= 500 && err?.status <= 599)
      if (err?.name === 'AbortError' || !transient || attempt === attempts) throw err
      onRetry?.(attempt, err)
      await wait(intervalMs, signal)
    }
  }
  throw lastError
}
