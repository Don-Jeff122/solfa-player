import { describe, expect, it } from 'vitest'
import {
  ALL_PARTS,
  buildSequences,
  clampVoiceOctave,
  keyToSemitones,
  midiName,
  MIDI_FLOOR,
  midiToFreq,
  normalizeKey,
  noteToMidi,
  partOctave,
  PART_OCTAVES,
  sequenceBeats,
  solfaForMidi,
  tonicMidiForKey,
} from '../notes.js'

describe('notes', () => {
  it('computes frequencies', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 3)
    expect(midiToFreq(60)).toBeCloseTo(261.626, 2)
  })

  it('parses key names to semitones', () => {
    expect(keyToSemitones('C')).toBe(0)
    expect(keyToSemitones('C#')).toBe(1)
    expect(keyToSemitones('db')).toBe(1)
    expect(keyToSemitones('bb')).toBe(10)
    expect(keyToSemitones('b')).toBe(11)
    expect(keyToSemitones('H')).toBe(null)
    expect(keyToSemitones(null)).toBe(null)
  })

  it('normalizes key display', () => {
    expect(normalizeKey('bb')).toBe('Bb')
    expect(normalizeKey('f#')).toBe('F#')
    expect(normalizeKey('G')).toBe('G')
  })

  it('maps midi to note names', () => {
    expect(midiName(60)).toBe('C4')
    expect(midiName(61)).toBe('C#4')
    expect(midiName(71)).toBe('B4')
    expect(midiName(72)).toBe('C5')
  })

  it('gives tonic midi for keys', () => {
    expect(tonicMidiForKey('C')).toBe(60)
    expect(tonicMidiForKey('G')).toBe(67)
    expect(tonicMidiForKey('F#')).toBe(66)
    expect(tonicMidiForKey('C', 1)).toBe(72)
    expect(tonicMidiForKey('C', -1)).toBe(48)
  })

  it('gives solfa for diatonic pitch classes of a key', () => {
    const tonic = tonicMidiForKey('G')
    expect(solfaForMidi(67, tonic)).toBe('Do')
    expect(solfaForMidi(69, tonic)).toBe('Re')
    expect(solfaForMidi(71, tonic)).toBe('Mi')
    expect(solfaForMidi(72, tonic)).toBe('Fa')
    expect(solfaForMidi(74, tonic)).toBe('So')
    expect(solfaForMidi(76, tonic)).toBe('La')
    expect(solfaForMidi(78, tonic)).toBe('Ti')
    expect(solfaForMidi(73, tonic)).toBe('Fi')
  })

  it('converts solfa notes to midi with octaves', () => {
    expect(noteToMidi({ solfa: 'do', up: 0, down: 0 })).toBe(60)
    expect(noteToMidi({ solfa: 'la', up: 0, down: 0 }, 67)).toBe(76)
    expect(noteToMidi({ solfa: 'do', up: 1, down: 0 })).toBe(72)
    expect(noteToMidi({ solfa: 'do', up: 0, down: 1 })).toBe(48)
    expect(noteToMidi({ solfa: 'so', up: 0, down: 0 })).toBe(67)
    expect(noteToMidi({ solfa: null, up: 0, down: 0 })).toBe(null)
  })

  it('builds sequences for a single part and all parts', () => {
    const result = {
      key: null,
      parts: [
        {
          name: 'Main',
          notes: [
            { token: 'Do', solfa: 'do', up: 0, down: 0, beats: 1, line: 1 },
            { token: '0', solfa: null, up: 0, down: 0, beats: 1, line: 1 },
          ],
        },
        {
          name: 'Bass',
          notes: [{ token: ',Do', solfa: 'do', up: 0, down: 1, beats: 2, line: 2 }],
        },
      ],
    }

    const all = buildSequences(result, 'C', 0, ALL_PARTS)
    expect(all.map((s) => s.name)).toEqual(['Main', 'Bass'])
    expect(all[0].notes[0].midi).toBe(60)
    expect(all[0].notes[1].midi).toBe(null)
    // The Bass voice sits two octaves down by default, then ,Do drops one more.
    expect(all[1].notes[0].midi).toBe(24)

    const solo = buildSequences(result, 'G', 1, 'Bass')
    expect(solo.length).toBe(1)
    expect(solo[0].notes[0].midi).toBe(67 + 12 - 24 - 12)

    expect(sequenceBeats({ notes: [{ beats: 2 }, { beats: 3 }] })).toBe(5)
  })

  describe('chromatic solfa', () => {
    const midiOf = (solfa, key = 'C', up = 0, down = 0) =>
      noteToMidi({ solfa, up, down }, tonicMidiForKey(key))

    it('raises a note by a semitone', () => {
      expect(midiOf('di')).toBe(61)
      expect(midiOf('ri')).toBe(63)
      expect(midiOf('fi')).toBe(66)
      expect(midiOf('si')).toBe(68)
      expect(midiOf('li')).toBe(70)
    })

    it('lowers a note by a semitone', () => {
      expect(midiOf('ra')).toBe(59)
      expect(midiOf('me')).toBe(61)
      expect(midiOf('se')).toBe(64)
      expect(midiOf('le')).toBe(66)
      expect(midiOf('te')).toBe(68)
    })

    it('sounds a falling semitone as Do then Ra', () => {
      expect(midiOf('do') - midiOf('ra')).toBe(1)
    })

    it('follows the key, so Ti is the F sharp of G', () => {
      expect(midiName(midiOf('ti', 'G'))).toBe('F#5')
      expect(midiName(midiOf('fa', 'G'))).toBe('C5')
    })

    it('raises fa itself, not the key signature', () => {
      // Movable-do names the note, not the key: Fi is fa raised, so in G it is
      // C sharp, while the F sharp that G already has is called Ti.
      expect(midiOf('fi', 'G')).toBe(73)
      expect(midiName(midiOf('fi', 'G'))).toBe('C#5')
      expect(midiOf('ti', 'G')).toBe(78)
    })

    it('takes octave marks', () => {
      expect(midiOf('di', 'C', 1)).toBe(73)
      expect(midiOf('di', 'C', 0, 1)).toBe(49)
      expect(midiOf('ra', 'C', 0, 1)).toBe(47)
    })

    it('names the chromatic pitch classes on the keyboard', () => {
      expect(solfaForMidi(61, 60)).toBe('Di')
      expect(solfaForMidi(70, 60)).toBe('Li')
      expect(solfaForMidi(71, 60)).toBe('Ti')
    })
  })

  describe('voice octaves', () => {
    const choir = {
      key: null,
      parts: ['Soprano', 'Alto', 'Tenor', 'Bass'].map((name) => ({
        name,
        notes: [{ token: 'Do', solfa: 'do', up: 0, down: 0, beats: 1, line: 1 }],
      })),
    }
    const sounding = (result, key, octave, voices) =>
      buildSequences(result, key, octave, ALL_PARTS, voices).map((s) => ({
        name: s.name,
        midi: s.notes[0].midi,
      }))

    it('gives each named voice its usual register', () => {
      expect(partOctave('Soprano')).toBe(0)
      expect(partOctave('Alto')).toBe(0)
      expect(partOctave('Tenor')).toBe(-1)
      expect(partOctave('Bass')).toBe(-2)
      expect(PART_OCTAVES.bass).toBe(-2)
    })

    it('ignores case, spacing and unknown names', () => {
      expect(partOctave('bass')).toBe(-2)
      expect(partOctave('  TENOR ')).toBe(-1)
      expect(partOctave('[Baritone]')).toBe(0)
      expect(partOctave('Main')).toBe(0)
      expect(partOctave('')).toBe(0)
      expect(partOctave(undefined)).toBe(0)
    })

    it('lifts a doubly-marked bass note off the inaudible bottom octave', () => {
      // Registers and printed octave marks stack, so a bass ,,Do reached C0 at
      // 16 Hz, which is silent on any speaker rather than deep.
      const result = {
        parts: [{
          name: 'Bass',
          notes: [
            { token: ',,Do', solfa: 'do', up: 0, down: 2, beats: 1, line: 1 },
            { token: ',Do', solfa: 'do', up: 0, down: 1, beats: 1, line: 1 },
          ],
        }],
      }
      const [bass] = buildSequences(result, 'C', 0, ALL_PARTS, null)
      expect(bass.notes[0].midi).toBe(MIDI_FLOOR)
      expect(bass.notes[1].midi).toBe(24)
      expect(MIDI_FLOOR).toBe(24)
    })

    it('puts the Bass two octaves below the Soprano on the same do', () => {
      expect(sounding(choir, 'C', 0)).toEqual([
        { name: 'Soprano', midi: 60 },
        { name: 'Alto', midi: 60 },
        { name: 'Tenor', midi: 48 },
        { name: 'Bass', midi: 36 },
      ])
    })

    it('lets one voice override its register without touching the others', () => {
      expect(sounding(choir, 'C', 0, { Bass: -3 })).toEqual([
        { name: 'Soprano', midi: 60 },
        { name: 'Alto', midi: 60 },
        { name: 'Tenor', midi: 48 },
        { name: 'Bass', midi: 24 },
      ])
      expect(sounding(choir, 'C', 0, { Tenor: 1 })[2].midi).toBe(72)
    })

    it('ignores overrides for voices the sheet does not have', () => {
      expect(sounding(choir, 'C', 0, { Trumpet: -2 })).toEqual(sounding(choir, 'C', 0))
    })

    it('still shifts every voice with the global octave control', () => {
      expect(sounding(choir, 'C', 1).map((v) => v.midi)).toEqual([72, 72, 60, 48])
    })

    it('applies octave marks on top of the voice register', () => {
      const marked = {
        key: null,
        parts: [
          {
            name: 'Bass',
            notes: [
              { token: ',Do', solfa: 'do', up: 0, down: 1, beats: 2, line: 1 },
              { token: "Do'", solfa: 'do', up: 1, down: 0, beats: 1, line: 1 },
            ],
          },
        ],
      }
      const seqs = buildSequences(marked, 'C', 0, ALL_PARTS)
      // The -2 register puts the bass's own do on C2, so ,Do lands on C1
      // and Do' reaches up to C3.
      expect(seqs[0].notes.map((n) => midiName(n.midi))).toEqual(['C1', 'C3'])
      const lifted = buildSequences(marked, 'C', 0, ALL_PARTS, { Bass: -1 })
      expect(lifted[0].notes.map((n) => midiName(n.midi))).toEqual(['C2', 'C4'])
    })

    it('clamps a voice register to the supported range', () => {
      expect(clampVoiceOctave(9)).toBe(3)
      expect(clampVoiceOctave(-9)).toBe(-3)
      expect(clampVoiceOctave('2')).toBe(2)
      expect(clampVoiceOctave('nope')).toBe(0)
      expect(buildSequences(choir, 'C', 0, ALL_PARTS, { Bass: 99 })[3].notes[0].midi).toBe(96)
    })

    it('leaves a single-voice sheet at written pitch', () => {
      const one = { key: null, parts: [{ name: 'Main', notes: [{ solfa: 'do', up: 0, down: 0, beats: 1 }] }] }
      expect(buildSequences(one, 'C', 0, ALL_PARTS)[0].notes[0].midi).toBe(60)
    })
  })
})
