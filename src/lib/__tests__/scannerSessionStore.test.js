import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearScannerSession,
  createScannerSessionWriter,
  loadScannerSession,
  normalizeScannerState,
  saveScannerFile,
  saveScannerState,
} from '../scannerSessionStore.js'

function page(pageNumber, text = `Page ${pageNumber}`) {
  return {
    pageNumber,
    index: pageNumber - 1,
    exactText: text,
    sheetText: text,
    playable: {
      mode: 'hymnal',
      ok: true,
      text,
      sheetText: text,
      key: 'C',
      warnings: [],
      systemsData: [],
      rows: 0,
      bars: 0,
      parseError: null,
      error: null,
    },
  }
}

function session(overrides = {}) {
  return {
    docId: 'doc-1',
    scanMode: 'solfa',
    docInfo: { name: 'hymn.pdf', kind: 'pdf', pageCount: 3 },
    pageResults: [page(1, 'Do Re Mi'), page(2, 'So La Ti')],
    batchFailures: [
      { pageNumber: 3, message: 'Gemini timed out.', status: 504, code: 'TIMEOUT' },
    ],
    pageIndex: 1,
    rotation: 90,
    zoom: 1.5,
    ...overrides,
  }
}

function source(name = 'hymn.pdf') {
  return new File(['pdf-data'], name, {
    type: 'application/pdf',
    lastModified: 1234,
  })
}

beforeEach(async () => {
  await clearScannerSession()
})

describe('scannerSessionStore', () => {
  it('round-trips page results, failures and the source file', async () => {
    const saved = await saveScannerState(session())
    expect(saved.ok).toBe(true)

    const file = await saveScannerFile(source(), 'doc-1')
    expect(file.ok).toBe(true)

    const loaded = await loadScannerSession()
    expect(loaded).toMatchObject({
      docId: 'doc-1',
      scanMode: 'solfa',
      pageIndex: 1,
      rotation: 90,
      zoom: 1.5,
      docInfo: { name: 'hymn.pdf', kind: 'pdf', pageCount: 3 },
    })
    expect(loaded.pageResults).toEqual([page(1, 'Do Re Mi'), page(2, 'So La Ti')])
    expect(loaded.batchFailures).toEqual([
      { pageNumber: 3, message: 'Gemini timed out.', status: 504, code: 'TIMEOUT' },
    ])
    expect(loaded.file).toMatchObject({
      name: 'hymn.pdf',
      type: 'application/pdf',
      lastModified: 1234,
      size: 8,
    })
    expect(await loaded.file.blob.text()).toBe('pdf-data')
  })

  it('keeps results when the source file is missing or belongs to another document', async () => {
    await saveScannerState(session())
    await saveScannerFile(source('other.pdf'), 'doc-2')

    const loaded = await loadScannerSession()
    expect(loaded.file).toBeNull()
    expect(loaded.pageResults).toHaveLength(2)
  })

  it('clamps invalid view state and derives the page count from results', () => {
    const normalized = normalizeScannerState({
      version: 1,
      scanMode: 'unknown',
      docInfo: { name: 'hymn.pdf', kind: 'pdf', pageCount: 1 },
      pageResults: [page(4)],
      batchFailures: [
        { pageNumber: 8, message: 'outside document' },
        { pageNumber: 2, message: 'no status' },
        { pageNumber: 1, message: 'valid' },
      ],
      pageIndex: 99,
      rotation: -90,
      zoom: 99,
    })

    expect(normalized).toMatchObject({
      scanMode: 'solfa',
      pageIndex: 3,
      rotation: 270,
      zoom: 3,
      docInfo: { pageCount: 4 },
      batchFailures: [
        { pageNumber: 1, message: 'valid', status: null, code: null },
        { pageNumber: 2, message: 'no status', status: null, code: null },
      ],
    })
  })

  it('derives document metadata when only results were saved', () => {
    const normalized = normalizeScannerState({
      scanMode: 'general',
      pageResults: [page(3)],
    })

    expect(normalized.docInfo).toEqual({
      name: 'Gemini result',
      kind: 'image',
      pageCount: 3,
    })
    expect(normalized.pageIndex).toBe(0)
  })

  it('rejects unsupported versions and clears both records', async () => {
    expect(normalizeScannerState({ ...session(), version: 99 })).toBeNull()

    await saveScannerState(session())
    await saveScannerFile(source(), 'doc-1')
    await clearScannerSession()

    expect(await loadScannerSession()).toBeNull()
  })

  it('coalesces debounced writes to the latest snapshot', async () => {
    const writer = createScannerSessionWriter({ delayMs: 5 })
    writer.save(session({ pageIndex: 0 }))
    writer.save(session({ pageIndex: 2 }))
    await new Promise((resolve) => setTimeout(resolve, 30))

    const loaded = await loadScannerSession()
    expect(loaded.pageIndex).toBe(2)
  })

  it('cannot resurrect a session with a pending write after clear', async () => {
    const writer = createScannerSessionWriter({ delayMs: 20 })
    await writer.saveNow(session())
    writer.save(session({ pageIndex: 0 }))
    await writer.clear()
    await new Promise((resolve) => setTimeout(resolve, 40))

    expect(await loadScannerSession()).toBeNull()
  })
})
