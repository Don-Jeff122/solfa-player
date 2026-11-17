export class OmrError extends Error {
  constructor(code, message, { status = 500, detail = '', retryable = false, validation = null } = {}) {
    super(message)
    this.name = 'OmrError'
    this.code = code
    this.status = status
    this.detail = detail
    this.retryable = retryable
    this.validation = validation
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
    }
  }
  return {
    code: fallbackCode,
    message: error?.message || 'The OMR service failed.',
    detail: '',
    retryable: true,
    status: 500,
    validation: null,
  }
}
