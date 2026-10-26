export const MAX_SCAN_UPLOAD_MB = 25
export const SCAN_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.pdf']

export function validateScanFile(file, maxMb = MAX_SCAN_UPLOAD_MB) {
  if (!file) return 'Choose an image or PDF to scan.'
  const name = String(file.name || '').toLowerCase()
  const extension = SCAN_EXTENSIONS.find((ext) => name.endsWith(ext))
  if (!extension) return 'Upload a PNG, JPG, JPEG or PDF file.'
  if (!file.size) return 'That file is empty.'
  if (file.size > maxMb * 1024 * 1024) {
    return `That file is larger than ${maxMb} MB.`
  }
  return null
}

export function rebuildLineText(line) {
  const original = line.raw_text || line.text || ''
  let cursor = 0
  let text = ''
  const chars = [...(line.chars || [])].sort((a, b) => a.offset - b.offset)
  for (const char of chars) {
    if (char.offset < cursor || char.offset >= original.length) continue
    text += original.slice(cursor, char.offset)
    text += char.text
    cursor = char.offset + 1
  }
  return text + original.slice(cursor)
}

export function patchPageChar(page, charId, text) {
  if (!page) return page
  let changed = false
  const lines = page.lines.map((line) => {
    if (!line.chars.some((char) => char.id === charId)) return line
    changed = true
    const chars = line.chars.map((char) =>
      char.id === charId
        ? {
            ...char,
            text,
            corrected: true,
            uncertain: false,
            confidence: 1,
          }
        : char
    )
    const next = { ...line, chars }
    return { ...next, text: rebuildLineText(next), uncertain: chars.some((c) => c.uncertain) }
  })
  if (!changed) return page
  return {
    ...page,
    lines,
    uncertain_count: lines.reduce(
      (count, line) => count + line.chars.filter((char) => char.uncertain && !char.corrected).length,
      0
    ),
  }
}

export function findChar(page, charId) {
  if (!page || !charId) return null
  for (const line of page.lines) {
    const char = line.chars.find((item) => item.id === charId)
    if (char) return { char, line }
  }
  return null
}

export function countUncertain(page) {
  if (!page) return 0
  return page.lines.reduce(
    (count, line) => count + line.chars.filter((char) => char.uncertain && !char.corrected).length,
    0
  )
}

export function orderedPages(pageMap) {
  return Object.values(pageMap || {}).sort((a, b) => a.page - b.page)
}

export function pagesToText(pageMap, { pageMarkers = true } = {}) {
  const pages = orderedPages(pageMap)
  return pages
    .map((page) => {
      const text = page.text || ''
      if (!pageMarkers || pages.length === 1) return text
      return `--- Page ${page.page} ---\n${text}`
    })
    .join('\n\n')
}

export function pagesToPlayerText(pageMap) {
  return orderedPages(pageMap)
    .map((page) => page.text || '')
    .filter(Boolean)
    .join('\n\n')
}

export function baseName(filename) {
  return String(filename || 'solfa-scan')
    .replace(/\.(png|jpe?g|pdf)$/i, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'solfa-scan'
}

function xmlEscape(value) {
  const text = Array.from(String(value))
    .filter((char) => {
      const code = char.codePointAt(0)
      const validRange = code === 9 || code === 10 || code === 13 || code >= 32
      return validRange && !(code >= 0xd800 && code <= 0xdfff)
    })
    .join('')
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export function pagesToSvg(pageMap, { padding = 24, gap = 36 } = {}) {
  const pages = orderedPages(pageMap)
  if (!pages.length) return ''
  const width = Math.max(...pages.map((page) => page.width), 1) + padding * 2
  let y = padding
  const body = []
  for (const page of pages) {
    body.push(
      `<rect x="${padding}" y="${y}" width="${page.width}" height="${page.height}" fill="#fffdf7" stroke="#c9c2b4"/>`
    )
    for (const rule of page.rules || []) {
      body.push(
        `<line x1="${padding + rule.x0}" y1="${y + rule.y0}" x2="${padding + rule.x1}" y2="${y + rule.y1}" stroke="#1b1b1b" stroke-width="${rule.orientation === 'vertical' ? 2 : 1.5}"/>`
      )
    }
    for (const line of page.lines || []) {
      const height = line.bbox.y1 - line.bbox.y0
      if (line.underline) {
        body.push(
          `<line x1="${padding + line.underline.x0}" y1="${y + line.underline.y0}" x2="${padding + line.underline.x1}" y2="${y + line.underline.y1}" stroke="#1b1b1b" stroke-width="${Math.max(1, height * 0.06)}"/>`
        )
      }
      const lineHeight = line.bbox.y1 - line.bbox.y0
      const lineWidth = Math.max(line.bbox.x1 - line.bbox.x0, 1)
      const fontSize = Math.max(lineHeight * 0.8, 4)
      const baseline = y + line.bbox.y1 - lineHeight * 0.16
      body.push(
        `<text x="${(padding + line.bbox.x0).toFixed(2)}" y="${baseline.toFixed(2)}" textLength="${lineWidth.toFixed(2)}" lengthAdjust="spacingAndGlyphs" xml:space="preserve" font-family="Arial,'Helvetica Neue',sans-serif" font-size="${fontSize.toFixed(2)}" fill="#171717">${xmlEscape(line.text || line.raw_text || '')}</text>`
      )
    }
    y += page.height + gap
  }
  const height = y - gap + padding
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="100%" height="100%" fill="#e8e2d5"/>`,
    ...body,
    '</svg>',
  ].join('\n')
}

export function downloadBlob(content, type, filename) {
  const blob = content instanceof Blob ? content : new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
