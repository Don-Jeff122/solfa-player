export class OmrError extends Error {
  constructor(
    code,
    message,
    { status = 500, detail = '', retryable = false, validation = null, retryAfter = null } = {}
  ) {
    super(message)
    this.name = 'OmrError'
    this.code = code
    this.message = message
    this.status = status
    this.detail = detail
    this.retryable = retryable
    this.validation = validation
    this.retryAfter = retryAfter
  }
}

export function errorDetails(error, fallbackCode = 'OMR_FAILED') {
  if (error instanceof OmrError) {
    return {
      code: error.code,
      message: error.message,
      detail: error.detail,
      retryable: error.retryable,
      status: error.status,
      validation: error.validation,
      retryAfter: error.retryAfter,
    }
  }
  return {
    code: fallbackCode,
    message: error?.message || 'The OMR service failed.',
    detail: '',
    retryable: true,
    status: 500,
    validation: null,
    retryAfter: null,
  }
}
