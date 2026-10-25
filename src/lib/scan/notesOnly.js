const PART_LABEL_RE =
  /^\s*(?:\[?\s*(?:soprano|alto|tenor|bass|treble|lead)\s*\]?\s*\d*|part\s*[SATBL]?\s*\d*|[SATBL]\d*)\s*[:：]\s*/i
const SECTION_LABEL_RE = /^\s*(?:verse|chorus|refrain|section|stanza)\s*\d*\s*[:.]\s*/i
const HEADING_RE =
  /^(?:key|doh|tonic|meter|time|tempo|title|hymn|song|page|part)\b/i
const NOTE_WORD_RE =
  /^(?:do|re|ray|mi|fa|so|sol|la|ti|si|di|ri|fi|li|ra|me|se|le|te|d|r|m|f|s|l|t)$/i
const NOTE_CHARS_RE = /^[drmfslt]+$/i

function isNoteWord(word) {
  return NOTE_WORD_RE.test(word) || NOTE_CHARS_RE.test(word)
}

function noteLine(body) {
  if (!body || body.includes('=') || HEADING_RE.test(body)) return false
  const words = body.match(/[A-Za-z]+/g) || []
  if (!words.length) return false
  const notes = words.filter(isNoteWord).length
  return notes > 0 && notes * 2 >= words.length
}

export function notesOnly(text) {
  const lines = []
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine
      .trim()
      .replace(PART_LABEL_RE, '')
      .replace(SECTION_LABEL_RE, '')
      .trim()
    if (noteLine(line)) lines.push(line)
  }
  return lines.join('\n')
}
