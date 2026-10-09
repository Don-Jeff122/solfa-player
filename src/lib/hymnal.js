// Real-sheet (Ghanaian hymnal / "new tonic solfa") notation support.
//
// A church sheet spells things slightly differently from classic word-solfa:
//
//   - `:` and `/` are beat gridlines: every marker advances one beat slot.
//   - `-` holds a beat; `0` is a rest; a note letter is one beat.
//   - A subscript digit (f1, t₁) means an octave below, as it is printed.
//   - The meters are often hidden: a bar like `m :- /m :r` is four beats.
//   - Real chromatics: de fe se le lo ta stand for di fi si li le te, while
//     `se`/`le` flip from the classic lowered so/la to the raised si/li.
//
// A braced block (`{ ... }`) carries one musical line across the four voices;
// rows become Soprano, Alto, Tenor, Bass in order.

import { LETTER_TO_SOLFA } from './notes.js'

export const HYMN_WORDS = Object.freeze({
  ...LETTER_TO_SOLFA,
  so: 'so',
  sol: 'so',
  di: 'di',
  ri: 'ri',
  fi: 'fi',
  si: 'si',
  li: 'li',
  ra: 'ra',
  me: 'me',
  se: 'si',
  le: 'li',
  te: 'te',
  de: 'di',
  e: 'di',
  fe: 'fi',
  lo: 'le',
  ta: 'te',
  rest: 'rest',
})

export const HYMN_ROW_VOICES = ['Soprano', 'Alto', 'Tenor', 'Bass']

// "S: d :d", "A1: m :-", "L: O nyan ko pon" — the domisol-style row headers.
// Uppercase only: a lower-case row like `s :- /s :f` is a solfa line, not a
// voice header, and must stay in its braced block.
export const HYMN_PREFIX_RE = /^\s*([SATBL])\d*\s*[:：](.*)$/
export const HYMN_PREFIX_NAME = { s: 'Soprano', a: 'Alto', t: 'Tenor', b: 'Bass' }

const MARKING_RE = /^(?:d\.?s\.?|d\.?c\.?|fine|coda|segno|dal|capo|da)$/i
const ENDING_RE = /^(?:\(([12])\)|([12])\.)/
const ENDING_UNSUPPORTED_RE = /^(?:\(\d+\)|\d+\.)$/
const SUBSCRIPT_MARKS = ['\u2081', '\u2082', '\u2083']

/**
 * A note line is real-sheet style when it carries the glyphs only real sheets
 * use: `/`, braces, a part header, or a bare beat-colon. Repeat bar-lines
 * (`|:`, `:|`) and plain `|` belong to classic sheets too, so a `:` glued to a
 * bar glyph is ignored here — that keeps every existing repeat sheet classic.
 */
export function looksHymnal(line) {
  if (!line) return false
  if (/\{|\}/.test(line)) return true
  // A length like Fi(1/2) is classic syntax: strip fraction parens before the
  // slash check, since only a bare / is a real-sheet beat marker.
  const withoutFractions = line.replace(/\(\d{1,3}(?:\/\d{1,3})?\)/g, '')
  if (withoutFractions.includes('/')) return true
  if (/^\s*[SATBL]\d*\s*[:：]/.test(line)) return true
  const stripped = line.replace(/[:]?[|‖]{1,2}[:]?/g, '')
  return stripped.includes(':')
}

/**
 * Turn one note line into a flat list of events. Holds fold into the previous
 * sound (so `m :-` is a two-beat mi), and two parts squeezed into one beat
 * split it equally, which is how eighth-note pairs are sometimes printed.
 */
export function scanHymnalLine(text, lineNo, partName) {
  const s = String(text ?? '')
  const events = []
  let i = 0
  let cell = { parts: [], subdivided: false }
  let lastSound = null
  let justEnded = false

  const fail = (message) => ({ ok: false, message })

  const finalizeCell = () => {
    const { parts, subdivided } = cell
    if (parts.length === 0) return
    const share = subdivided ? 1 / parts.length : 1
    for (const part of parts) {
      if (part.type === 'hold') {
        if (lastSound) lastSound.beats += share
        else events.push({ type: 'note', token: '-', solfa: null, up: 0, down: 0, beats: share })
        continue
      }
      const beats = subdivided ? share : 1 + (part.extra || 0)
      const ev =
        part.type === 'rest'
          ? { type: 'note', token: '0', solfa: null, up: 0, down: 0, beats }
          : { type: 'note', token: part.token, solfa: part.solfa, up: part.up, down: part.down, beats }
      events.push(ev)
      lastSound = ev
    }
    cell = { parts: [], subdivided: false }
  }

  const matchBarTokenAt = (idx) => {
    const m = s.slice(idx).match(/^(:?)([|‖])([|‖]?)(:?)/)
    if (!m || !m[2]) return null
    const [, leading, bar1, bar2, trailing] = m
    const closeOpen = leading === ':' && trailing === ':'
    const open = (leading === '' && trailing === ':') || closeOpen
    const close = (leading === ':' && trailing === '') || closeOpen
    const double = bar1 + bar2 === '||' || bar1 + bar2 === '\u2016\u2016'
    return { len: m[0].length, attrs: { open, close, closeOpen, double } }
  }

  while (i < s.length) {
    const ch = s[i]

    if (ch === ' ' || ch === '\t' || ch === '{' || ch === '}') {
      justEnded = false
      i++
      continue
    }

    if (ch === ':' || ch === '/' || ch === '.') {
      const bar = matchBarTokenAt(i)
      if (bar) {
        finalizeCell()
        events.push({ type: 'bar', attrs: bar.attrs })
        i += bar.len
      } else {
        finalizeCell()
        i++
      }
      justEnded = false
      continue
    }

    if (ch === '|' || ch === '\u2016') {
      const bar = matchBarTokenAt(i)
      finalizeCell()
      events.push({
        type: 'bar',
        attrs: bar ? bar.attrs : { open: false, close: false, closeOpen: false, double: false },
      })
      i += bar ? bar.len : 1
      justEnded = false
      continue
    }

    if (/[0-9]/.test(ch)) {
      const sub = s.slice(i)
      const em = sub.match(ENDING_RE)
      if (em) {
        finalizeCell()
        events.push({ type: 'ending', n: Number(em[1] || em[2]) })
        i += em[0].length
        justEnded = false
        continue
      }
      if (ch === '0') {
        if (cell.parts.length) cell.subdivided = true
        cell.parts.push({ type: 'rest' })
        i++
        justEnded = true
        continue
      }
      const uem = sub.match(ENDING_UNSUPPORTED_RE)
      if (uem) {
        return fail(
          `"${uem[0]}" on line ${lineNo} (part "${partName}"): only first/second endings (1. / 2.) are supported.`
        )
      }
      return fail(`Unexpected number "${ch}" on line ${lineNo} (part "${partName}").`)
    }

    if (ch === '-') {
      const last = cell.parts[cell.parts.length - 1]
      if (cell.parts.length === 0) {
        cell.parts.push({ type: 'hold' })
      } else if (!cell.subdivided && last && last.type === 'note' && justEnded) {
        last.extra += 1
      } else {
        cell.parts.push({ type: 'hold' })
        cell.subdivided = true
      }
      i++
      justEnded = true
      continue
    }

    if (/[a-zA-Z]/.test(ch)) {
      let j = i
      while (j < s.length && /[a-zA-Z]/.test(s[j])) j++
      const raw = s.slice(i, j)
      const word = raw.toLowerCase()
      let solfa = null
      if (Object.prototype.hasOwnProperty.call(HYMN_WORDS, word)) solfa = HYMN_WORDS[word]
      if (solfa == null && MARKING_RE.test(word)) {
        return fail(
          `"${raw}" on line ${lineNo} (part "${partName}"): D.S./D.C., Fine and coda markings aren't supported yet.`
        )
      }
      if (solfa == null) {
        return fail(
          `Unrecognized note "${raw}" on line ${lineNo} (part "${partName}"). ` +
            `Real sheets use d r m f s l t (or de fe se le lo ta) with : and / between beats and - for holds.`
        )
      }
      i = j
      let up = 0
      let down = 0
      while (
        i < s.length &&
        (s[i] === ',' || s[i] === "'" || s[i] === '\u2019' || SUBSCRIPT_MARKS.includes(s[i]))
      ) {
        if (s[i] === ',' || SUBSCRIPT_MARKS.includes(s[i])) down++
        else up++
        i++
      }
      if (cell.parts.length) cell.subdivided = true
      if (solfa === 'rest') {
        cell.parts.push({ type: 'rest' })
      } else {
        cell.parts.push({ type: 'note', token: raw, solfa, up, down, extra: 0 })
      }
      justEnded = true
      continue
    }

    return fail(`Unrecognized character "${ch}" on line ${lineNo} (part "${partName}").`)
  }

  finalizeCell()
  return { ok: true, events }
}