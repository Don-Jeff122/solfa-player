import { describe, expect, it } from 'vitest'
import {
  AUDIVERIS_STEPS,
  buildAudiverisArgs,
  isAudiverisAvailable,
  parseAudiverisLine,
  resolveAudiverisBin,
} from '../audiveris.js'

describe('Audiveris adapter', () => {
  it('builds the batch transcribe/export command with decompressed output', () => {
    const args = buildAudiverisArgs({ inputPath: '/tmp/source.pdf', outputDir: '/tmp/out' })
    expect(args).toEqual([
      '-batch',
      '-transcribe',
      '-export',
      '-swap',
      '-constant',
      'org.audiveris.omr.sheet.BookManager.useCompression=false',
      '-output',
      '/tmp/out',
      '--',
      '/tmp/source.pdf',
    ])
  })

  it('parses StepMonitoring progress lines without matching summary logs', () => {
    const parsed = parseAudiverisLine(
      '2026-11-17 01:49:21,803 INFO [Score-sheet#2] StepMonitoring.java:98 | PAGE'
    )
    expect(parsed.step).toBe('PAGE')
    expect(parsed.stepIndex).toBe(AUDIVERIS_STEPS.indexOf('PAGE'))
    expect(parsed.totalSteps).toBe(AUDIVERIS_STEPS.length)
    expect(parsed.sheet).toBe(2)
    expect(parseAudiverisLine('Book reaching PAGE on sheets:[#1]')).toBeNull()
    expect(parseAudiverisLine('INFO | Stored /sheet#1/BINARY.png')).toBeNull()
    expect(parseAudiverisLine('Nothing useful here')).toBeNull()
  })

  it('honours AUDIVERIS_BIN before probing platform paths', () => {
    expect(resolveAudiverisBin({ env: { AUDIVERIS_BIN: 'C:\\custom\\Audiveris.exe' } })).toBe(
      'C:\\custom\\Audiveris.exe'
    )
  })

  it('returns the first existing executable candidate', () => {
    const path = resolveAudiverisBin({
      env: { ProgramFiles: 'C:\\Program Files' },
      platform: 'win32',
      existsSync: (candidate) => candidate.endsWith('Audiveris.exe'),
    })
    expect(path).toContain('Audiveris.exe')
  })

  it('reports availability for absolute paths and PATH commands accurately', () => {
    const absolute = 'C:\\missing\\Audiveris.exe'
    expect(
      isAudiverisAvailable(absolute, { platform: 'win32', existsSync: () => false })
    ).toBe(false)
    expect(
      isAudiverisAvailable('Audiveris', {
        platform: 'linux',
        env: { PATH: '/usr/local/bin:/usr/bin' },
        existsSync: (candidate) => candidate === '/usr/bin/Audiveris',
      })
    ).toBe(true)
    expect(
      isAudiverisAvailable('Audiveris', {
        platform: 'linux',
        env: { PATH: '/usr/local/bin' },
        existsSync: () => false,
      })
    ).toBe(false)
  })
})
