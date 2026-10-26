import { describe, expect, it } from 'vitest'
import { parseSolfa } from '../parseSolfa.js'
import {
  buildScannedScore,
  extractHeaders,
  type ScanCharLike,
  type ScanLineLike,
  type ScanPageLike,
} from '../scanScore'

const CHAR_WIDTH = 10

function makeChars(text: string, y: number, withChars = true): ScanCharLike[] {
  if (!withChars) return []
  return Array.from(text).map((char, index) => ({
    id: `c-${y}-${index}`,
    text: char,
    bbox: {
      x0: 60 + index * CHAR_WIDTH,
      y0: y,
      x1: 60 + index * CHAR_WIDTH + CHAR_WIDTH,
      y1: y + 16,
    },
    confidence: char === '|' ? 0.88 : 0.96,
    uncertain: false,
    kind: char === '|' ? 'punctuation' : 'solfa',
    corrected: false,
    offset: index,
    modifier_of: null,
  }))
}

function makeLine(
  id: string,
  text: string,
  y: number,
  options: {
    withChars?: boolean
    confidence?: number
    uncertain?: boolean
  } = {}
): ScanLineLike {
  const chars = makeChars(text, y, options.withChars !== false)
  const bbox = chars.length
    ? {
        x0: Math.min(...chars.map((char) => char.bbox.x0)),
        y0: y,
        x1: Math.max(...chars.map((char) => char.bbox.x1)),
        y1: y + 16,
      }
    : { x0: 60, y0: y, x1: 60 + text.length * CHAR_WIDTH, y1: y + 16 }
  return {
    id,
    text,
    raw_text: text,
    bbox,
    confidence: options.confidence ?? 0.94,
    uncertain: options.uncertain ?? false,
    chars,
    underline: null,
    row: Math.floor(y / 20),
  }
}

function makePage(lines: ScanLineLike[], page = 1): ScanPageLike {
  return {
    page,
    width: 800,
    height: 600,
    lines,
    rules: [],
  }
}

describe('buildScannedScore', () => {
  it('keeps four labelled voices in one system and preserves the metre', () => {
    const lines = [
      makeLine('header', 'Key: G Metre: 4/4', 20),
      makeLine('s', 'Soprano: Do Do Mi Mi | Re Re Fa Fa', 50),
      makeLine('a', 'Alto: Mi Mi So So | Fa Fa La La', 80),
      makeLine('t', 'Tenor: So So Do Do | La La Re Re', 110),
      makeLine('b', 'Bass: ,Do ,Do ,Mi ,Mi | ,Re ,Re ,Fa ,Fa', 140),
    ]
    const score = buildScannedScore({ 1: makePage(lines) })

    expect(score.key).toBe('G')
    expect(score.meter).toEqual({ num: 4, den: 4 })
    expect(score.systems).toHaveLength(1)
    expect(score.measures).toHaveLength(2)
    expect(score.parts).toEqual(['Soprano', 'Alto', 'Tenor', 'Bass'])
    expect(score.measures[0].flags).toEqual({
      openRepeat: false,
      closeRepeat: false,
      double: false,
      endings: [],
    })
    expect(score.meterInPlayerText).toBe(true)
    expect(score.playerText).toContain('Key: G')
    expect(score.playerText).toContain('Meter: 4/4')
    expect(score.playerText).toContain('Soprano\nDo Do Mi Mi | Re Re Fa Fa')
    expect(score.playerText).toContain('Bass\n,Do ,Do ,Mi ,Mi | ,Re ,Re ,Fa ,Fa')
    expect(parseSolfa(score.playerText).ok).toBe(true)
  })

  it('infers the four voices from vertical order when labels are missing', () => {
    const lines = [
      makeLine('one', 'Do Do | Re Re', 50),
      makeLine('two', 'Mi Mi | Fa Fa', 80),
      makeLine('three', 'So So | La La', 110),
      makeLine('four', 'Do, Do, | Re, Re,', 140),
    ]
    const score = buildScannedScore([makePage(lines)])

    expect(score.parts).toEqual(['Soprano', 'Alto', 'Tenor', 'Bass'])
    expect(score.systems[0].rows.map((row) => row.part)).toEqual([
      'Soprano',
      'Alto',
      'Tenor',
      'Bass',
    ])
    expect(score.warnings.some((warning) => warning.code === 'parts-inferred')).toBe(true)
    expect(score.playerText).toContain('Soprano\nDo Do | Re Re')
  })

  it('splits systems when part labels repeat and keeps measure order', () => {
    const lines = [
      makeLine('s1', 'Soprano: Do Do | Re Re', 50),
      makeLine('a1', 'Alto: Mi Mi | Fa Fa', 80),
      makeLine('s2', 'Soprano: So So | La La', 130),
      makeLine('a2', 'Alto: Ti Ti | Do Do', 160),
    ]
    const score = buildScannedScore([makePage(lines)])

    expect(score.systems).toHaveLength(2)
    expect(score.systems.map((system) => system.page)).toEqual([1, 1])
    expect(score.systems[0].measureIndexes).toEqual([0, 1])
    expect(score.systems[1].measureIndexes).toEqual([2, 3])
    expect(score.measures.map((measure) => measure.number)).toEqual([1, 2, 3, 4])
    expect(score.parts).toEqual(['Soprano', 'Alto'])
    expect(score.playerText).toContain('Soprano\nDo Do | Re Re | So So | La La')
  })

  it('fills shorter voices with rests without repeating notes', () => {
    const lines = [
      makeLine('s', 'Soprano: Do--- | Re---', 50),
      makeLine('a', 'Alto: Do | Re---', 80, { withChars: false }),
    ]
    const score = buildScannedScore([makePage(lines)])

    expect(score.measures[0].beats).toBe(4)
    expect(score.measures[1].beats).toBe(4)
    expect(score.playerText).toContain('Soprano\nDo--- | Re---')
    expect(score.playerText).toContain('Alto\nDo 0-- | Re---')
    expect(score.meter).toBe(null)
    const alto = score.measures[0].partEvents.Alto
    expect(alto.map((event) => event.solfa)).toEqual(['do'])
    expect(score.meterInPlayerText).toBe(false)
  })

  it('does not add a time signature when a bar is short', () => {
    const lines = [
      makeLine('header', 'Meter: 4/4', 20),
      makeLine('s', 'Soprano: Do-- | Re---', 50),
      makeLine('a', 'Alto: Do-- | Re---', 80),
    ]
    const score = buildScannedScore([makePage(lines)])

    expect(score.meter).toEqual({ num: 4, den: 4 })
    expect(score.measures[0].beats).toBe(3)
    expect(score.meterInPlayerText).toBe(false)
    expect(score.playerText).not.toContain('Meter:')
    expect(score.warnings.some((warning) => warning.code === 'meter-not-exported')).toBe(true)
  })

  it('preserves repeat and ending flags in the aligned text', () => {
    const lines = [
      makeLine('header', 'Meter: 3/4', 20),
      makeLine('s', 'Soprano: |: Do Do Do :|', 50),
    ]
    const score = buildScannedScore([makePage(lines)])

    expect(score.measures[0].flags.openRepeat).toBe(true)
    expect(score.measures[0].flags.closeRepeat).toBe(true)
    expect(score.meterInPlayerText).toBe(true)
    expect(score.playerText).toContain('|: Do Do Do :|')
    expect(parseSolfa(score.playerText).ok).toBe(true)
  })

  it('accepts an incomplete repeat on one scanned line', () => {
    const lines = [makeLine('s', 'Soprano: |: Do Do Do', 50)]
    const score = buildScannedScore([makePage(lines)])

    expect(score.events).toHaveLength(3)
    expect(score.measures[0].flags.openRepeat).toBe(true)
    expect(score.warnings.some((warning) => warning.code === 'unreadable-line')).toBe(false)
  })

  it('links events back to source characters and pages', () => {
    const lines = [makeLine('s', 'Soprano: Do Re | Mi Fa', 50)]
    const score = buildScannedScore([makePage(lines)])

    expect(score.events).toHaveLength(4)
    for (const event of score.events) {
      expect(event.sourceLineId).toBe('s')
      expect(event.source?.lineId).toBe('s')
      expect(event.source?.page).toBe(1)
      expect(event.source?.charIds.length).toBeGreaterThan(0)
      expect(event.source?.text.toLowerCase()).toContain(event.solfa || '')
    }
    expect(score.events[2].measure).toBe(1)
    expect(score.events[2].source?.bbox.x0).toBeGreaterThan(60)
  })

  it('lets a user reassign a line without losing the notes', () => {
    const lines = [makeLine('s', 'Soprano: Do Re | Mi Fa', 50)]
    const auto = buildScannedScore([makePage(lines)])
    const moved = buildScannedScore(
      [makePage(lines)],
      { partOverrides: { s: 'Bass' } }
    )

    expect(auto.playerText).toContain('Soprano\n')
    expect(moved.playerText).toContain('Bass\n')
    expect(moved.playerText).not.toContain('Soprano')
    expect(moved.events.map((event) => event.token)).toEqual(
      auto.events.map((event) => event.token)
    )
    expect(moved.systems[0].rows[0].assignment.source).toBe('user')
  })

  it('blocks playback when the user leaves a music line unassigned', () => {
    const lines = [makeLine('s', 'Soprano: Do Re | Mi Fa', 50)]
    const score = buildScannedScore(
      [makePage(lines)],
      { partOverrides: { s: null } }
    )

    expect(score.playerText).toBe('')
    expect(score.stats.unassignedLines).toBe(1)
    expect(score.warnings.some((warning) => warning.code === 'unassigned-lines')).toBe(true)
  })

  it('treats a single unlabelled melody as Main', () => {
    const lines = [makeLine('m', 'Do Re | Mi Fa', 50)]
    const score = buildScannedScore([makePage(lines)])

    expect(score.parts).toEqual(['Main'])
    expect(score.playerText).toContain('[Main]\nDo Re | Mi Fa')
    expect(score.warnings.some((warning) => warning.code === 'part-fallback')).toBe(true)
  })

  it('orders two page columns before matching systems', () => {
    const page = makePage(
      [
        makeLine('left-s', 'Soprano: Do Do', 50),
        makeLine('left-a', 'Alto: Mi Mi', 80),
        makeLine('right-s', 'Soprano: Re Re', 50),
        makeLine('right-a', 'Alto: Fa Fa', 80),
      ]
    )
    page.lines[2].chars = page.lines[2].chars.map((char) => ({
      ...char,
      bbox: {
        x0: char.bbox.x0 + 400,
        y0: char.bbox.y0,
        x1: char.bbox.x1 + 400,
        y1: char.bbox.y1,
      },
    }))
    page.lines[2].bbox = { ...page.lines[2].bbox, x0: 460, x1: 510 }
    page.lines[3].chars = page.lines[3].chars.map((char) => ({
      ...char,
      bbox: {
        x0: char.bbox.x0 + 400,
        y0: char.bbox.y0,
        x1: char.bbox.x1 + 400,
        y1: char.bbox.y1,
      },
    }))
    page.lines[3].bbox = { ...page.lines[3].bbox, x0: 460, x1: 510 }
    page.rules = [
      {
        id: 'split',
        orientation: 'vertical',
        x0: 400,
        y0: 30,
        x1: 400,
        y1: 500,
      },
    ]
    const score = buildScannedScore([page])

    expect(score.systems).toHaveLength(2)
    expect(score.systems[0].column).toBe(0)
    expect(score.systems[1].column).toBe(1)
    expect(score.systems[0].rows.map((row) => row.lineId)).toEqual(['left-s', 'left-a'])
    expect(score.systems[1].rows.map((row) => row.lineId)).toEqual(['right-s', 'right-a'])
  })

  it('extracts a combined key and metre header', () => {
    expect(extractHeaders('Key: Bb Metre: 6/8')).toEqual({
      key: 'Bb',
      meter: { num: 6, den: 8 },
    })
    expect(extractHeaders('Doh = A   Metre 3/4')).toEqual({
      key: 'A',
      meter: { num: 3, den: 4 },
    })
    expect(extractHeaders('Do Re Mi')).toBe(null)
  })
})
