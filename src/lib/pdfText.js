export function textItemsToLines(items = []) {
  const glyphs = []

  for (const item of items || []) {
    const text = String(item?.str ?? '')
    if (!text.trim()) continue
    const transform = item.transform || []
    const x = Number(transform[4] ?? 0)
    const y = Number(transform[5] ?? 0)
    const height = Math.abs(Number(transform[3] ?? item.height ?? 10)) || 10
    const width = Number(item.width ?? 0) || text.length * height * 0.5
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    glyphs.push({ text, x, y, width, height })
  }

  glyphs.sort((a, b) => b.y - a.y || a.x - b.x)

  const lines = []
  for (const glyph of glyphs) {
    const tolerance = Math.max(2, glyph.height * 0.35)
    let line = lines.find((candidate) => Math.abs(candidate.y - glyph.y) <= tolerance)
    if (!line) {
      line = { y: glyph.y, height: glyph.height, items: [] }
      lines.push(line)
    }
    line.items.push(glyph)
    line.y = (line.y + glyph.y) / 2
    line.height = Math.max(line.height, glyph.height)
  }

  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) => {
      const sorted = [...line.items].sort((a, b) => a.x - b.x)
      let text = ''
      let previous = null
      for (const glyph of sorted) {
        if (previous) {
          const gap = glyph.x - (previous.x + previous.width)
          if (gap > Math.max(3, glyph.height * 0.22)) text += ' '
        }
        text += glyph.text
        previous = glyph
      }
      return {
        text: text.replace(/\s+/g, ' ').trim(),
        y: line.y,
        items: sorted,
      }
    })
    .filter((line) => line.text)
}

export function pagesTextLayerToText(pages = []) {
  return (pages || [])
    .map((page) =>
      (page?.textLayer || [])
        .map((line) => (typeof line === 'string' ? line : line?.text || ''))
        .filter(Boolean)
        .join('\n')
    )
    .filter(Boolean)
    .join('\n')
}
