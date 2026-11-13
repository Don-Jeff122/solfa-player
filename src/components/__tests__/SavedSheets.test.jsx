import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import SavedSheets from '../SavedSheets.jsx'

const sheets = [
  { id: '1', name: 'Morning hymn', text: 'Do Re Mi', savedAt: Date.now() },
  { id: '2', name: 'Evening', text: 'So La Ti', savedAt: 0 },
]

function renderLibrary(overrides = {}) {
  return renderToStaticMarkup(
    createElement(SavedSheets, {
      sheets,
      activeId: '1',
      undo: null,
      onLoad: () => {},
      onDelete: () => {},
      onUndoDelete: () => {},
      onRename: () => ({ ok: true, name: 'Renamed' }),
      onDuplicate: () => ({ ok: true, name: 'Morning hymn (copy)' }),
      onExport: () => ({ ok: true, count: sheets.length }),
      onImport: async () => ({ ok: true, imported: 1, renamed: 0, skipped: 0, dropped: 0 }),
      ...overrides,
    })
  )
}

describe('SavedSheets', () => {
  it('shows search, backup and sheet actions', () => {
    const html = renderLibrary()

    expect(html).toContain('Search names or notes')
    expect(html).toContain('Export')
    expect(html).toContain('Import')
    expect(html).toContain('Morning hymn')
    expect(html).toContain('Loaded')
    expect(html).toContain('Rename')
    expect(html).toContain('Copy')
    expect(html).toContain('Delete')
  })

  it('keeps import available for an empty library', () => {
    const html = renderLibrary({ sheets: [], activeId: null })

    expect(html).toContain('No saved sheets yet')
    expect(html).toContain('Import')
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Export<\/button>/)
    expect(html).toMatch(/<input[^>]*type="search"[^>]*disabled/)
  })

  it('shows the undo bar after a delete', () => {
    const html = renderLibrary({
      undo: { sheet: sheets[1], index: 1, wasActive: false },
    })

    expect(html).toContain('Deleted “Evening”.')
    expect(html).toContain('Undo')
  })
})
