import { describe, expect, it } from 'vitest'
import { recognizePages, tryTextLayer } from '../sheetRecognition.js'

describe('sheet recognition dispatch', () => {
  it('uses a hymnal text layer before OCR', () => {
    const result = tryTextLayer('Doh = A\nS: d | r\nA: f | s')
    expect(result.mode).toBe('text')
    expect(result.ok).toBe(true)
    expect(result.key).toBe('A')
    expect(result.text).toContain('S: d | r')
  })

  it('accepts a classic solfa text layer', () => {
    const result = tryTextLayer('Do Re Mi Fa')
    expect(result.mode).toBe('text')
    expect(result.ok).toBe(true)
    expect(result.text.trim()).toBeTruthy()
  })

  it('falls back to the hymnal reader for a four-part page', async () => {
    const result = await recognizePages(
      [{ text: 'Doh = A\nS: d | r', canvas: null }],
      {
        hymnal: async () => ({
          ok: true,
          text: 'Doh = A\nS: d | r',
          key: 'A',
          confidence: 80,
          warnings: [],
          bars: 2,
          rows: 4,
          systems: 1,
        }),
      }
    )

    expect(result.mode).toBe('hymnal')
    expect(result.ok).toBe(true)
    expect(result.key).toBe('A')
  })

  it('falls back to classic solfa when no layout is found', async () => {
    const result = await recognizePages([{ text: 'Do Re Mi', canvas: null }], {
      hymnal: async () => ({
        ok: false,
        reason: 'no-layout',
        text: '',
        key: null,
        warnings: [],
      }),
    })

    expect(result.mode).toBe('classic')
    expect(result.ok).toBe(true)
    expect(result.text).toContain('d')
  })
})
