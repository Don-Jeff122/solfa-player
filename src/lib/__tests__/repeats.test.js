import { describe, expect, it } from 'vitest'
import { parseSolfa } from '../parseSolfa.js'
import { expandBars } from '../repeats.js'

const expand = (text) => {
  const parsed = parseSolfa(text)
  expect(parsed.ok, parsed.ok ? '' : parsed.error.message).toBe(true)
  return expandBars(parsed.result.parts[0])
}

const tokens = (expanded) => expanded.notes.map((n) => n.token)

describe('expandBars', () => {
  it('returns notes unchanged when a part has no bar grid at all', () => {
    const e = expandBars({ notes: [{ token: 'Do' }, { token: 'Re' }] })
    expect(tokens(e)).toEqual(['Do', 'Re'])
    expect(e.order).toEqual([])
    expect(e.barStarts).toEqual([])
  })

  it('passes a sheet without bar marks through as one bar', () => {
    const e = expand('Do Re Mi')
    expect(tokens(e)).toEqual(['Do', 'Re', 'Mi'])
    expect(e.order).toEqual([0])
  })

  it('passes a one-bar sheet through untouched', () => {
    const e = expand('Do Re | Mi')
    expect(tokens(e)).toEqual(['Do', 'Re', 'Mi'])
    expect(e.order).toEqual([0, 1])
    expect(e.barStarts).toEqual([0, 2])
  })

  it('plays a |: ... :| section twice', () => {
    const e = expand('|: Do Re | Mi Fa :|')
    expect(tokens(e)).toEqual(['Do', 'Re', 'Mi', 'Fa', 'Do', 'Re', 'Mi', 'Fa'])
    expect(e.order).toEqual([0, 1, 0, 1])
    expect(e.barStarts).toEqual([0, 2, 4, 6])
  })

  it('plays the first ending on the first trip and second on the repeat', () => {
    const e = expand('|: Do Re | 1. Mi Fa :| 2. So Do |')
    expect(tokens(e)).toEqual(['Do', 'Re', 'Mi', 'Fa', 'Do', 'Re', 'So', 'Do'])
    expect(e.order).toEqual([0, 1, 0, 2])
  })

  it('repeats from the start when there is a :| but no |:', () => {
    const e = expand('Do Re | 1. Mi :| 2. So |')
    expect(tokens(e)).toEqual(['Do', 'Re', 'Mi', 'Do', 'Re', 'So'])
    expect(e.order).toEqual([0, 1, 0, 2])
  })

  it('handles several repeats in sequence', () => {
    const e = expand('|: Do :| Re |: Mi :| Fa')
    expect(tokens(e)).toEqual(['Do', 'Do', 'Re', 'Mi', 'Mi', 'Fa'])
    expect(e.order).toEqual([0, 0, 1, 2, 2, 3])
  })

  it('expands A-A-B-A form with a composed bar', () => {
    const e = expand('|: Do Do :| So Do |: Re Re :|')
    expect(tokens(e)).toEqual(['Do', 'Do', 'Do', 'Do', 'So', 'Do', 'Re', 'Re', 'Re', 'Re'])
  })

  it('counts bar starts through the expansion for the metronome', () => {
    const e = expand('Meter: 4/4\n|: Do Do Do Do :| Mi Mi Mi Mi')
    expect(e.order).toEqual([0, 0, 1])
    expect(e.barStarts).toEqual([0, 4, 8])
  })
})