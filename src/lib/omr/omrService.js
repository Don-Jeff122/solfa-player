const RAW_BASE =
  typeof import.meta !== 'undefined' ? import.meta.env?.VITE_OMR_API_URL || '' : ''

const OMR_API_BASE = String(RAW_BASE).replace(/\/+$/, '')
export const MAX_OMR_PDF_BYTES = 25 * 1024 * 1024

class OmrRequestError extends Error {
  constructor(message, { code = 'OMR_REQUEST_FAILED', status = 0, detail = '', retryable = true, validation = null } = {}) {
    super(message)
    this.name = 'OmrRequestError'
    this.code = code
    this.status = status
    this.detail = detail
    this.retryable = retryable
    this.validation = validation
  }
}

export function isOmrConfigured() {
  return Boolean(OMR_API_BASE)
}

function endpoint(path) {
  if (!OMR_API_BASE) {
    throw new OmrRequestError('The PDF to MusicXML service is not configured.', {
      code: 'OMR_NOT_CONFIGURED',
      retryable: false,
    })
  }
  return `${OMR_API_BASE}${path}`
}

function responseError(payload, status) {
  const error = payload?.error || {}
  return new OmrRequestError(error.message || 'The OMR service rejected the request.', {
    code: error.code || `HTTP_${status}`,
    status,
    detail: error.detail || '',
    retryable: error.retryable !== false,
    validation: error.validation || null,
  })
}

function parseJson(text) {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function uploadOmrJob({ file, onProgress = () => {}, signal } = {}) {
  if (!file) {
    return Promise.reject(
      new OmrRequestError('Choose a PDF file first.', {
        code: 'MISSING_FILE',
        retryable: false,
      })
    )
  }

  return new Promise((resolve, reject) => {
    let xhr
    try {
      xhr = new XMLHttpRequest()
    } catch {
      reject(
        new OmrRequestError('This browser cannot upload the PDF.', {
          code: 'UPLOAD_UNSUPPORTED',
          retryable: false,
        })
      )
      return
    }

    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      signal?.removeEventListener?.('abort', abort)
      fn(value)
    }
    const abort = () => {
      try {
        xhr.abort()
      } catch {
        /* already finished */
      }
    }

    xhr.open('POST', endpoint('/api/omr/jobs'))
    xhr.setRequestHeader('Content-Type', 'application/pdf')
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name || 'score.pdf'))
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !event.total) return
      onProgress(Math.round((event.loaded / event.total) * 100))
    }
    xhr.onload = () => {
      const payload = parseJson(xhr.responseText)
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100)
        finish(resolve, payload)
        return
      }
      finish(reject, responseError(payload, xhr.status))
    }
    xhr.onerror = () => {
      finish(
        reject,
        new OmrRequestError(
          'Could not reach the OMR service. Check that the backend is running and its URL is configured.',
          { code: 'NETWORK_ERROR', retryable: true }
        )
      )
    }
    xhr.onabort = () => {
      finish(
        reject,
        new OmrRequestError('The OMR upload was cancelled.', {
          code: 'UPLOAD_ABORTED',
          retryable: true,
        })
      )
    }
    xhr.ontimeout = () => {
      finish(
        reject,
        new OmrRequestError('The OMR upload timed out.', {
          code: 'UPLOAD_TIMEOUT',
          retryable: true,
        })
      )
    }

    if (signal?.aborted) {
      finish(
        reject,
        new OmrRequestError('The OMR upload was cancelled.', {
          code: 'UPLOAD_ABORTED',
          retryable: true,
        })
      )
      return
    }
    signal?.addEventListener?.('abort', abort, { once: true })
    xhr.send(file)
  })
}

export async function getOmrJob(id, { signal } = {}) {
  const response = await fetch(endpoint(`/api/omr/jobs/${encodeURIComponent(id)}`), {
    signal,
    headers: { Accept: 'application/json' },
  })
  const payload = parseJson(await response.text())
  if (!response.ok) throw responseError(payload, response.status)
  return payload
}

export async function fetchOmrMusicXml(id, { signal } = {}) {
  const response = await fetch(endpoint(`/api/omr/jobs/${encodeURIComponent(id)}/musicxml`), {
    signal,
  })
  if (!response.ok) {
    const payload = parseJson(await response.text())
    throw responseError(payload, response.status)
  }
  return response.text()
}

export function musicXmlDownloadUrl(id) {
  return endpoint(`/api/omr/jobs/${encodeURIComponent(id)}/musicxml`)
}

export function jobFailure(job) {
  if (!job?.error) {
    return new OmrRequestError('The PDF could not be converted.', {
      code: 'OMR_FAILED',
      retryable: true,
    })
  }
  return new OmrRequestError(job.error.message, {
    code: job.error.code,
    detail: job.error.detail,
    retryable: job.error.retryable !== false,
    validation: job.error.validation || null,
  })
}
