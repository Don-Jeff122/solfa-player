import { LETTER_TO_SOLFA, keyToSemitones, normalizeKey } from './notes.js'
import {
  HYMN_PREFIX_NAME,
  HYMN_PREFIX_RE,
  HYMN_ROW_VOICES,
  looksHymnal,
  scanHymnalLine,
} from './hymnal.js'

const KEY_COLON_RE = /^\s*(?:key|tonic)\s*[:=]\s*([a-gA-G][#b]?|[a-zA-Z])?\s*$/i
const KEY_EQ_RE = /^\s*1\s*=\s*([a-gA-G][#b]?|[a-zA-Z])?\s*$/i
// "Doh = A" — the tonic-sol-fa header printed on Ghanaian hymn sheets.
const DOH_KEY_RE = /^\s*doh\s*[:=]\s*([a-gA-G][#b]?)\s*$/i
// "Key E Flat", "key f#", "tonic bb" — the word forms printed on hymn sheets.
// Not anchored at the end: printed headers carry trailing text like a composer
// or poetic metre ("Key E Flat  10.10.10.10.  W.H. MONK 1823-1889.").
const KEY_WORD_RE = /^\s*(?:key|tonic)\s*(?:[:=]\s*)?([a-gA-G])(?:\s*(flat|♭|b|sharp|♯|#|is))?/i
const KEY_WORD_SUFFIX = { flat: 'b', '\u266d': 'b', b: 'b', sharp: '#', '\u266f': '#', '#': '#', is: '#' }
const PART_KEYWORD_RE = /^\s*(bass|tenor|alto|soprano)\s*:?\s*$/i
const CUSTOM_PART_RE = /^\s*\[\s*([^\]]{1,40}?)\s*\]\s*$/

/**
 * The key letter a header line names, normalized to read as C, D#, Eb, Bb...
 * Returns null when the line is not a key header at all.
 */
function keyFromHeader(line) {
  let m = line.match(KEY_COLON_RE) || line.match(KEY_EQ_RE) || line.match(DOH_KEY_RE)
  if (m) return (m[1] ?? '').trim()
  m = line.match(KEY_WORD_RE)
  if (m) return m[1] + (m[2] ? KEY_WORD_SUFFIX[m[2].toLowerCase()] : '')
  return null
}
const NOTE_TOKEN_RE =
  /^(,*)(sol|so|do|re|mi|fa|la|ti|di|ri|fi|si|li|ra|me|se|le|te|[dDmMrRfFtTsSlL])(['’,]*)(-+|\(\d{1,3}(?:\/\d{1,3})?\))?(\.*)$/i
const REST_WORD_RE = /^rest(-+|\(\d{1,3}(?:\/\d{1,3})?\))?(\.*)$/i
const REST_ZERO_RE = /^0(-+|\(\d{1,3}(?:\/\d{1,3})?\))?(\.*)$/

// Meter headers: "Meter: 4/4", "Time 6/8", a lone "4/4", or C for common time.
const METER_NAMED_RE = /^\s*(?:meter|time)\s*[:=]?\s*([1-9]\d*)\s*\/\s*([1-9]\d*)\s*$/i
const METER_BARE_RE = /^\s*([1-9]\d*)\s*\/\s*([1-9]\d*)\s*$/
const COMMON_TIME_RE = /^\s*(?:C|c|C\|)\s*$/

// Bar lines and repeat marks: |, ||, |:, :|, :|:, :||, ||: (also ‖ glyphs).
const BAR_RE = /^(:?)([|‖])([|‖]?)(:?)$/

// First/second endings, tagged on the bar they start.
const ENDING_RE = /^(?:\(([12])\)|([12])\.)$/
const ENDING_UNSUPPORTED_RE = /^(\(\d+\)|\d+\.)$/

// Standard coda/da-capo phrasing this app does not play yet.
const MARKING_RE = /^(?:d\.?s\.?|d\.?c\.?|fine|coda|segno|dal|capo|da)$/i

function applyDots(beats, dots) {
  // One dot adds half, two add three quarters: 1 -> 1.5 -> 1.75.
  return dots > 0 ? beats * (2 - Math.pow(2, -dots)) : beats
}

/**
 * Note length in beats. Supports plain beats in parentheses ("(3)"), fractions
 * ("(1/2)", "(3/2)") so eighths and dotted values can be written exactly.
 * Returns NaN for a length that makes no sense, so the caller can reject it.
 */
function parseBeats(durToken, dots = 0) {
  let beats = 1
  if (durToken) {
    if (durToken.startsWith('(')) {
      const [num, den] = durToken.slice(1, -1).split('/')
      const n = Number(num)
      const d = den === undefined ? 1 : Number(den)
      if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return NaN
      beats = n / d
    } else {
      beats = 1 + durToken.length
    }
  }
  if (!Number.isFinite(beats) || beats <= 0) return NaN
  return applyDots(beats, dots)
}

const countDots = (s) => (s ? s.length : 0)

const barLength = (bar) => bar.notes.reduce((s, n) => s + n.beats, 0)

const structural = (bar) =>
  `${bar.endings.join('+') || '-'}${bar.openRepeat ? '[' : ''}${bar.closeRepeat ? ']' : ''}${
    bar.double ? '\u2016' : ''
  }`

const partSkeleton = (p) => p.bars.map(structural).join('|')

export function parseSolfa(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  let key = null
  let meter = null
  let currentPartName = null
  const parts = []

  const findOrCreatePart = (name) => {
    const existing = parts.find((p) => p.name.toLowerCase() === name.toLowerCase())
    if (existing) return existing
    const part = { name, notes: [], bars: [] }
    parts.push(part)
    return part
  }

  const fail = (message) => ({ ok: false, error: { message } })

  // A real sheet is spotted before any parsing so that when it appears, its
  // lyric, title and composer lines can be ignored instead of rejected.
  let hymnal = false
  for (const candidate of lines) {
    const line = candidate.trim()
    if (!line) continue
    if (keyFromHeader(line) != null) continue
    if (line.match(METER_NAMED_RE) || line.match(METER_BARE_RE) || COMMON_TIME_RE.test(line)) continue
    if (line.match(PART_KEYWORD_RE) || line.match(CUSTOM_PART_RE)) continue
    if (looksHymnal(line)) {
      hymnal = true
      break
    }
  }

  if (hymnal) {
    const rowNames = HYMN_ROW_VOICES
    let autoRow = 0
    let partHeaderForced = false
    for (let i = 0; i < lines.length; i++) {
      const lineNo = i + 1
      const rawLine = lines[i].trim()
      if (!rawLine) continue

      const keyHeader = keyFromHeader(rawLine)
      if (keyHeader != null) {
        if (keyToSemitones(keyHeader) == null) {
          return fail(
            `Unrecognized key "${keyHeader}" on line ${lineNo}. Use a note name like C, D#, or Bb.`
          )
        }
        key = normalizeKey(keyHeader)
        continue
      }
      const meterMatch = rawLine.match(METER_NAMED_RE) || rawLine.match(METER_BARE_RE)
      if (meterMatch) {
        meter = { num: Number(meterMatch[1]), den: Number(meterMatch[2]) }
        continue
      }
      if (COMMON_TIME_RE.test(rawLine)) {
        meter = { num: 4, den: 4 }
        continue
      }
      if (PART_KEYWORD_RE.test(rawLine)) {
        const km = rawLine.match(PART_KEYWORD_RE)[1]
        const name = km.charAt(0).toUpperCase() + km.slice(1).toLowerCase()
        currentPartName = findOrCreatePart(name).name
        partHeaderForced = true
        continue
      }
      // "[Bass]", "[bass]" — a bracketed voice header; other bracketed
      // labels (verses, titles) are skipped below.
      const bracketPart = rawLine.match(/^\[\s*(bass|tenor|alto|soprano)\s*\]$/i)
      if (bracketPart) {
        const name = bracketPart[1].charAt(0).toUpperCase() + bracketPart[1].slice(1).toLowerCase()
        currentPartName = findOrCreatePart(name).name
        partHeaderForced = true
        continue
      }
      // An uppercase L: row is a lyric line under the music.
      if (/^\s*L\d*\s*[:：]/.test(rawLine)) continue
      if (/^\[.*\]$/.test(rawLine)) continue

      let scanText = rawLine
      let explicitVoice = false
      const prefix = rawLine.match(HYMN_PREFIX_RE)
      if (prefix) {
        const name = HYMN_PREFIX_NAME[prefix[1].toLowerCase()]
        if (!name) continue
        currentPartName = findOrCreatePart(name).name
        explicitVoice = true
        scanText = prefix[2].trim()
        if (!scanText) continue
      }
      // Lyrics, titles and attribution lines carry none of the music glyphs.
      if (!explicitVoice && !/[{}|‖:/]/.test(rawLine)) continue

      if (rawLine.includes('{')) {
        autoRow = 0
        partHeaderForced = false
      }
      let part
      if (explicitVoice) {
        part = findOrCreatePart(currentPartName)
      } else if (partHeaderForced) {
        part = findOrCreatePart(currentPartName)
      } else {
        const autoName = rowNames[autoRow % rowNames.length]
        part = findOrCreatePart(autoName)
        currentPartName = part.name
        autoRow++
      }

      const currentOf = (p) => p.bars[p.bars.length - 1]
      const ensureBar = (openRepeat = false, double = false) => {
        let current = currentOf(part)
        if (current && current.notes.length === 0) {
          if (openRepeat) current.openRepeat = true
          if (double) current.double = true
          return current
        }
        const bar = {
          notes: [],
          endings: [],
          openRepeat,
          closeRepeat: false,
          double,
          line: lineNo,
        }
        part.bars.push(bar)
        return bar
      }
      const onBarrier = (attrs) => {
        const current = currentOf(part)
        if (current && current.notes.length > 0) {
          if (attrs.close) current.closeRepeat = true
          if (attrs.double) current.double = true
        }
        ensureBar(Boolean(attrs.open), Boolean(attrs.double))
      }
      const pushNote = (note) => {
        let bar = currentOf(part)
        if (!bar) bar = ensureBar()
        note.bar = part.bars.length - 1
        if (bar.line == null) bar.line = lineNo
        bar.notes.push(note)
        part.notes.push(note)
      }

      // In a hymnal sheet each row line is a full set of bars; a fresh row
      // never continues the previous row's bar.
      if (currentOf(part) && currentOf(part).notes.length > 0) ensureBar()

      const scanned = scanHymnalLine(scanText, lineNo, part.name)
      if (!scanned.ok) return fail(scanned.message)
      for (const ev of scanned.events) {
        if (ev.type === 'bar') {
          onBarrier(ev.attrs)
        } else if (ev.type === 'ending') {
          const current = currentOf(part)
          if (current && current.notes.length > 0) {
            return fail(
              `Ending "${ev.n}." on line ${lineNo} must start a bar, not tag notes already in one.`
            )
          }
          const bar = ensureBar()
          if (!bar.endings.includes(ev.n)) bar.endings.push(ev.n)
          if (bar.line == null) bar.line = lineNo
        } else {
          pushNote({
            token: ev.token,
            solfa: ev.solfa,
            up: ev.up || 0,
            down: ev.down || 0,
            beats: ev.beats,
            line: lineNo,
          })
        }
      }
      // A voice row may end with a bar line; that opened a fresh empty bar
      // whose notes belong to the next row (a different voice), so drop it.
      const lastBar = currentOf(part)
      if (lastBar && lastBar.notes.length === 0) {
        const keep = lastBar.openRepeat || lastBar.closeRepeat || lastBar.double
        if (!keep) part.bars.pop()
      }
    }
  } else {
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1
    const line = lines[i].trim()
    if (!line) continue

    const keyHeader = keyFromHeader(line)
    if (keyHeader != null) {
      if (keyToSemitones(keyHeader) == null) {
        return fail(
          `Unrecognized key "${keyHeader}" on line ${lineNo}. Use a note name like C, D#, or Bb.`
        )
      }
      key = normalizeKey(keyHeader)
      continue
    }

    const meterMatch = line.match(METER_NAMED_RE) || line.match(METER_BARE_RE)
    if (meterMatch) {
      meter = { num: Number(meterMatch[1]), den: Number(meterMatch[2]) }
      continue
    }
    if (COMMON_TIME_RE.test(line)) {
      meter = { num: 4, den: 4 }
      continue
    }

    const partKeyword = line.match(PART_KEYWORD_RE)
    if (partKeyword) {
      const name = partKeyword[1].charAt(0).toUpperCase() + partKeyword[1].slice(1).toLowerCase()
      currentPartName = findOrCreatePart(name).name
      continue
    }

    const customPart = line.match(CUSTOM_PART_RE)
    if (customPart) {
      currentPartName = findOrCreatePart(customPart[1].trim()).name
      continue
    }

    const target = currentPartName ?? 'Main'
    const part = findOrCreatePart(target)
    if (currentPartName === null) currentPartName = target

    const currentOf = (p) => p.bars[p.bars.length - 1]

    const ensureBar = (openRepeat = false, double = false) => {
      let current = currentOf(part)
      if (current && current.notes.length === 0) {
        if (openRepeat) current.openRepeat = true
        if (double) current.double = true
        return current
      }
      const bar = {
        notes: [],
        endings: [],
        openRepeat,
        closeRepeat: false,
        double,
        line: lineNo,
      }
      part.bars.push(bar)
      return bar
    }

    const onBarrier = (attrs) => {
      const current = currentOf(part)
      if (current && current.notes.length > 0) {
        if (attrs.close) current.closeRepeat = true
        if (attrs.double) current.double = true
      }
      ensureBar(Boolean(attrs.open), Boolean(attrs.double))
    }

    const pushNote = (note) => {
      let bar = currentOf(part)
      if (!bar) bar = ensureBar()
      note.bar = part.bars.length - 1
      if (bar.line == null) bar.line = lineNo
      bar.notes.push(note)
      part.notes.push(note)
    }

    for (const token of line.split(/\s+/)) {
      if (!token) continue

      const bm = token.match(BAR_RE)
      if (bm) {
        const [, leading, bar1, bar2, trailing] = bm
        const closeOpen = leading === ':' && trailing === ':'
        const open = (leading === '' && trailing === ':') || closeOpen
        const close = (leading === ':' && trailing === '') || closeOpen
        const double = bar1 + bar2 === '||' || bar1 + bar2 === '\u2016\u2016'
        onBarrier({ open, close, closeOpen, double })
        continue
      }

      const ending = token.match(ENDING_RE)
      if (ending) {
        const n = Number(ending[1] || ending[2])
        const current = currentOf(part)
        if (current && current.notes.length > 0) {
          return fail(
            `Ending "${n}." on line ${lineNo} must start a bar, not tag notes already in one.`
          )
        }
        const bar = ensureBar()
        if (!bar.endings.includes(n)) bar.endings.push(n)
        if (bar.line == null) bar.line = lineNo
        continue
      }

      if (ENDING_UNSUPPORTED_RE.test(token)) {
        return fail(`"${token}" on line ${lineNo}: only first/second endings (1. / 2.) are supported.`)
      }

      if (MARKING_RE.test(token)) {
        return fail(
          `"${token}" on line ${lineNo} (part "${part.name}"): D.S./D.C., Fine and coda markings aren't supported yet.`
        )
      }

      if (REST_WORD_RE.test(token)) {
        const g = REST_WORD_RE.exec(token)
        const beats = parseBeats(g[1], countDots(g[2]))
        if (Number.isNaN(beats)) {
          return fail(`Invalid note length in "${token}" on line ${lineNo}.`)
        }
        pushNote({ token, solfa: null, up: 0, down: 0, beats, line: lineNo })
        continue
      }

      if (REST_ZERO_RE.test(token)) {
        const g = REST_ZERO_RE.exec(token)
        const beats = parseBeats(g[1], countDots(g[2]))
        if (Number.isNaN(beats)) {
          return fail(`Invalid note length in "${token}" on line ${lineNo}.`)
        }
        pushNote({ token, solfa: null, up: 0, down: 0, beats, line: lineNo })
        continue
      }

      const nm = token.match(NOTE_TOKEN_RE)
      if (!nm) {
        return fail(
          `Unrecognized note "${token}" on line ${lineNo} (part "${part.name}"). ` +
            `Expected solfa like Do, Re, Mi... or a single letter d r m f s l t. ` +
            `Sharps and flats are Di, Ri, Fi, Si, Li and Ra, Me, Se, Le, Te. ` +
            `Split bars with | and use |: :| with 1. / 2. for repeats.`
        )
      }
      const base = nm[2].toLowerCase()
      let solfa = LETTER_TO_SOLFA[base] || base
      if (solfa === 'sol') solfa = 'so'
      const marks = nm[3] || ''
      const leadingDown = nm[1].length
      const up = (marks.match(/['\u2019]/g) || []).length
      const down = (marks.match(/,/g) || []).length + leadingDown
      const beats = parseBeats(nm[4], countDots(nm[5]))
      if (Number.isNaN(beats)) {
        return fail(`Invalid note length in "${token}" on line ${lineNo}.`)
      }
      pushNote({ token, solfa, up, down, beats, line: lineNo })
    }
  }
  }

  if (parts.length === 0 || parts.every((p) => p.notes.length === 0)) {
    return fail('No notes found. Type solfa like: Do Re Mi Fa So La Ti')
  }

  // A bar can never be empty: a trailing marker opens one with no notes.
  for (const p of parts) {
    const last = p.bars[p.bars.length - 1]
    if (last && last.notes.length === 0) p.bars.pop()
  }

  if (meter) {
    const target = (meter.num * 4) / meter.den
    for (const p of parts) {
      if (p.bars.length === 0) continue
      for (let bi = 0; bi < p.bars.length; bi++) {
        const bar = p.bars[bi]
        if (bar.notes.length === 0) continue
        const sum = barLength(bar)
        if (Number.isFinite(sum) && Math.abs(sum - target) < 1e-6) continue
        const atEdge = bi === 0 || bi === p.bars.length - 1
        if (atEdge && sum < target) continue
        const when = bar.line ? ` near line ${bar.line}` : ''
        return fail(
          `Bar ${bi + 1} of ${p.name} has ${sum} beats, but ${meter.num}/${meter.den} time expects ${target}.${when}`
        )
      }
    }
  }

  for (const p of parts) {
    if (p.bars.length === 0) continue
    const stack = []
    let repeats = 0
    for (let bi = 0; bi < p.bars.length; bi++) {
      const bar = p.bars[bi]
      if (bar.openRepeat) {
        if (stack.length > 0) {
          return fail(
            `Nested repeats in ${p.name} (bar ${bi + 1}) aren't supported yet — use one ${'|:'} ... ${':|'} at a time.`
          )
        }
        stack.push(bi)
        repeats++
      }
      if (bar.closeRepeat && stack.length > 0) stack.pop()
    }
    if (stack.length > 0) {
      return fail(
        `Unterminated repeat in ${p.name}: the ${'|:'} on bar ${stack[0] + 1} has no closing ${':|'}.`
      )
    }
    const usesEndings = p.bars.some((b) => b.endings.length > 0)
    if (usesEndings) {
      const hasRepeat =
        p.bars.some((b) => b.openRepeat) || p.bars.some((b) => b.closeRepeat)
      if (!hasRepeat) {
        return fail(`Endings ("1."/"2.") in ${p.name} need a repeat: wrap them in ${'|:'} ... ${':|'}.`)
      }
      const hasOne = p.bars.some((b) => b.endings.includes(1))
      const hasTwo = p.bars.some((b) => b.endings.includes(2))
      if (hasTwo && !hasOne) {
        return fail(`A "2." ending in ${p.name} appears without a "1." ending before it.`)
      }
    }
  }

  if (meter) {
    const withBars = parts.filter((p) => p.bars.length > 0)
    if (withBars.length > 1) {
      const expected = partSkeleton(withBars[0])
      const off = withBars.find((p) => partSkeleton(p) !== expected)
      if (off) {
        return fail(
          `Your parts don't line up: ${withBars.map((p) => p.name).join(' and ')} must have the same bars, repeats and endings. Check "${off.name}".`
        )
      }
    }
  }

  return { ok: true, result: { key, meter, parts } }
}