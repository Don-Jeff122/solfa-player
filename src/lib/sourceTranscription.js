const BAR_TOKEN_RE = /^[:|‖/]+$/

function centreY(word) {
  return (word.bbox.y0 + word.bbox.y1) / 2
}

function centreX(word) {
  return (word.bbox.x0 + word.bbox.x1) / 2
}

function wordHeight(word) {
  return Math.max(1, word.bbox.y1 - word.bbox.y0)
}

function joinWords(words) {
  const sorted = [...words].sort((a, b) => a.bbox.x0 - b.bbox.x0)
  let text = ''
  let previous = null

  for (const word of sorted) {
    const value = String(word.text ?? '')
    if (!value) continue
    if (previous) {
      const gap = word.bbox.x0 - previous.bbox.x1
      const tolerance = Math.max(2, Math.min(wordHeight(word), wordHeight(previous)) * 0.25)
      if (gap > tolerance) text += ' '
    }
    text += value
    previous = word
  }

  return text
}

export function groupWordsIntoLines(words = []) {
  const sorted = (words || [])
    .filter((word) => word?.bbox && String(word.text ?? '').trim())
    .sort((a, b) => centreY(a) - centreY(b) || a.bbox.x0 - b.bbox.x0)
  const lines = []

  for (const word of sorted) {
    const y = centreY(word)
    const height = wordHeight(word)
    const line = lines.find(
      (candidate) =>
        Math.abs(candidate.y - y) <= Math.max(2, Math.max(candidate.height, height) * 0.4)
    )

    if (!line) {
      lines.push({ y, height, words: [word] })
      continue
    }

    const count = line.words.length
    line.y = (line.y * count + y) / (count + 1)
    line.height = Math.max(line.height, height)
    line.words.push(word)
  }

  return lines.sort((a, b) => a.y - b.y)
}

function noteLine(line, systems) {
  for (const system of systems || []) {
    for (const row of system.rows || []) {
      if (line.y >= row.top - 2 && line.y <= row.bottom + 2) return system
    }
  }
  return null
}

function barTokenMap(words, barLines) {
  const tokens = new Map()

  for (const word of words) {
    const value = String(word.text ?? '').trim()
    if (!value || !BAR_TOKEN_RE.test(value)) continue
    const x = centreX(word)
    let nearest = -1
    let distance = Infinity
    for (let i = 0; i < barLines.length; i++) {
      const next = Math.abs(barLines[i] - x)
      if (next < distance) {
        distance = next
        nearest = i
      }
    }
    if (nearest < 0 || distance > Math.max(4, wordHeight(word) * 0.75)) continue
    tokens.set(nearest, word)
  }

  return tokens
}

function renderNoteLine(line, system) {
  const barLines = (system.barLines || []).map(Number)
  if (barLines.length < 2) return joinWords(line.words)

  const ranges = []
  for (let i = 0; i < barLines.length - 1; i++) {
    const left = barLines[i]
    const right = barLines[i + 1]
    if (right - left < 2) continue
    ranges.push({ left, right, leftIndex: i, rightIndex: i + 1 })
  }
  if (!ranges.length) return joinWords(line.words)

  const tokens = barTokenMap(line.words, barLines)
  const used = new Set()
  const prefix = tokens.get(ranges[0].leftIndex)
  const suffix = tokens.get(ranges[ranges.length - 1].rightIndex)
  if (prefix) used.add(prefix)
  if (suffix) used.add(suffix)

  const separators = []
  for (let i = 0; i < ranges.length - 1; i++) {
    const token = tokens.get(ranges[i].rightIndex)
    if (token) used.add(token)
    separators.push(token?.text?.trim() || '|')
  }

  const cells = ranges.map(() => [])
  for (const word of line.words) {
    if (used.has(word)) continue
    const x = centreX(word)
    let index = ranges.findIndex((range) => x >= range.left && x < range.right)
    if (index < 0) index = x < ranges[0].left ? 0 : ranges.length - 1
    cells[index].push(word)
  }

  const cellTexts = cells.map((cell) => joinWords(cell))
  let start = 0
  let end = cellTexts.length - 1
  while (start <= end && !cellTexts[start]) start += 1
  while (end >= start && !cellTexts[end]) end -= 1
  if (start > end) return joinWords(line.words)

  const keptCells = cellTexts.slice(start, end + 1)
  const keptSeparators = separators.slice(start, end)
  let text = keptCells[0]
  for (let i = 1; i < keptCells.length; i++) {
    text += ` ${keptSeparators[i - 1]} ${keptCells[i]}`
  }
  if (prefix) text = `${prefix.text.trim()} ${text}`
  if (suffix) text = `${text} ${suffix.text.trim()}`
  return text.trim()
}

export function sourceTranscription(words = [], systems = []) {
  return groupWordsIntoLines(words)
    .map((line) => {
      const system = noteLine(line, systems)
      return system ? renderNoteLine(line, system) : joinWords(line.words)
    })
    .filter(Boolean)
    .join('\n')
}
