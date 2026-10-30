import { groupWordsIntoLines } from '../sourceTranscription.js'

/**
 * Turn Tesseract's word confidences into a review list. The exact transcription
 * is never rewritten: the UI shows these tokens beside it so a reader can check
 * them against the page and correct the text themselves.
 */
export function uncertainWords(words = [], { threshold = 70, limit = 250 } = {}) {
  const found = []
  const lines = groupWordsIntoLines(words)

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    for (const word of lines[lineIndex].words) {
      const text = String(word.text ?? '').trim()
      const confidence = Number(word.confidence)
      if (!text || !Number.isFinite(confidence) || confidence >= threshold) continue
      found.push({
        text,
        confidence: Math.round(confidence),
        line: lineIndex + 1,
        bbox: word.bbox,
      })
      if (found.length >= limit) return found
    }
  }

  return found
}
