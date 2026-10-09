const BLACK_PCS = [1, 3, 6, 8, 10]

export function isWhiteKey(midi) {
  return !BLACK_PCS.includes(((midi % 12) + 12) % 12)
}

export const RANGE_MIN = 24
export const RANGE_MAX = 108
export const MAX_WHITE_KEYS = 26
export const DEFAULT_RANGE = [48, 83]

const pc = (m) => ((m % 12) + 12) % 12
const snapToC = (m) => m - pc(m)
const snapToB = (m) => m + 11 - pc(m)

/**
 * Chooses a visible keyboard span that covers every sounding note.
 * The span always lands on whole octaves (C to B), the way a real piano
 * groups its keys. Never hides notes: extremely wide ranges are returned
 * in full and the caller is expected to make the keyboard scrollable.
 */
export function fitRange(midiNotes) {
  const sounding = midiNotes.filter((m) => m != null)
  if (!sounding.length) return [...DEFAULT_RANGE]

  let lo = snapToC(Math.max(RANGE_MIN, Math.min(...sounding) - 2))
  let hi = Math.min(snapToB(Math.min(RANGE_MAX, Math.max(...sounding) + 2)), RANGE_MAX)

  let whiteCount = 0
  for (let m = lo; m <= hi; m++) if (isWhiteKey(m)) whiteCount++

  // Trim empty padding on the ends when the music is narrow.
  while (whiteCount > MAX_WHITE_KEYS) {
    const gapLow = sounding.filter((m) => m > lo && m < lo + 12).length
    const gapHigh = sounding.filter((m) => m < hi && m > hi - 12).length
    if (gapLow === 0 && lo < sounding[0] - 1) {
      lo += 12
      while (!isWhiteKey(lo)) lo++
      whiteCount--
      continue
    }
    if (gapHigh === 0 && hi > sounding[sounding.length - 1] + 1) {
      hi -= 12
      while (!isWhiteKey(hi)) hi--
      whiteCount--
      continue
    }
    break
  }

  return [lo, hi]
}
