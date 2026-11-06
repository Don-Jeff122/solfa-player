const DOH_KEY_RE = /\bdoh\s*[:=]\s*([a-gA-G])([#b\u266d\u266f]?)/i
const KEY_RE = /\b(?:key|tonic)\s*[:=]?\s*([a-gA-G])([#b\u266d\u266f]?)/i

function normalizeAccidental(letter, accidental) {
  const mark = accidental === '\u266d' ? 'b' : accidental === '\u266f' ? '#' : accidental || ''
  return `${letter.toUpperCase()}${mark}`
}

export function keyFromHymnalText(text) {
  const value = String(text ?? '')
  const doh = value.match(DOH_KEY_RE)
  if (doh) return normalizeAccidental(doh[1], doh[2])
  const key = value.match(KEY_RE)
  if (key) return normalizeAccidental(key[1], key[2])
  return null
}

export function assembleHymnalSheet({ key, systems = [] } = {}) {
  const lines = []
  if (key) lines.push(`Doh = ${key}`)
  for (const system of systems) {
    for (const row of system.rows || []) {
      const cells = (row.cells || []).map((cell) => String(cell ?? '').trim() || '0')
      if (!cells.length) continue
      lines.push(`${row.voice}: ${cells.join(' | ')}`)
    }
  }
  return lines.join('\n')
}

function sheetSafeLine(text) {
  const value = String(text ?? '').trim()
  if (!value) return ''
  if (/^\s*L\d*\s*[:|]/i.test(value)) return value
  return /[{}|:/-]/.test(value) ? `L: ${value}` : value
}

function sheetSafeHeader(text) {
  const value = String(text ?? '').trim()
  if (!value || keyFromHymnalText(value)) return value
  return sheetSafeLine(value)
}

export function assembleHymnalSheetLayout({ key, headerLines = [], systems = [] } = {}) {
  const lines = []
  const headers = (headerLines || []).map(sheetSafeHeader).filter(Boolean)
  const hasKey = headers.some((line) => keyFromHymnalText(line))
  lines.push(...headers)
  if (key && !hasKey) lines.push(`Doh = ${key}`)

  for (const system of systems) {
    const rows = system.rows || []
    rows.forEach((row, index) => {
      const cells = (row.cells || []).map((cell) => String(cell ?? '').trim() || '0')
      if (!cells.length) return
      const prefix = index === 0 ? '{ ' : '  '
      lines.push(`${prefix}| ${cells.join(' | ')} |`)
    })
    for (const lyric of system.lyrics || []) {
      const line = sheetSafeLine(lyric)
      if (line) lines.push(`  ${line}`)
    }
    if (rows.length) lines.push('}')
  }

  return lines.join('\n')
}
