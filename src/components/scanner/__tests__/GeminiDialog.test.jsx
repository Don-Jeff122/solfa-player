import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import GeminiDialog from '../GeminiDialog.jsx'

function renderDialog(overrides = {}) {
  return renderToStaticMarkup(
    createElement(GeminiDialog, {
      open: true,
      mode: 'solfa',
      busy: false,
      error: '',
      onCancel: () => {},
      onConfirm: () => {},
      ...overrides,
    })
  )
}

describe('GeminiDialog', () => {
  it('explains the page upload and solfa result', () => {
    const html = renderDialog()

    expect(html).toContain('Read with Gemini')
    expect(html).toContain('four-part solfa sheet')
    expect(html).toContain('Only the current page image is sent')
    expect(html).toContain('Send this page to Gemini')
    expect(html).toContain('never in this browser')
  })

  it('uses document wording in general mode', () => {
    const html = renderDialog({ mode: 'general' })

    expect(html).toContain('editable document text')
    expect(html).not.toContain('four-part solfa sheet')
  })

  it('shows progress and errors while open', () => {
    const html = renderDialog({ busy: true, error: 'Gemini is busy.' })

    expect(html).toContain('Reading with Gemini')
    expect(html).toContain('Gemini is busy.')
  })

  it('renders nothing while closed', () => {
    expect(renderDialog({ open: false })).toBe('')
  })
})
