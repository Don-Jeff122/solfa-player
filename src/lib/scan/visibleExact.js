import { notesOnly } from './notesOnly.js'

export function visibleExactText(text, fullExact = false) {
  return fullExact ? String(text ?? '') : notesOnly(text)
}

export function visibleExactPages(pages = [], fullExact = false) {
  return (pages || [])
    .map((page) => visibleExactText(page?.exactText, fullExact))
    .filter(Boolean)
    .join('\n\n')
}

export function visibleLineCount(text) {
  return String(text || '')
    .split('\n')
    .filter((line) => line.trim()).length
}
