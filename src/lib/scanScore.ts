import { HYMN_WORDS } from './hymnal.js'
import { keyToSemitones, normalizeKey } from './notes.js'
import { parseSolfa } from './parseSolfa.js'

export const SCANNED_VOICES = ['Soprano', 'Alto', 'Tenor', 'Bass'] as const
export type ScannedVoice = (typeof SCANNED_VOICES)[number]
export type ScannedPartName = ScannedVoice | 'Main' | string

export interface ScanPoint {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface ScanCharLike {
  id: string
  text: string
  bbox: ScanPoint
  confidence: number
  uncertain: boolean
  kind: string
  corrected?: boolean
  offset: number
  modifier_of?: string | null
}

export interface ScanLineLike {
  id: string
  text: string
  raw_text: string
  bbox: ScanPoint
  confidence: number
  uncertain: boolean
  chars: ScanCharLike[]
  underline?: ScanPoint | null
  row?: number
}

export interface ScanRuleLike {
  id: string
  orientation: 'horizontal' | 'vertical'
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface ScanPageLike {
  page: number
  width: number
  height: number
  lines: ScanLineLike[]
  rules?: ScanRuleLike[]
}

export type PartSource = 'label' | 'user' | 'position' | 'fallback' | 'unassigned'

export interface PartAssignment {
  name: ScannedPartName | null
  source: PartSource
  confidence: number
}

export interface ScoreWarning {
  code: string
  message: string
  severity: 'error' | 'warning' | 'info'
  page?: number
  system?: number
  measure?: number
  lineId?: string
  part?: string
}

export interface SourceRef {
  page: number
  lineId: string
  charIds: string[]
  text: string
  bbox: ScanPoint
  x: number
  y: number
}

export interface ScoreEvent {
  id: string
  order: number
  part: ScannedPartName
  sourceLineId: string
  page: number
  system: number
  measure: number
  token: string
  solfa: string | null
  up: number
  down: number
  beats: number
  measureBeat: number
  startBeat: number
  lineBar: number
  source: SourceRef | null
  confidence: number
  uncertain: boolean
  corrected: boolean
  underlined: boolean
  slur: string | null
}

export interface ScoreSystemRow {
  part: ScannedPartName | null
  assignment: PartAssignment
  lineId: string
  line: ScanLineLike
  page: number
  bbox: ScanPoint
  musicX0: number
  musicX1: number
  confidence: number
  uncertain: boolean
  eventCount: number
  error: string | null
}

export interface ScoreMeasure {
  index: number
  number: number
  system: number
  page: number
  x0: number
  x1: number
  startBeat: number
  beats: number
  expectedBeats: number | null
  partEvents: Record<string, ScoreEvent[]>
  flags: MeasureFlags
  warning: string | null
}

export interface ScoreSystem {
  index: number
  page: number
  column: number
  bbox: ScanPoint
  rows: ScoreSystemRow[]
  measureIndexes: number[]
  confidence: number
}

export interface ScannedScore {
  version: 1
  key: string | null
  meter: { num: number; den: number } | null
  meterInPlayerText: boolean
  parts: ScannedPartName[]
  systems: ScoreSystem[]
  measures: ScoreMeasure[]
  events: ScoreEvent[]
  warnings: ScoreWarning[]
  playerText: string
  stats: {
    pages: number
    systems: number
    measures: number
    events: number
    beats: number
    uncertainEvents: number
    assignedParts: number
    unassignedLines: number
  }
}

export interface BuildScoreOptions {
  partOverrides?: Record<string, ScannedPartName | null | undefined>
}

interface HeaderInfo {
  key: string | null
  meter: { num: number; den: number } | null
}

interface PartLabel {
  name: ScannedVoice
  rest: string
  restOffset: number
  labelOnly: boolean
  explicit: boolean
}

export interface MeasureFlags {
  openRepeat: boolean
  closeRepeat: boolean
  double: boolean
  endings: number[]
}

type BarFlag = MeasureFlags

interface LineNote {
  token: string
  lineId: string
  solfa: string | null
  up: number
  down: number
  beats: number
  lineBar: number
  order: number
  source: SourceRef | null
  confidence: number
  uncertain: boolean
  underlined: boolean
}

interface ParsedLine {
  ok: boolean
  error: string | null
  notes: LineNote[]
  bars: BarFlag[]
  barXs: number[]
  repaired: boolean
}

interface SolfaNoteLike {
  token?: string
  solfa: string | null
  up?: number
  down?: number
  beats: number
  bar?: number
}

interface SolfaBarLike {
  openRepeat?: boolean
  closeRepeat?: boolean
  double?: boolean
  endings?: number[]
}

interface SolfaPartLike {
  notes: SolfaNoteLike[]
  bars: SolfaBarLike[]
}

interface SolfaParseLike {
  ok: boolean
  error?: { message?: string }
  result?: { parts: SolfaPartLike[] }
}

interface LineAnalysis {
  page: ScanPageLike
  line: ScanLineLike
  pageNumber: number
  column: number
  label: PartLabel | null
  labelOnly: boolean
  header: HeaderInfo | null
  part: PartAssignment
  forcedPart: ScannedPartName | null
  musicText: string
  musicOffset: number
  parsed: ParsedLine
}

interface SystemDraft {
  page: ScanPageLike
  pageNumber: number
  column: number
  lines: LineAnalysis[]
}

interface LineMeasureGroup {
  line: LineAnalysis
  measures: LineNote[][]
  flags: BarFlag[]
}

const VOICE_INDEX = new Map<string, number>(
  SCANNED_VOICES.map((name, index) => [name.toLowerCase(), index])
)
const VOICE_DISPLAY = new Map<string, ScannedVoice>(
  SCANNED_VOICES.map((name) => [name.toLowerCase(), name])
)
const PART_PREFIX =
  /^\s*(soprano|alto|tenor|bass)(?:\s*(\d+))?\s*([:：])?\s*/i
const SHORT_PREFIX = /^\s*([SATB])\d*\s*[:：]\s*/
const SHORT_NAMES: Record<string, ScannedVoice> = {
  S: 'Soprano',
  A: 'Alto',
  T: 'Tenor',
  B: 'Bass',
}
const KEY_INLINE =
  /(?:^|[\s(])(?:key|tonic|doh)\s*[:=]?\s*([a-gA-G])(?:\s*(flat|sharp|b|#|♭|♯|is))?/i
const KEY_SUFFIX: Record<string, string> = {
  flat: 'b',
  '♭': 'b',
  b: 'b',
  sharp: '#',
  '♯': '#',
  '#': '#',
  is: '#',
}
const METER_NAMED =
  /^\s*(?:meter|metre|time)\s*[:=]?\s*([1-9]\d*)\s*\/\s*([1-9]\d*)\s*$/i
const METER_INLINE = /(?:meter|metre|time)\s*[:=]?\s*([1-9]\d*)\s*\/\s*([1-9]\d*)/i
const METER_BARE = /^\s*([1-9]\d*)\s*\/\s*([1-9]\d*)\s*$/
const COMMON_TIME = /^\s*(?:C|c|C\|)\s*$/
const LYRIC_LINE = /^\s*L\d*\s*[:：]/i
const MUSIC_HINT = /[:/|‖{}]/

function finite(value: unknown, fallback = 0): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function unionBox(boxes: ScanPoint[]): ScanPoint {
  return {
    x0: Math.min(...boxes.map((box) => box.x0)),
    y0: Math.min(...boxes.map((box) => box.y0)),
    x1: Math.max(...boxes.map((box) => box.x1)),
    y1: Math.max(...boxes.map((box) => box.y1)),
  }
}

function assignment(
  name: ScannedPartName | null,
  source: PartSource,
  confidence: number
): PartAssignment {
  return { name, source, confidence }
}

export function extractHeaders(text: string): HeaderInfo | null {
  if (!text) return null
  let key: string | null = null
  let meter: { num: number; den: number } | null = null
  const keyMatch = text.match(KEY_INLINE)
  if (keyMatch) {
    const candidate = normalizeKey(
      keyMatch[1] + (keyMatch[2] ? KEY_SUFFIX[keyMatch[2].toLowerCase()] || '' : '')
    )
    if (keyToSemitones(candidate) != null) key = candidate
  }
  const named = text.match(METER_NAMED) || text.match(METER_INLINE)
  const bare = text.match(METER_BARE)
  if (named) meter = { num: Number(named[1]), den: Number(named[2]) }
  else if (bare) meter = { num: Number(bare[1]), den: Number(bare[2]) }
  else if (COMMON_TIME.test(text)) meter = { num: 4, den: 4 }
  if (key == null && meter == null) return null
  return { key, meter }
}

function parsePartLabel(text: string): PartLabel | null {
  const short = text.match(SHORT_PREFIX)
  if (short) {
    return {
      name: SHORT_NAMES[short[1]],
      rest: text.slice(short[0].length),
      restOffset: short[0].length,
      labelOnly: short[0].trim().replace(/[:：]/g, '') === short[1],
      explicit: true,
    }
  }
  const full = text.match(PART_PREFIX)
  if (!full) return null
  const rest = text.slice(full[0].length)
  const colon = Boolean(full[3])
  if (!colon && rest.trim()) return null
  const name = VOICE_DISPLAY.get(full[1].toLowerCase())
  if (!name) return null
  return {
    name,
    rest,
    restOffset: full[0].length,
    labelOnly: !rest.trim(),
    explicit: true,
  }
}

function musicCandidate(analysis: LineAnalysis): boolean {
  if (analysis.header || analysis.labelOnly) return false
  if (LYRIC_LINE.test(analysis.line.text || analysis.line.raw_text || '')) return false
  return analysis.parsed.ok
    ? analysis.parsed.notes.length > 0 || Boolean(analysis.label)
    : Boolean(analysis.label || MUSIC_HINT.test(analysis.musicText))
}

const SUBSCRIPT_DIGITS = '₀₁₂₃₄₅₆₇₈₉'

function normalizeSearchText(text: string): string {
  return text
    .replace(/[’‘`]/g, "'")
    .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, (char) => String(SUBSCRIPT_DIGITS.indexOf(char)))
}

function tokenForSearch(token: string): string {
  return normalizeSearchText(token).toLowerCase().trim()
}

function barPositions(line: ScanLineLike, startOffset: number): number[] {
  return (line.chars || [])
    .filter((char) => char.offset >= startOffset && (char.text === '|' || char.text === '‖'))
    .map((char) => (char.bbox.x0 + char.bbox.x1) / 2)
}

function sourceAt(
  line: ScanLineLike,
  pageNumber: number,
  start: number,
  end: number
): SourceRef | null {
  const chars = (line.chars || [])
    .filter((char) => char.offset >= start && char.offset < end)
    .sort((a, b) => a.offset - b.offset)
  if (!chars.length) return null
  let lastOffset = chars[chars.length - 1].offset
  const stream = [...chars]
  for (const char of [...(line.chars || [])].sort((a, b) => a.offset - b.offset)) {
    if (char.offset <= lastOffset) continue
    if (char.offset > lastOffset + 1) break
    if (!/['’,0-9₀₁₂₃₄₅₆₇₈₉]/.test(char.text)) break
    stream.push(char)
    lastOffset = char.offset
  }
  const box = unionBox(stream.map((char) => char.bbox))
  return {
    page: pageNumber,
    lineId: line.id,
    charIds: stream.map((char) => char.id),
    text: stream.map((char) => char.text).join(''),
    bbox: box,
    x: (box.x0 + box.x1) / 2,
    y: (box.y0 + box.y1) / 2,
  }
}

function splitRepairWord(word: string): { start: number; end: number }[] {
  const pieces: { start: number; end: number }[] = []
  let index = 0
  while (index < word.length) {
    let found = -1
    const limit = Math.min(word.length, index + 4)
    for (let end = limit; end > index; end--) {
      if (Object.prototype.hasOwnProperty.call(HYMN_WORDS, word.slice(index, end))) {
        found = end
        break
      }
    }
    if (found > index) {
      pieces.push({ start: index, end: found })
      index = found
    } else {
      index++
    }
  }
  return pieces
}

function repairMusicText(text: string): { text: string; offsets: number[]; changed: boolean } {
  const normalized: { char: string; index: number }[] = []
  let changed = false
  for (let index = 0; index < text.length; index++) {
    let char = text[index]
    if (/[A-Z]/.test(char)) {
      char = char.toLowerCase()
      changed = true
    }
    if (char === '1') {
      const previous = normalized.length ? normalized[normalized.length - 1].char : ''
      char = /[drmfslt]/.test(previous) ? ',' : 'l'
      changed = true
    } else if (char === '3') {
      char = 's'
      changed = true
    } else if (char === ';') {
      char = ':'
      changed = true
    } else if (char === '7') {
      changed = true
      continue
    } else if (!/[a-z0-9\s:|/.,'’_\-{}‖]/.test(char)) {
      changed = true
      continue
    }
    normalized.push({ char, index })
  }
  const repaired: { char: string; index: number }[] = []
  for (let index = 0; index < normalized.length; ) {
    const item = normalized[index]
    if (!/[a-z]/.test(item.char)) {
      repaired.push(item)
      index++
      continue
    }
    let end = index + 1
    while (end < normalized.length && /[a-z]/.test(normalized[end].char)) end++
    const run = normalized.slice(index, end)
    const word = run.map((entry) => entry.char).join('')
    if (Object.prototype.hasOwnProperty.call(HYMN_WORDS, word)) {
      repaired.push(...run)
    } else {
      changed = true
      const pieces = splitRepairWord(word)
      pieces.forEach((piece, pieceIndex) => {
        if (pieceIndex > 0) {
          repaired.push({ char: ' ', index: run[piece.start].index })
        }
        for (let cursor = piece.start; cursor < piece.end; cursor++) {
          repaired.push(run[cursor])
        }
      })
    }
    index = end
  }
  return {
    text: repaired.map((entry) => entry.char).join(''),
    offsets: repaired.map((entry) => entry.index),
    changed,
  }
}

function parseLineMusic(analysis: LineAnalysis): ParsedLine {
  const text = analysis.musicText
  const empty: ParsedLine = {
    ok: false,
    error: null,
    notes: [],
    bars: [],
    barXs: [],
    repaired: false,
  }
  if (!text.trim()) return empty
  let parsed: SolfaParseLike
  try {
    parsed = parseSolfa(text, { allowIncompleteRepeats: true }) as SolfaParseLike
  } catch (error) {
    return { ...empty, error: error instanceof Error ? error.message : String(error) }
  }
  let repair: { text: string; offsets: number[]; changed: boolean } | null = null
  if (!parsed.ok && (analysis.label || MUSIC_HINT.test(text))) {
    const candidate = repairMusicText(text)
    if (candidate.changed && candidate.text.trim() && candidate.text !== text) {
      try {
        const retry = parseSolfa(candidate.text, {
          allowIncompleteRepeats: true,
        }) as SolfaParseLike
        if (retry.ok) {
          parsed = retry
          repair = candidate
        }
      } catch {
        // Keep the original parse error when OCR repair cannot be read either.
      }
    }
  }
  if (!parsed.ok) {
    return { ...empty, error: parsed.error?.message || 'The line could not be parsed.' }
  }
  const part = parsed.result?.parts.find((item) => item.notes.length > 0)
  if (!part) return empty
  const sourceText = analysis.line.text || analysis.line.raw_text || ''
  const searchText = repair ? repair.text : sourceText.slice(analysis.musicOffset)
  const search = normalizeSearchText(searchText).toLowerCase()
  const chars = [...(analysis.line.chars || [])].sort((a, b) => a.offset - b.offset)
  let cursor = 0
  let previousToken = ''
  let previousSource: SourceRef | null = null
  const notes: LineNote[] = part.notes.map((note, order) => {
      const token = note.token || note.solfa || (note.solfa == null ? '0' : '')
      const needle = tokenForSearch(token)
      let match = -1
      if (needle) {
        const found = search.indexOf(needle, cursor)
        if (found >= 0) match = found
        else if (needle === previousToken) {
          match = search.indexOf(needle)
        }
      }
      let source: SourceRef | null = null
      if (match >= 0) {
        const first = repair ? repair.offsets[match] : match
        const last = repair ? repair.offsets[match + needle.length - 1] : match + needle.length - 1
        const rawStart = analysis.musicOffset + first
        const rawEnd = analysis.musicOffset + last + 1
        source = sourceAt(analysis.line, analysis.pageNumber, rawStart, rawEnd)
        cursor = match + needle.length
        previousToken = needle
        previousSource = source
      } else if (note.solfa == null && needle === previousToken) {
        source = previousSource
      }
      const charConfidences =
        source?.charIds
          .map((id) => chars.find((char) => char.id === id))
          .filter((char): char is ScanCharLike => Boolean(char))
          .map((char) => char.confidence) || []
      const confidence = charConfidences.length
        ? Math.min(...charConfidences)
        : note.solfa == null
          ? 0.5
          : 0
      const uncertain = Boolean(
        repair ||
          (source &&
            source.charIds.some((id) => {
              const char = chars.find((item) => item.id === id)
              return Boolean(char && char.uncertain && !char.corrected)
            }))
      )
      const underline = analysis.line.underline
      const underlined = Boolean(
        underline &&
          source &&
          source.x >= underline.x0 &&
          source.x <= underline.x1 &&
          source.y >= underline.y0 - (analysis.line.bbox.y1 - analysis.line.bbox.y0) &&
          source.y <= analysis.line.bbox.y1 + (analysis.line.bbox.y1 - analysis.line.bbox.y0)
      )
      return {
        token,
        lineId: analysis.line.id,
        solfa: note.solfa,
        up: finite(note.up),
        down: finite(note.down),
        beats: finite(note.beats, 1),
        lineBar: Math.max(0, Math.round(finite(note.bar))),
        order,
        source,
        confidence,
        uncertain,
        underlined,
      }
    }
  )
  const bars = (part.bars || []).map((bar) => ({
      openRepeat: Boolean(bar.openRepeat),
      closeRepeat: Boolean(bar.closeRepeat),
      double: Boolean(bar.double),
      endings: Array.isArray(bar.endings) ? [...bar.endings] : [],
    })
  )
  return {
    ok: true,
    error: null,
    notes,
    bars,
    barXs: barPositions(analysis.line, analysis.musicOffset),
    repaired: Boolean(repair),
  }
}

function pageColumns(page: ScanPageLike, lines: LineAnalysis[]): Map<string, number> {
  const candidates = (page.rules || []).filter(
    (rule) =>
      rule.orientation === 'vertical' &&
      rule.y1 - rule.y0 >= page.height * 0.38 &&
      rule.x0 > page.width * 0.18 &&
      rule.x0 < page.width * 0.82
  )
  const split = candidates
    .map((rule) => {
      const x = (rule.x0 + rule.x1) / 2
      const crossing = lines.filter(
        (item) => item.line.bbox.x0 < x - 8 && item.line.bbox.x1 > x + 8
      ).length
      return { x, crossing }
    })
    .filter((item) => item.crossing <= Math.max(1, Math.floor(lines.length * 0.15)))
    .sort((a, b) => a.crossing - b.crossing || Math.abs(a.x - page.width / 2) - Math.abs(b.x - page.width / 2))[0]
  const result = new Map<string, number>()
  for (const line of lines) {
    result.set(
      line.line.id,
      split && (line.line.bbox.x0 + line.line.bbox.x1) / 2 < split.x ? 0 : split ? 1 : 0
    )
  }
  return result
}

function buildLineAnalysis(
  page: ScanPageLike,
  pageNumber: number,
  line: ScanLineLike,
  column: number,
  overrides: Record<string, ScannedPartName | null | undefined>,
  headers: { key: string | null; meter: { num: number; den: number } | null },
  warnings: ScoreWarning[]
): LineAnalysis {
  const text = line.text || line.raw_text || ''
  const header = extractHeaders(text)
  if (header) {
    if (header.key) {
      if (headers.key && headers.key !== header.key) {
        warnings.push({
          code: 'conflicting-key',
          severity: 'warning',
          message: `The page names both ${headers.key} and ${header.key} as the key. The first key is used.`,
          page: pageNumber,
          lineId: line.id,
        })
      } else {
        headers.key = header.key
      }
    }
    if (header.meter) {
      if (
        headers.meter &&
        (headers.meter.num !== header.meter.num || headers.meter.den !== header.meter.den)
      ) {
        warnings.push({
          code: 'conflicting-meter',
          severity: 'warning',
          message: 'More than one metre was read. The first metre is used.',
          page: pageNumber,
          lineId: line.id,
        })
      } else {
        headers.meter = header.meter
      }
    }
  }
  const label = parsePartLabel(text)
  const labelOnly = Boolean(label?.labelOnly)
  const forced = overrides[line.id]
  let part = assignment(null, 'unassigned', 0)
  if (forced !== undefined) part = assignment(forced, 'user', 1)
  else if (label && !labelOnly) part = assignment(label.name, 'label', 0.98)
  const musicOffset = label ? label.restOffset : 0
  const musicText = label ? label.rest : text
  const base: LineAnalysis = {
    page,
    line,
    pageNumber,
    column,
    label,
    labelOnly,
    header,
    part,
    forcedPart: null,
    musicText,
    musicOffset,
    parsed: {
      ok: false,
      error: null,
      notes: [],
      bars: [],
      barXs: [],
      repaired: false,
    },
  }
  if (header || labelOnly || LYRIC_LINE.test(text)) return base
  const parsed = parseLineMusic(base)
  base.parsed = parsed
  return base
}

function attachLabelOnlyLines(lines: LineAnalysis[], warnings: ScoreWarning[]): LineAnalysis[] {
  const music = lines.filter((line) => !line.labelOnly && !line.header && musicCandidate(line))
  const result = [...music]
  for (const line of lines.filter((item) => item.labelOnly)) {
    const height = Math.max(line.line.bbox.y1 - line.line.bbox.y0, 1)
    const candidates = result
      .filter(
        (item) =>
          item.part.source !== 'label' &&
          item.part.source !== 'user' &&
          item.pageNumber === line.pageNumber &&
          item.column === line.column &&
          Math.abs((item.line.bbox.y0 + item.line.bbox.y1) / 2 - (line.line.bbox.y0 + line.line.bbox.y1) / 2) <= height * 1.4
      )
      .sort((a, b) => {
        const ay = Math.abs((a.line.bbox.y0 + a.line.bbox.y1) / 2 - (line.line.bbox.y0 + line.line.bbox.y1) / 2)
        const by = Math.abs((b.line.bbox.y0 + b.line.bbox.y1) / 2 - (line.line.bbox.y0 + line.line.bbox.y1) / 2)
        return ay - by
      })
    if (candidates.length) {
      candidates[0].part = assignment(line.label?.name || null, 'label', 0.95)
      candidates[0].forcedPart = line.label?.name || null
    } else {
      warnings.push({
        code: 'orphan-part-label',
        severity: 'warning',
        message: `${line.label?.name || 'A part label'} was found without a matching music line. Assign the line in the review.`,
        page: line.pageNumber,
        lineId: line.line.id,
      })
    }
  }
  return result
}

function groupSystems(lines: LineAnalysis[], page: ScanPageLike, pageNumber: number): SystemDraft[] {
  const ordered = [...lines].sort(
    (a, b) =>
      a.column - b.column ||
      a.line.bbox.y0 - b.line.bbox.y0 ||
      a.line.bbox.x0 - b.line.bbox.x0
  )
  const heights = ordered.map((line) => line.line.bbox.y1 - line.line.bbox.y0)
  const tall = Math.max(median(heights), 8)
  const systems: SystemDraft[] = []
  let current: SystemDraft | null = null
  let lastBottom = 0
  let explicitParts = new Set<string>()
  for (const line of ordered) {
    const part = line.forcedPart || line.part.name
    const repeated = Boolean(part && explicitParts.has(part))
    const gap = current ? line.line.bbox.y0 - lastBottom : 0
    const newForGap =
      Boolean(current) &&
      gap > Math.max(tall * 3.4, page.height * 0.025) &&
      (current?.lines.length || 0) >= 2
    const newForCapacity = Boolean(current) && (current?.lines.length || 0) >= 4
    if (
      !current ||
      current.column !== line.column ||
      current.pageNumber !== line.pageNumber ||
      repeated ||
      newForGap ||
      newForCapacity
    ) {
      current = { page, pageNumber, column: line.column, lines: [] }
      systems.push(current)
      explicitParts = new Set()
    }
    current.lines.push(line)
    if (part) explicitParts.add(part)
    lastBottom = Math.max(lastBottom, line.line.bbox.y1)
  }
  return systems
}

function assignSystemParts(system: SystemDraft, warnings: ScoreWarning[]): void {
  const rows = [...system.lines].sort((a, b) => a.line.bbox.y0 - b.line.bbox.y0 || a.line.bbox.x0 - b.line.bbox.x0)
  const used = new Set<string>()
  for (const line of rows) {
    if (line.part.source === 'user') {
      if (line.part.name) {
        if (used.has(line.part.name)) {
          warnings.push({
            code: 'duplicate-part',
            severity: 'warning',
            message: `${line.part.name} is assigned to two lines in the same system. Choose a different part for one of them.`,
            page: system.pageNumber,
            lineId: line.line.id,
          })
          line.part = assignment(null, 'unassigned', 0)
        } else used.add(line.part.name)
      }
      continue
    }
    if (line.part.source === 'label' && line.part.name) {
      if (used.has(line.part.name)) {
        warnings.push({
          code: 'duplicate-part',
          severity: 'warning',
          message: `${line.part.name} was read twice in one system. The later line needs a part assignment.`,
          page: system.pageNumber,
          lineId: line.line.id,
        })
        line.part = assignment(null, 'unassigned', 0)
      } else used.add(line.part.name)
    }
  }
  const unassigned = rows.filter(
    (line) =>
      !line.part.name &&
      !(line.part.source === 'user' && !line.part.name)
  )
  const missing = SCANNED_VOICES.filter((voice) => !used.has(voice))
  if (!unassigned.length) return
  if (rows.length === 4 && unassigned.length === missing.length) {
    for (let index = 0; index < unassigned.length; index++) {
      unassigned[index].part = assignment(missing[index], 'position', 0.58)
      used.add(missing[index])
    }
    warnings.push({
      code: 'parts-inferred',
      severity: 'info',
      message: 'Some part names were not readable. The four stacked lines were assigned by vertical order; confirm them in the review.',
      page: system.pageNumber,
    })
    return
  }
  if (unassigned.length === 1 && missing.length === 1) {
    unassigned[0].part = assignment(missing[0], 'position', 0.46)
    warnings.push({
      code: 'part-inferred',
      severity: 'warning',
      message: `One part name was unreadable. Its line was tentatively assigned to ${missing[0]}; confirm it in the review.`,
      page: system.pageNumber,
      lineId: unassigned[0].line.id,
    })
  }
}

function ruleBarPositions(rows: LineAnalysis[]): number[] {
  if (!rows.length) return []
  const page = rows[0].page
  const x0 = Math.min(...rows.map((line) => line.line.bbox.x0))
  const x1 = Math.max(...rows.map((line) => line.line.bbox.x1))
  const y0 = Math.min(...rows.map((line) => line.line.bbox.y0))
  const y1 = Math.max(...rows.map((line) => line.line.bbox.y1))
  const height = Math.max(y1 - y0, 1)
  const left = x0 + Math.max(12, page.width * 0.03)
  const right = x1 - Math.max(12, page.width * 0.03)
  const minOverlap = Math.max(height * 0.72, 36)
  const candidates = (page.rules || [])
    .filter((rule) => rule.orientation === 'vertical')
    .map((rule) => ({
      x: (rule.x0 + rule.x1) / 2,
      overlap: Math.min(rule.y1, y1) - Math.max(rule.y0, y0),
    }))
    .filter((rule) => rule.overlap >= minOverlap && rule.x > left && rule.x < right)
    .map((rule) => rule.x)
    .sort((a, b) => a - b)
  const tolerance = Math.max(4, page.width * 0.006)
  const positions: number[] = []
  for (const x of candidates) {
    if (!positions.length || x - positions[positions.length - 1] > tolerance) positions.push(x)
    else positions[positions.length - 1] = (positions[positions.length - 1] + x) / 2
  }
  return positions
}

function systemBarPositions(rows: LineAnalysis[]): number[] {
  const fromRules = ruleBarPositions(rows)
  if (fromRules.length) return fromRules
  const best = [...rows]
    .filter((line) => line.parsed.ok)
    .sort(
      (a, b) =>
        b.parsed.barXs.length - a.parsed.barXs.length ||
        b.parsed.notes.length - a.parsed.notes.length
    )[0]
  if (!best) return []
  const tolerance = Math.max(3, (best.page.width || 1000) * 0.006)
  const sorted = [...best.parsed.barXs].sort((a, b) => a - b)
  const positions: number[] = []
  for (const x of sorted) {
    if (!positions.length || x - positions[positions.length - 1] > tolerance) positions.push(x)
    else positions[positions.length - 1] = (positions[positions.length - 1] + x) / 2
  }
  return positions
}

function measureForX(x: number, x0: number, bars: number[]): number {
  if (!bars.length) return 0
  if (x <= x0) return 0
  for (let index = 0; index < bars.length; index++) {
    if (x < bars[index]) return index
  }
  return bars.length
}

function measureFlags(line: LineAnalysis, measureCount: number): BarFlag[] {
  const bars = line.parsed.bars
  const empty = (): BarFlag => ({
    openRepeat: false,
    closeRepeat: false,
    double: false,
    endings: [],
  })
  const output = Array.from({ length: measureCount }, empty)
  if (!bars.length) return output
  if (bars.length === measureCount) {
    return bars.map((bar) => ({ ...bar, endings: [...bar.endings] }))
  }
  if (bars.length === 1) {
    output[0] = { ...bars[0], endings: [...bars[0].endings] }
    if (output.length > 1) {
      output[output.length - 1].closeRepeat ||= bars[0].closeRepeat
      output[output.length - 1].double ||= bars[0].double
      output[0].closeRepeat = false
    }
    return output
  }
  for (let index = 0; index < bars.length; index++) {
    const target = Math.min(
      output.length - 1,
      Math.round((index * output.length) / bars.length)
    )
    const previous = output[target]
    output[target] = {
      openRepeat: previous.openRepeat || bars[index].openRepeat,
      closeRepeat: previous.closeRepeat || bars[index].closeRepeat,
      double: previous.double || bars[index].double,
      endings: [...new Set([...previous.endings, ...bars[index].endings])],
    }
  }
  return output
}

function sameFlag(a: BarFlag, b: BarFlag): boolean {
  return (
    a.openRepeat === b.openRepeat &&
    a.closeRepeat === b.closeRepeat &&
    a.double === b.double &&
    a.endings.join(',') === b.endings.join(',')
  )
}

function buildSystemMeasures(
  systemIndex: number,
  draft: SystemDraft,
  warnings: ScoreWarning[]
): { system: ScoreSystem; groups: LineMeasureGroup[]; bars: number[]; x0: number; x1: number } {
  const rows = [...draft.lines].sort((a, b) => a.line.bbox.y0 - b.line.bbox.y0)
  const eventRows = rows.filter((line) => line.parsed.ok && line.parsed.notes.length)
  const boxes = eventRows.flatMap((line) =>
    line.parsed.notes.map((note) => note.source?.bbox || line.line.bbox)
  )
  const fallbackBox = unionBox(rows.map((line) => line.line.bbox))
  const content = boxes.length ? unionBox(boxes) : fallbackBox
  let bars = systemBarPositions(rows)
  const tolerance = Math.max(4, draft.page.width * 0.008)
  let x0 = content.x0
  let x1 = content.x1
  const boundaryTolerance = Math.max(24, draft.page.width * 0.08)
  if (bars.length > 1 && bars[0] - content.x0 <= boundaryTolerance) {
    x0 = bars[0]
    bars = bars.slice(1)
  }
  const internal: number[] = []
  for (const x of bars) {
    if (x > x0 + tolerance && x < x1 - tolerance) internal.push(x)
  }
  if (!internal.length) {
    x0 = Math.min(...rows.map((line) => line.line.bbox.x0))
    x1 = Math.max(...rows.map((line) => line.line.bbox.x1))
  }
  const boundaries = [x0, ...internal, x1]
  const measureCount = Math.max(1, boundaries.length - 1)
  const groups: LineMeasureGroup[] = []
  for (const line of rows) {
    const measures = Array.from({ length: measureCount }, (): LineNote[] => [])
    if (line.parsed.ok) {
      const useX = line.parsed.bars.length !== measureCount
      for (const note of line.parsed.notes) {
        let index = note.lineBar
        if (useX && note.source?.x != null) {
          index = measureForX(note.source.x, x0, internal)
        }
        if (index < 0 || index >= measureCount) {
          index = Math.min(measureCount - 1, Math.max(0, note.lineBar))
        }
        measures[index].push(note)
      }
      const parsedBars = line.parsed.bars.length
      if (parsedBars && parsedBars !== measureCount && parsedBars > 1) {
        warnings.push({
          code: 'measure-count-mismatch',
          severity: 'warning',
          message: `${line.part.name || 'A line'} has ${parsedBars} bars but the system shows ${measureCount}. Check its barlines in the review.`,
          page: draft.pageNumber,
          system: systemIndex,
          lineId: line.line.id,
          part: line.part.name || undefined,
        })
      }
    }
    groups.push({ line, measures, flags: measureFlags(line, measureCount) })
  }
  const scoreRows: ScoreSystemRow[] = rows.map((line) => ({
    part: line.part.name,
    assignment: line.part,
    lineId: line.line.id,
    line: line.line,
    page: draft.pageNumber,
    bbox: line.line.bbox,
    musicX0: line.parsed.notes[0]?.source?.bbox.x0 || line.line.bbox.x0,
    musicX1:
      line.parsed.notes[line.parsed.notes.length - 1]?.source?.bbox.x1 || line.line.bbox.x1,
    confidence: line.line.confidence,
    uncertain: line.line.uncertain,
    eventCount: line.parsed.notes.length,
    error: line.parsed.error,
  }))
  for (const row of scoreRows) {
    if (!row.part) {
      warnings.push({
        code: 'unassigned-part',
        severity: 'warning',
        message: 'A music line has no confident part. Assign Soprano, Alto, Tenor or Bass in the review before playback.',
        page: draft.pageNumber,
        system: systemIndex,
        lineId: row.lineId,
      })
    }
  }
  const system: ScoreSystem = {
    index: systemIndex,
    page: draft.pageNumber,
    column: draft.column,
    bbox: unionBox(rows.map((line) => line.line.bbox)),
    rows: scoreRows,
    measureIndexes: [],
    confidence: rows.length
      ? rows.reduce((sum, line) => sum + line.part.confidence, 0) / rows.length
      : 0,
  }
  return { system, groups, bars: internal, x0, x1 }
}

function mergeSystemFlags(
  groups: LineMeasureGroup[],
  measureCount: number,
  systemIndex: number,
  page: number,
  warnings: ScoreWarning[]
): BarFlag[] {
  let conflict = false
  const merged = Array.from({ length: measureCount }, (_, measureIndex) => {
    const flags = groups
      .filter((group) => group.line.part.name)
      .map((group) => group.flags[measureIndex])
      .filter(Boolean)
    const first = flags[0] || {
      openRepeat: false,
      closeRepeat: false,
      double: false,
      endings: [],
    }
    if (flags.some((flag) => !sameFlag(flag, first))) {
      conflict = true
      return { openRepeat: false, closeRepeat: false, double: false, endings: [] }
    }
    return { ...first, endings: [...first.endings] }
  })
  if (conflict) {
    warnings.push({
      code: 'repeat-mismatch',
      severity: 'warning',
      message:
        'The parts show different repeat signs in at least one bar. Repeats were left out of the aligned score; check the barlines.',
      page,
      system: systemIndex,
    })
  }
  return merged
}

function formatBeats(beats: number): string {
  if (!Number.isFinite(beats) || beats <= 0) return '0'
  if (Number.isInteger(beats)) return String(beats)
  for (const denominator of [2, 3, 4, 6, 8, 12]) {
    const numerator = Math.round(beats * denominator)
    if (Math.abs(numerator / denominator - beats) < 1e-6) return `${numerator}/${denominator}`
  }
  return `${Math.round(beats * 1000) / 1000}`
}

function noteToken(note: Pick<LineNote, 'solfa' | 'up' | 'down'>, beats: number): string {
  const names: Record<string, string> = {
    do: 'Do',
    re: 'Re',
    mi: 'Mi',
    fa: 'Fa',
    so: 'So',
    la: 'La',
    ti: 'Ti',
    di: 'Di',
    ri: 'Ri',
    fi: 'Fi',
    si: 'Si',
    li: 'Li',
    ra: 'Ra',
    me: 'Me',
    se: 'Se',
    le: 'Le',
    te: 'Te',
  }
  const base = note.solfa ? names[note.solfa] || note.solfa : '0'
  const marks = ','.repeat(Math.max(0, note.down)) + "'".repeat(Math.max(0, note.up))
  if (beats === 1) return `${marks}${base}`
  if (Number.isInteger(beats) && beats > 1) return `${marks}${base}${'-'.repeat(beats - 1)}`
  return `${marks}${base}(${formatBeats(beats)})`
}

function restToken(beats: number): string {
  if (beats === 1) return '0'
  if (Number.isInteger(beats) && beats > 1) return `0${'-'.repeat(beats - 1)}`
  return `0(${formatBeats(beats)})`
}

function measureText(events: ScoreEvent[], measureBeats: number, endings: number[]): string {
  const pieces: string[] = []
  for (const ending of endings) pieces.push(`${ending}.`)
  let cursor = 0
  for (const event of [...events].sort((a, b) => a.measureBeat - b.measureBeat)) {
    if (event.measureBeat > cursor + 1e-6) pieces.push(restToken(event.measureBeat - cursor))
    pieces.push(noteToken(event, event.beats))
    cursor = Math.max(cursor, event.measureBeat + event.beats)
  }
  if (measureBeats > cursor + 1e-6) pieces.push(restToken(measureBeats - cursor))
  return pieces.join(' ')
}

function boundaryAfter(current: MeasureFlags, next: MeasureFlags, last: boolean): string {
  if (last) {
    if (current.closeRepeat) return ':|'
    if (current.double) return '||'
    return ''
  }
  if (current.closeRepeat && next.openRepeat) return ':|:'
  if (current.closeRepeat) return ':|'
  if (next.openRepeat) return '|:'
  if (current.double) return '||'
  return '|'
}

function buildPlayerText(
  score: Omit<ScannedScore, 'playerText' | 'stats'>,
  extraWarnings: ScoreWarning[]
): { text: string; meterSafe: boolean } {
  const parts = score.parts.filter((part) => score.events.some((event) => event.part === part))
  if (!parts.length) return { text: '', meterSafe: false }
  const meter = score.meter
  const meterTarget = meter ? (meter.num * 4) / meter.den : null
  const lastMeasure = score.measures.length - 1
  const meterSafe = Boolean(
    meter &&
      meterTarget != null &&
      score.measures.length > 0 &&
      score.measures.every(
        (measure) => Math.abs(measure.beats - meterTarget) < 1e-6
      )
  )
  if (meter && !meterSafe) {
    extraWarnings.push({
      code: 'meter-not-exported',
      severity: 'warning',
      message:
        'The detected bars do not all fit the printed metre (a pickup or short final bar can cause this), so the aligned score is exported without a time signature. Review the bar lengths.',
    })
  }
  const lines: string[] = []
  if (score.key) lines.push(`Key: ${score.key}`)
  if (meter && meterSafe) lines.push(`Meter: ${meter.num}/${meter.den}`)
  for (const part of parts) {
    lines.push('')
    lines.push(SCANNED_VOICES.includes(part as ScannedVoice) ? part : `[${part}]`)
    const measures: string[] = []
    score.measures.forEach((measure, index) => {
      const flags = measure.flags
      const next = score.measures[index + 1]?.flags || {
        openRepeat: false,
        closeRepeat: false,
        double: false,
        endings: [],
      }
      const prefix = index === 0 && flags.openRepeat ? '|: ' : ''
      const body = measureText(measure.partEvents[part] || [], measure.beats, flags.endings)
      const boundary = boundaryAfter(flags, next, index === lastMeasure)
      measures.push(`${prefix}${body}${boundary ? ` ${boundary}` : ''}`.trim())
    })
    lines.push(measures.join(' '))
  }
  return { text: lines.join('\n').trim(), meterSafe: meterSafe || !meter }
}

export function buildScannedScore(
  pageMap: Record<number, ScanPageLike> | ScanPageLike[],
  options: BuildScoreOptions = {}
): ScannedScore {
  const pages = (Array.isArray(pageMap) ? pageMap : Object.values(pageMap || {})).sort(
    (a, b) => a.page - b.page
  )
  const warnings: ScoreWarning[] = []
  const headers: { key: string | null; meter: { num: number; den: number } | null } = {
    key: null,
    meter: null,
  }
  const overrides = options.partOverrides || {}
  const analyses: LineAnalysis[] = []
  for (const page of pages) {
    const pageLines = (page.lines || []).map((line) =>
      buildLineAnalysis(page, page.page, line, 0, overrides, headers, warnings)
    )
    const columns = pageColumns(page, pageLines)
    for (const line of pageLines) line.column = columns.get(line.line.id) || 0
    const withForced = attachLabelOnlyLines(pageLines, warnings)
    for (const line of withForced) {
      if (line.parsed.error && (line.label || MUSIC_HINT.test(line.musicText))) {
        warnings.push({
          code: 'unreadable-line',
          severity: 'error',
          message: line.parsed.error,
          page: page.page,
          lineId: line.line.id,
          part: line.part.name || undefined,
        })
      }
    }
    const repairedCount = pageLines.filter(
      (line) => line.parsed.repaired && musicCandidate(line)
    ).length
    if (repairedCount) {
      warnings.push({
        code: 'ocr-repair',
        severity: 'warning',
        message: `${repairedCount} music line${repairedCount === 1 ? '' : 's'} contained OCR-confused symbols that were normalized conservatively. Review the highlighted notes before playback.`,
        page: page.page,
      })
    }
    analyses.push(
      ...pageLines.filter(
        (line) =>
          !line.header &&
          !line.labelOnly &&
          (musicCandidate(line) || (line.parsed.error && line.label))
      )
    )
  }
  const drafts: SystemDraft[] = []
  const pagesWithLines = new Set(analyses.map((line) => line.pageNumber))
  for (const page of pages.filter((item) => pagesWithLines.has(item.page))) {
    const pageAnalyses = analyses.filter((line) => line.pageNumber === page.page)
    const partial = groupSystems(pageAnalyses, page, page.page)
    drafts.push(...partial)
  }
  const candidateLineCount = drafts.reduce((count, draft) => count + draft.lines.length, 0)
  if (candidateLineCount === 1) {
    const only = drafts
      .flatMap((draft) => draft.lines)
      .find(
        (line) =>
          line.parsed.ok &&
          line.parsed.notes.length &&
          !line.part.name &&
          line.part.source !== 'user'
      )
    if (only) {
      only.part = assignment('Main', 'fallback', 0.3)
      warnings.push({
        code: 'part-fallback',
        severity: 'warning',
        message: 'No part name was read on this single melody line. It is treated as Main; assign a voice if the sheet has parts.',
        page: only.pageNumber,
        lineId: only.line.id,
      })
    }
  }
  let systemIndex = 0
  const systems: ScoreSystem[] = []
  const measures: ScoreMeasure[] = []
  const events: ScoreEvent[] = []
  const pending: {
    system: ScoreSystem
    groups: LineMeasureGroup[]
    flags: BarFlag[]
    x0: number
    x1: number
    measures: {
      number: number
      system: number
      page: number
      x0: number
      x1: number
      values: Map<string, LineNote[]>
      flags: BarFlag
      expectedBeats: number | null
    }[]
  }[] = []
  for (const draft of drafts) {
    assignSystemParts(draft, warnings)
    const built = buildSystemMeasures(systemIndex, draft, warnings)
    const { system, groups, x0, x1 } = built
    const groupsWithParts = groups.filter((group) => group.line.part.name && group.line.parsed.ok)
    const measureCount = groups[0]?.measures.length || 1
    const flags = mergeSystemFlags(
      groupsWithParts,
      measureCount,
      systemIndex,
      draft.pageNumber,
      warnings
    )
    if (system.rows.every((row) => !row.part) && system.rows.every((row) => !row.eventCount)) {
      systemIndex++
      continue
    }
    systems.push(system)
    const systemPending = {
      system,
      groups,
      flags,
      x0,
      x1,
      measures: [] as {
        number: number
        system: number
        page: number
        x0: number
        x1: number
        values: Map<string, LineNote[]>
        flags: BarFlag
        expectedBeats: number | null
      }[],
    }
    const measureWidth = measureCount ? (x1 - x0) / measureCount : x1 - x0
    for (let local = 0; local < measureCount; local++) {
      const values = new Map<string, LineNote[]>()
      for (const group of groupsWithParts) {
        const part = group.line.part.name
        if (!part) continue
        values.set(part, group.measures[local] || [])
      }
      const flag = flags[local] || { openRepeat: false, closeRepeat: false, double: false, endings: [] }
      systemPending.measures.push({
        number: measures.length + local + 1,
        system: systemIndex,
        page: draft.pageNumber,
        x0: x0 + local * measureWidth,
        x1: x0 + (local + 1) * measureWidth,
        values,
        flags: flag,
        expectedBeats: headers.meter ? (headers.meter.num * 4) / headers.meter.den : null,
      })
    }
    pending.push(systemPending)
    systemIndex++
  }
  const flatMeasures = pending.flatMap((system) => system.measures)
  let startBeat = 0
  const meterTarget = headers.meter ? (headers.meter.num * 4) / headers.meter.den : null
  for (let index = 0; index < flatMeasures.length; index++) {
    const current = flatMeasures[index]
    const number = index + 1
    const values = [...current.values.values()]
    const actuals = values.map((notes) => notes.reduce((sum, note) => sum + note.beats, 0))
    const maxBeats = Math.max(0, ...actuals)
    const first = index === 0
    const last = index === flatMeasures.length - 1
    let beats = meterTarget != null && !first && !last ? meterTarget : maxBeats
    if (beats === 0 && meterTarget != null) beats = meterTarget
    if (meterTarget != null) {
      if (!first && !last && maxBeats > meterTarget + 1e-6) {
        beats = maxBeats
        warnings.push({
          code: 'measure-overflow',
          severity: 'error',
          message: `Measure ${number} has ${maxBeats} beats but ${headers.meter?.num}/${headers.meter?.den} expects ${meterTarget}. Its extra beats are kept so later notes are not shifted.`,
          page: current.page,
          system: current.system,
          measure: number,
        })
      } else if (!first && !last && maxBeats > 0 && maxBeats < meterTarget - 1e-6) {
        warnings.push({
          code: 'measure-short',
          severity: 'warning',
          message: `Measure ${number} has ${maxBeats} beats but the metre expects ${meterTarget}. Silence fills the gap so the next bar stays aligned.`,
          page: current.page,
          system: current.system,
          measure: number,
        })
      } else if ((first || last) && maxBeats > meterTarget + 1e-6) {
        warnings.push({
          code: 'measure-overflow',
          severity: 'error',
          message: `Measure ${number} has ${maxBeats} beats and does not fit ${headers.meter?.num}/${headers.meter?.den}.`,
          page: current.page,
          system: current.system,
          measure: number,
        })
      }
    }
    const measure = {
      index: measures.length,
      number: number,
      system: current.system,
      page: current.page,
      x0: current.x0,
      x1: current.x1,
      startBeat,
      beats,
      expectedBeats: meterTarget,
      partEvents: {} as Record<string, ScoreEvent[]>,
      flags: current.flags,
      warning: null as string | null,
    }
    for (const [part, notes] of current.values.entries()) {
      let offset = 0
      const partEvents: ScoreEvent[] = []
      for (const note of [...notes].sort((a, b) => a.order - b.order)) {
        const event: ScoreEvent = {
          id: `m${measure.index + 1}-${part}-${note.order}`,
          order: events.length,
          part,
          sourceLineId: note.source?.lineId || note.lineId,
          page: current.page,
          system: current.system,
          measure: measure.index,
          token: note.token,
          solfa: note.solfa,
          up: note.up,
          down: note.down,
          beats: note.beats,
          measureBeat: offset,
          startBeat: startBeat + offset,
          lineBar: note.lineBar,
          source: note.source,
          confidence: note.confidence,
          uncertain: note.uncertain,
          corrected: Boolean(
            note.source?.charIds.some((id) => {
              const line = analyses.find((item) => item.line.id === note.source?.lineId)
              return line?.line.chars.find((char) => char.id === id)?.corrected
            })
          ),
          underlined: note.underlined,
          slur: null,
        }
        offset += note.beats
        events.push(event)
        partEvents.push(event)
        if (offset > beats + 1e-6) {
          measure.warning = `A ${part} event extends past the end of measure ${number}.`
          warnings.push({
            code: 'event-overflow',
            severity: 'error',
            message: measure.warning,
            page: current.page,
            system: current.system,
            measure: number,
            part,
          })
        }
      }
      measure.partEvents[part] = partEvents
    }
    measure.beats = beats
    startBeat += beats
    measures.push(measure)
  }
  for (const system of systems) {
    const systemMeasures = measures.filter((measure) => measure.system === system.index)
    system.measureIndexes = systemMeasures.map((measure) => measure.index)
  }
  const parts = [...new Set(events.map((event) => event.part))].sort((a, b) => {
    const ai = VOICE_INDEX.get(String(a).toLowerCase())
    const bi = VOICE_INDEX.get(String(b).toLowerCase())
    if (ai == null && bi == null) return String(a).localeCompare(String(b))
    if (ai == null) return 1
    if (bi == null) return -1
    return ai - bi
  })
  for (const measure of measures) {
    if (!measure.warning && Object.keys(measure.partEvents).length === 0) {
      measure.warning = 'No notes reached this measure.'
      warnings.push({
        code: 'empty-measure',
        severity: 'warning',
        message: `Measure ${measure.number} has no recognized notes.`,
        page: measure.page,
        system: measure.system,
        measure: measure.number,
      })
    }
  }
  let slurCounter = 0
  for (const part of parts) {
    let group: ScoreEvent[] = []
    const flush = () => {
      if (group.length > 1) {
        const id = `slur-${++slurCounter}`
        for (const event of group) event.slur = id
      }
      group = []
    }
    for (const event of events.filter((item) => item.part === part)) {
      if (event.underlined && event.source?.lineId) {
        if (group.length && group[group.length - 1].source?.lineId !== event.source.lineId) flush()
        group.push(event)
      } else {
        flush()
      }
    }
    flush()
  }
  for (const event of events) {
    if (!event.source && event.solfa == null) continue
    if (!event.source && event.solfa != null) {
      warnings.push({
        code: 'unmapped-note',
        severity: 'warning',
        message: `A ${event.part} note in measure ${event.measure + 1} could not be linked to a source character. Its time is still preserved.`,
        page: event.page,
        system: event.system,
        measure: event.measure + 1,
        part: event.part,
      })
    }
  }
  const unassignedLines = systems.reduce(
    (count, system) => count + system.rows.filter((row) => !row.part).length,
    0
  )
  if (unassignedLines) {
    warnings.push({
      code: 'unassigned-lines',
      severity: 'error',
      message: `${unassignedLines} music line${unassignedLines === 1 ? '' : 's'} still need a part. Assign every line before sending the score to the player.`,
    })
  }
  if (!events.length) {
    warnings.push({
      code: 'no-music',
      severity: 'error',
      message: 'No playable notes were found in the recognized score.',
    })
  }
  const partial = {
    version: 1 as const,
    key: headers.key,
    meter: headers.meter,
    meterInPlayerText: false,
    parts,
    systems,
    measures,
    events,
    warnings,
    stats: {
      pages: pages.length,
      systems: systems.length,
      measures: measures.length,
      events: events.length,
      beats: startBeat,
      uncertainEvents: events.filter((event) => event.uncertain).length,
      assignedParts: parts.length,
      unassignedLines,
    },
  }
  const player = buildPlayerText(partial, warnings)
  const meterInPlayerText = Boolean(partial.meter && player.meterSafe)
  const score: ScannedScore = {
    ...partial,
    meterInPlayerText,
    playerText: player.text,
    warnings,
  }
  if (unassignedLines) {
    score.playerText = ''
  }
  return score
}

export function partLabel(part: ScannedPartName | null): string {
  return part || 'Unassigned'
}

export function bboxForSource(events: ScoreEvent[]): ScanPoint | null {
  const boxes = events.map((event) => event.source?.bbox).filter((box): box is ScanPoint => Boolean(box))
  if (!boxes.length) return null
  return unionBox(boxes)
}
