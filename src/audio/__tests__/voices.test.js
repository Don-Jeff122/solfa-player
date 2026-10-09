import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_NODES_PER_PLAYBACK,
  MAX_SIMULTANEOUS_NOTES,
  newPlaybackBudget,
  noteCost,
  Synth,
} from '../Synth.js'
import {
  DEFAULT_SUSTAIN_ID,
  DEFAULT_VOICE_ID,
  getVoice,
  normalisedPartials,
  normalizeVoiceId,
  SUSTAIN_OPTIONS,
  sustainSeconds,
  VOICE_LIST,
  VOICE_PRESETS,
  voiceBanks,
  voiceFormants,
  voiceSources,
} from '../voices.js'
import { installFakeAudio, createFakeContext, nodeCount, nodesOfKind, scheduled } from './fakeAudio.js'

const IDS = Object.keys(VOICE_PRESETS)
const values = (list) => list.map((v) => v.value)

describe('instrument presets', () => {
  it('lists every preset for the picker', () => {
    expect(VOICE_LIST.map((v) => v.id)).toEqual(IDS)
    expect(new Set(VOICE_LIST.map((v) => v.id)).size).toBe(IDS.length)
    for (const { label } of VOICE_LIST) expect(label).toBeTruthy()
  })

  it('includes the instruments the app is expected to offer', () => {
    for (const id of ['piano', 'organ', 'churchOrgan', 'guitar', 'strings', 'flute', 'voice']) {
      expect(VOICE_PRESETS[id], id).toBeTruthy()
    }
    expect(getVoice(DEFAULT_VOICE_ID)).toBeTruthy()
  })

  it('falls back to the default voice for an unknown id', () => {
    expect(normalizeVoiceId('organ')).toBe('organ')
    for (const bad of ['nope', '', null, undefined, 42, 'toString']) {
      expect(normalizeVoiceId(bad)).toBe(DEFAULT_VOICE_ID)
      expect(getVoice(bad)).toBe(getVoice(DEFAULT_VOICE_ID))
    }
  })

  it('keeps every envelope safe for exponential ramps', () => {
    for (const [id, v] of Object.entries(VOICE_PRESETS)) {
      expect(v.peak, `${id} peak`).toBeGreaterThan(0)
      expect(v.peak, `${id} peak`).toBeLessThanOrEqual(1)
      expect(v.attack, `${id} attack`).toBeGreaterThanOrEqual(0)
      expect(v.sustain, `${id} sustain`).toBeGreaterThan(0)
      expect(v.sustain, `${id} sustain`).toBeLessThanOrEqual(1)
      expect(v.decayPortion, `${id} decayPortion`).toBeGreaterThanOrEqual(0)
      expect(v.decayPortion, `${id} decayPortion`).toBeLessThanOrEqual(1)
      expect(v.release, `${id} release`).toBeGreaterThan(0)
    }
  })

  it('holds a steady tone whenever there is nothing to decay', () => {
    for (const [id, v] of Object.entries(VOICE_PRESETS)) {
      if (v.sustain < 1) continue
      expect(v.decayPortion, `${id} sustains but decays`).toBe(0)
    }
  })

  it('balances partial gains so peak means the real amplitude', () => {
    for (const [id, v] of Object.entries(VOICE_PRESETS)) {
      const partials = normalisedPartials(v)
      if (!partials.length) continue
      const total = partials.reduce((sum, p) => sum + p.gain, 0)
      expect(total, `${id} partial sum`).toBeCloseTo(1, 10)
      for (const p of partials) {
        expect(Number.isFinite(p.mult), `${id} mult`).toBe(true)
        expect(p.mult).toBeGreaterThan(0)
        expect(p.gain).toBeGreaterThan(0)
      }
    }
  })

  it('offers a ring-out choice for the player', () => {
    expect(SUSTAIN_OPTIONS.map((o) => o.id)).toEqual(['off', 'short', 'medium', 'long'])
    expect(SUSTAIN_OPTIONS.every((o) => typeof o.label === 'string' && o.label)).toBe(true)
    expect(sustainSeconds('off')).toBe(0)
    expect(sustainSeconds('long')).toBeGreaterThan(sustainSeconds('medium'))
    expect(sustainSeconds('medium')).toBeGreaterThan(sustainSeconds('short'))
    // Anything unrecognised falls back to the default rather than silence.
    expect(sustainSeconds('nonsense')).toBe(sustainSeconds(DEFAULT_SUSTAIN_ID))
    expect(sustainSeconds(undefined)).toBe(sustainSeconds(DEFAULT_SUSTAIN_ID))
  })

  it('offers a tone for playing hymns', () => {
    const hymn = VOICE_PRESETS.hymn
    expect(hymn).toBeTruthy()
    expect(VOICE_LIST.some((v) => v.id === 'hymn' && v.label === 'Hymn Organ')).toBe(true)
    expect(hymn.sustain).toBe(1)
    // A pedal rank under the principal, and a long ring so chords bloom.
    const mults = normalisedPartials(hymn).map((p) => p.mult)
    expect(mults).toContain(0.5)
    expect(mults).toContain(1)
    expect(hymn.release).toBeGreaterThan(1)
    expect(hymn.attack).toBeGreaterThanOrEqual(0.1)
  })

  it('gives every preset at least one sounding source', () => {    for (const [id, v] of Object.entries(VOICE_PRESETS)) {
      const sources = voiceSources(v)
      expect(sources.length, id).toBeGreaterThan(0)
      const total = sources.reduce((sum, s) => sum + s.gain, 0)
      expect(total, `${id} source sum`).toBeCloseTo(1, 10)
      for (const s of sources) {
        expect(['sine', 'square', 'sawtooth', 'triangle'], `${id} ${s.type}`).toContain(s.type)
        expect(s.mult).toBeGreaterThan(0)
      }
    }
  })

  it('keeps the balance between an osc and its partials', () => {
    const mixed = voiceSources({ osc: { type: 'sawtooth', gain: 0.5 }, partials: [{ mult: 1, gain: 1 }] })
    expect(mixed.map((s) => s.gain)).toEqual([1 / 3, 2 / 3])
    expect(voiceSources({}).length).toBe(1)
  })

  it('keeps filter settings inside what Web Audio accepts', () => {
    for (const [id, v] of Object.entries(VOICE_PRESETS)) {
      if (!v.filter) continue
      expect(v.filter.open, `${id} open`).toBeGreaterThan(0)
      expect(v.filter.close, `${id} close`).toBeGreaterThan(0)
      expect(v.filter.open, `${id} open above close`).toBeGreaterThan(v.filter.close)
      expect(v.filter.floor, `${id} floor`).toBeGreaterThan(0)
      expect(v.filter.cap, `${id} cap`).toBeGreaterThan(v.filter.floor)
      expect(v.filter.cap, `${id} cap`).toBeLessThanOrEqual(20000)
      expect(v.filter.q, `${id} q`).toBeGreaterThanOrEqual(0)
      if ('sweep' in v.filter) expect(v.filter.sweep, `${id} sweep`).toBeGreaterThan(0)
    }
  })

  it('keeps the optional layers usable', () => {
    for (const [id, v] of Object.entries(VOICE_PRESETS)) {
      if (v.fm) {
        expect(v.fm.ratio, `${id} fm ratio`).toBeGreaterThan(0)
        expect(v.fm.index, `${id} fm index`).toBeGreaterThan(0)
        expect(v.fm.decay, `${id} fm decay`).toBeGreaterThan(0)
      }
      if (v.noise) {
        expect(v.noise.gain, `${id} noise gain`).toBeGreaterThan(0)
        expect(v.noise.decay, `${id} noise decay`).toBeGreaterThan(0)
      }
      if (v.vibrato) {
        expect(v.vibrato.rate, `${id} vibrato rate`).toBeGreaterThan(0)
        expect(v.vibrato.depth, `${id} vibrato depth`).toBeGreaterThan(0)
      }
      if (v.chorus) {
        expect(v.chorus.cents, `${id} chorus cents`).not.toBe(0)
        expect(v.chorus.gain, `${id} chorus gain`).toBeGreaterThan(0)
        expect(v.chorus.gain, `${id} chorus gain`).toBeLessThanOrEqual(1)
      }
      const formants = voiceFormants(v)
      if (formants.length) {
        const total = formants.reduce((sum, f) => sum + f.gain, 0)
        expect(total, `${id} formant sum`).toBeCloseTo(3, 10)
        for (const f of formants) {
          expect(f.freq, `${id} formant`).toBeGreaterThan(20)
          expect(f.freq, `${id} formant`).toBeLessThan(20000)
          expect(f.q, `${id} formant q`).toBeGreaterThan(0)
        }
      } else {
        expect(v.formants, `${id} empty formants`).toBeFalsy()
      }
    }
  })

  it('sustains an organ and plucks a piano', () => {
    expect(VOICE_PRESETS.organ.sustain).toBe(1)
    expect(VOICE_PRESETS.organ.release).toBeLessThan(1)
    expect(VOICE_PRESETS.piano.sustain).toBeLessThan(0.5)
    expect(VOICE_PRESETS.piano.decayPortion).toBeGreaterThan(0.5)
    expect(VOICE_PRESETS.bell.release).toBeGreaterThan(2)
  })

  it('gives every instrument a hymn-adequate voice', () => {
    const church = VOICE_PRESETS.churchOrgan
    expect(church.sustain).toBe(1)
    expect(church.attack).toBeGreaterThanOrEqual(0.05)
    expect(church.release).toBeLessThan(1)
    // A 16' pedal under the 8' principal is what makes it sound like an organ.
    const mults = normalisedPartials(church).map((p) => p.mult)
    expect(mults).toContain(0.5)
    expect(mults).toContain(1)
    expect(mults).toContain(2)
    // Choir, pedal and a mixture above the principal.
    expect(mults.length).toBeGreaterThanOrEqual(6)
  })

  it('keeps every instrument as present as the piano', () => {
    const reference = VOICE_PRESETS.piano.peak
    for (const [id, v] of Object.entries(VOICE_PRESETS)) {
      expect(v.peak, `${id} too quiet`).toBeGreaterThan(reference * 0.75)
      expect(v.peak, `${id} too loud`).toBeLessThan(reference * 1.3)
    }
  })

  it('does not let an instrument die away early', () => {
    for (const [id, v] of Object.entries(VOICE_PRESETS)) {
      // Either it holds its level, decays slowly across the note, or rings on.
      const holds = v.sustain >= 0.25
      const decaysSlowly = v.decayPortion >= 0.5
      const ringsOn = v.release >= 1.5
      expect(holds || decaysSlowly || ringsOn, `${id} fades out too soon`).toBe(true)
    }
  })

  it('keeps a formant voice audible with a dry path', () => {
    expect(VOICE_PRESETS.voice.formants).toBeTruthy()
    expect(VOICE_PRESETS.voice.direct).toBeGreaterThan(0)
    expect(VOICE_PRESETS.voice.direct).toBeLessThan(1)
    for (const [id, v] of Object.entries(VOICE_PRESETS)) {
      if (!v.formants) expect(v.direct, `${id} stray direct`).toBeFalsy()
    }
  })
})

describe('synth voice graphs', () => {
  let fake = null
  afterEach(() => {
    if (fake) fake.restore()
    fake = null
  })

  // Each note gets its own context so the recorded graph is not polluted by
  // the previous note in the same test.
  const schedule = (voiceId, { midi = 60, t0 = 1, dur = 0.5, sustain = 0 } = {}) => {
    const ctx = createFakeContext()
    const synth = new Synth()
    synth._scheduleNote(ctx, ctx.createGain(), midi, t0, dur, 0.95, voiceId, sustain)
    return ctx.log
  }

  it('builds a legal graph for every preset', () => {
    for (const id of IDS) {
      const log = schedule(id)
      const oscillators = nodesOfKind(log, 'oscillator')
      expect(oscillators.length, `${id} oscillators`).toBeGreaterThan(0)
      for (const osc of oscillators) {
        expect(osc.started, `${id} oscillator started`).toBe(true)
        expect(osc.stopped, `${id} oscillator stopped`).toBe(true)
      }
      const filters = nodesOfKind(log, 'filter')
      expect(filters.length, `${id} filters`).toBeGreaterThan(0)
      for (const v of values(scheduled(log, 'frequency'))) {
        expect(Number.isFinite(v), `${id} filter frequency`).toBe(true)
        expect(v, `${id} filter frequency`).toBeGreaterThan(0)
      }
    }
  })

  it('adds a filter, formants and vibrato only where the preset asks', () => {
    expect(nodesOfKind(schedule('organ'), 'filter').length).toBe(1)
    expect(nodesOfKind(schedule('voice'), 'filter').length).toBe(4) // lowpass + 3 bands
    expect(scheduled(schedule('strings'), 'detune').length).toBeGreaterThan(0)
    expect(scheduled(schedule('piano'), 'detune').length).toBe(0)
    expect(nodesOfKind(schedule('flute'), 'bufferSource').length).toBe(1)
    expect(nodesOfKind(schedule('piano'), 'bufferSource').length).toBe(0)
  })

  it('folds the organ ranks into one periodic wave and keeps the pedal', () => {
    const log = schedule('churchOrgan')
    // Six whole-number ranks become a single PeriodicWave; the 0.5 pedal rank
    // cannot be expressed that way and keeps its own oscillator. Then the
    // chorus copy and the vibrato LFO.
    expect(nodesOfKind(log, 'oscillator').length).toBe(4)
    expect(nodesOfKind(log, 'wave').length).toBe(2)
    expect(nodesOfKind(log, 'bufferSource').length).toBe(1)
    expect(scheduled(log, 'detune').length).toBe(1)
    // The pedal rank sounds an octave below the principal.
    const freqs = scheduled(log, 'frequency')
      .filter((f) => f.kind === 'set' && f.value > 0)
      .map((f) => f.value)
    expect(freqs.some((f) => Math.abs(f - 130.8) < 1)).toBe(true)
    expect(freqs.some((f) => Math.abs(f - 261.6) < 1)).toBe(true)
    // Only the fundamental is doubled: it appears twice, once plain and once
    // detuned, while the pedal rank is not duplicated.
    const atPrincipal = freqs.filter((f) => Math.abs(f - 261.6) < 1).length
    const atPedal = freqs.filter((f) => Math.abs(f - 130.8) < 1).length
    expect(atPrincipal).toBe(2)
    expect(atPedal).toBe(1)
  })

  it('detunes only the fundamental so the ranks stay cheap', () => {
    // Doubling every partial doubled the organ family's oscillator count for a
    // shimmer nobody hears, and four parts of hymn asked the browser for over
    // a thousand nodes.
    for (const id of ['organ', 'churchOrgan', 'hymn', 'strings', 'synth']) {
      const detuned = scheduled(schedule(id), 'detune')
      expect(detuned.length, id).toBe(1)
    }
  })

  it('keeps a formant voice from being filtered away entirely', () => {
    const log = schedule('voice')
    // lowpass, three bands, and a dry gain node carrying the bypass level.
    const levels = nodesOfKind(log, 'gain').map((n) => n.gain.value)
    expect(levels).toContain(VOICE_PRESETS.voice.direct)
  })

  it('gives a piano note a decaying envelope ending above silence', () => {
    const log = schedule('piano', { t0: 2, dur: 0.5 })
    const gains = scheduled(log, 'gain').filter((g) => g.kind !== 'cancel')
    const ramps = gains.filter((g) => g.kind === 'exponential').map((g) => g.value)
    expect(ramps.length).toBeGreaterThanOrEqual(3)
    expect(ramps[ramps.length - 1]).toBeLessThan(ramps[0])
    for (const r of ramps) expect(r).toBeGreaterThan(0)
  })

  it('plays every midi note without throwing', () => {
    for (const id of IDS) {
      for (const midi of [21, 36, 60, 84, 108]) {
        expect(() => schedule(id, { midi, t0: 0, dur: 0.1 }), `${id} @ ${midi}`).not.toThrow()
      }
    }
  })

  it('falls back to the piano when handed a bad id', () => {
    const bad = schedule('does-not-exist')
    const good = schedule('piano')
    expect(bad.filter((n) => n.kind === 'oscillator').length).toBe(
      good.filter((n) => n.kind === 'oscillator').length
    )
  })

  it('reuses one noise buffer across notes', () => {
    const ctx = createFakeContext()
    const synth = new Synth()
    const dest = ctx.createGain()
    synth._scheduleNote(ctx, dest, 60, 1, 0.5, 0.95, 'flute')
    synth._scheduleNote(ctx, dest, 64, 2, 0.5, 0.95, 'flute')
    const sources = nodesOfKind(ctx.log, 'bufferSource')
    expect(sources.length).toBe(2)
    expect(sources[0].buffer).toBe(sources[1].buffer)
    expect(sources[0].buffer.sampleRate).toBe(44100)
  })

  it('holds the note until it is over instead of fading across it', () => {
    // The envelope must pin its level for the whole note. If it does not, the
    // release ramp decays from the attack and a sustained instrument is
    // inaudible halfway through a long note.
    const t0 = 2
    const dur = 4
    for (const id of IDS) {
      const gainEvents = scheduled(schedule(id, { t0, dur }), 'gain').filter(
        (e) => e.kind !== 'cancel'
      )
      const hold = gainEvents.filter(
        (e) => e.kind === 'set' && e.time >= t0 + dur - 1e-9 && e.value > 0.0001
      )
      expect(hold.length, `${id} never holds to the end of the note`).toBeGreaterThan(0)
      // The final ramp down has to start after that hold, not during the note.
      const releaseRamp = gainEvents.filter((e) => e.kind === 'exponential').at(-1)
      expect(releaseRamp.time).toBeGreaterThanOrEqual(t0 + dur)
      expect(releaseRamp.value).toBeLessThan(hold[0].value)
    }
  })

  it('stops every oscillator after the note rings out', () => {
    const t0 = 2
    const dur = 1
    const ring = 3
    for (const id of IDS) {
      const log = schedule(id, { t0, dur, sustain: ring })
      for (const osc of nodesOfKind(log, 'oscillator')) {
        expect(osc.stopTime).toBeGreaterThanOrEqual(t0 + dur + ring)
      }
    }
  })

  it('adds the chosen ring-out on top of the instrument release', () => {
    const releaseEnd = (log) =>
      Math.max(
        ...scheduled(log, 'gain')
          .filter((e) => e.kind === 'exponential')
          .map((e) => e.time)
      )
    for (const id of ['piano', 'organ', 'hymn', 'bell']) {
      const off = releaseEnd(schedule(id, { t0: 1, dur: 1, sustain: 0 }))
      const long = releaseEnd(schedule(id, { t0: 1, dur: 1, sustain: 3 }))
      expect(long - off, id).toBeCloseTo(3, 6)
    }
  })

  it('does not let a long note fade before it ends', () => {
    // On a four-second note a sustained instrument must still be at full level
    // when the note is over, not a fraction of it. Anything above the noise
    // layer counts as envelope.
    for (const id of ['organ', 'churchOrgan', 'hymn', 'strings', 'flute', 'voice', 'synth']) {
      const voice = getVoice(id)
      const peak = voice.peak * 0.95
      const expected = voice.sustain < 0.999 ? peak * voice.sustain : peak
      const sets = scheduled(schedule(id, { t0: 0, dur: 4 }), 'gain').filter(
        (e) => e.kind === 'set' && e.value > 0.05 && e.time >= 4
      )
      expect(sets.length, `${id} holds nothing to the end of the note`).toBeGreaterThan(0)
      for (const hold of sets) {
        expect(Math.abs(hold.value - expected), `${id} faded before the note ended`).toBeLessThan(0.001)
      }
    }
  })

  it('sounds every note of a four-part hymn on every instrument', () => {
    // The failure this guards against: combining all four parts asks the audio
    // thread for a huge number of nodes at once, and the heavy presets used to
    // drop out entirely. Every note must still be scheduled, on every preset.
    const chord = (midis) => ({
      notes: midis.flatMap((midi) => [{ midi, beats: 4 }]),
    })
    const seqs = [
      { name: 'Soprano', notes: chord([76, 79, 83]).notes },
      { name: 'Alto', notes: chord([72, 76, 79]).notes },
      { name: 'Tenor', notes: chord([64, 67, 72]).notes },
      { name: 'Bass', notes: chord([52, 55, 60]).notes },
    ]
    const noteCount = seqs.reduce((total, seq) => total + seq.notes.length, 0)
    expect(noteCount).toBe(12)

    for (const id of IDS) {
      const ctx = createFakeContext()
      const synth = new Synth()
      const result = synth._scheduleAll(ctx, ctx.destination, seqs, 0.08, 60 / 90, id, 3)
      const started = nodesOfKind(ctx.log, 'oscillator').filter((n) => n.started)
      // Every note must be there, on every instrument, at full detail.
      expect(result.skipped, `${id} dropped notes`).toBe(0)
      expect(result.trimmed, `${id} was stripped back`).toBe(0)
      expect(started.length, `${id} lost notes`).toBeGreaterThanOrEqual(noteCount)
      // ...and the notes sounding at once must stay inside the node budget,
      // otherwise the browser's audio thread drops out and you hear nothing.
      expect(result.nodes, `${id} overloads the audio thread`).toBeLessThanOrEqual(
        MAX_NODES_PER_PLAYBACK,
      )
    }
  })

  it('counts every node it builds, so the budget cannot be fooled', () => {
    // If the estimate were lower than the real graph, the budget would let
    // through more than it thinks and the thread would still fall over.
    for (const id of IDS) {
      const ctx = createFakeContext()
      const synth = new Synth()
      synth._scheduleAll(ctx, ctx.destination, [{ notes: [{ midi: 60, beats: 4 }] }], 0.08, 0.5, id, 0)
      // The destination is created by the fake, not by the synth.
      expect(nodeCount(ctx.log) - 1, `${id} builds more nodes than budgeted`).toBeLessThanOrEqual(
        noteCost(getVoice(id)),
      )
    }
  })

  it('keeps every instrument within the node budget on its own', () => {
    // The reported symptom was that only the piano survived four-part playing.
    for (const [id, v] of Object.entries(VOICE_PRESETS)) {
      expect(noteCost(v), id).toBeGreaterThan(0)
      expect(noteCost(v), id).toBeLessThan(MAX_NODES_PER_PLAYBACK)
    }
  })

  it('caps absurd polyphony instead of dropping ordinary notes', () => {
    const ctx = createFakeContext()
    const synth = new Synth()
    // Thirty parts, far beyond any real score, all striking at once.
    const total = 120
    const seqs = [
      { notes: Array.from({ length: total }, () => ({ midi: 60, beats: 8 })) },
    ]
    const result = synth._scheduleAll(ctx, ctx.destination, seqs, 0.08, 0.6, 'hymn', 3)
    // Notes are only shed past the polyphony cap, never for being expensive.
    expect(result.skipped).toBeLessThanOrEqual(total - MAX_SIMULTANEOUS_NOTES)
    expect(result.nodes).toBeLessThanOrEqual(MAX_NODES_PER_PLAYBACK)
  })

  it('thins an instrument that would overload the audio thread', () => {
    const ctx = createFakeContext()
    const synth = new Synth()
    // A deliberately extravagant preset, inharmonic so no periodic wave can
    // fold it, to prove the fallback tiers still work.
    VOICE_PRESETS.__huge = {
      ...VOICE_PRESETS.churchOrgan,
      label: 'Huge',
      wave: false,
      partials: Array.from({ length: 20 }, (_, i) => ({ mult: i + 0.5, gain: 1 })),
      formants: [{ freq: 700, q: 9, gain: 1 }, { freq: 1200, q: 9, gain: 1 }],
      fm: { ratio: 3, index: 200, decay: 0.2 },
    }
    try {
      expect(noteCost(getVoice('__huge'))).toBeGreaterThan(40)
      const seqs = Array.from({ length: 12 }, (_, p) => ({
        name: `part${p}`,
        notes: Array.from({ length: 2 }, () => ({ midi: 60 + p, beats: 8 })),
      }))
      const result = synth._scheduleAll(ctx, ctx.destination, seqs, 0.08, 0.6, '__huge', 0)
      // Every note that fits is heard, just plainer, and the budget holds.
      expect(result.trimmed).toBeGreaterThan(0)
      expect(result.nodes).toBeLessThanOrEqual(MAX_NODES_PER_PLAYBACK)
      expect(result.skipped).toBeLessThan(seqs.length * 2)
    } finally {
      delete VOICE_PRESETS.__huge
    }
  })

  it('plays a long piece at full detail instead of gradually thinning out', () => {
    // The budget covers what sounds at once. If it counted every node a song
    // ever built, a long hymn would get quieter and plainer as it went on.
    const ctx = createFakeContext()
    const synth = new Synth()
    const seqs = [
      { notes: Array.from({ length: 200 }, () => ({ midi: 60, beats: 1 })) },
    ]
    const result = synth._scheduleAll(ctx, ctx.destination, seqs, 0.08, 0.6, 'hymn', 0)
    expect(result.skipped).toBe(0)
    expect(result.trimmed).toBe(0)
  })

  it('keeps singing when one note cannot be scheduled', () => {
    const ctx = createFakeContext()
    const synth = new Synth()
    // Fail one gain node part-way through the second note.
    const realCreateGain = ctx.createGain.bind(ctx)
    let calls = 0
    ctx.createGain = () => {
      if (calls++ === 7) throw new Error('context ran out of resources')
      return realCreateGain()
    }
    const seqs = [
      { notes: [{ midi: 60, beats: 1 }, { midi: 62, beats: 1 }, { midi: 64, beats: 1 }] },
    ]
    // One note the context refuses must not take the rest of the song with it.
    const result = synth._scheduleAll(ctx, ctx.destination, seqs, 0.08, 0.5, 'piano', 0)
    expect(result.skipped).toBe(1)
    expect(nodesOfKind(ctx.log, 'oscillator').filter((n) => n.started).length).toBeGreaterThan(0)
  })

  it('never schedules automation out of order on any instrument', () => {
    // A real AudioParam rejects events inserted before earlier ones, which
    // throws in the browser and takes the rest of the song down. Note lengths
    // shorter than the instrument's own attack and decay are the trap.
    for (const id of IDS) {
      for (const dur of [0.05, 0.1, 0.24, 0.3, 1, 4, 16]) {
        expect(() => schedule(id, { t0: 0, dur, sustain: 3 }), `${id} dur=${dur}`).not.toThrow()
      }
    }
  })

  it('reports the end of a song once', () => {
    vi.useFakeTimers()
    fake = installFakeAudio()
    const synth = new Synth()
    let done = 0
    synth.play([{ notes: [{ midi: 60, beats: 4 }] }], {
      tempo: 120,
      onDone: () => done++,
    })
    vi.advanceTimersByTime(3000)
    expect(done).toBe(1)
    vi.useRealTimers()
  })

  it('never reports the end after the song is stopped', () => {
    // Repeat restarts the song from this callback, so it must not fire once
    // the player has been stopped or the sheet changed underneath it.
    vi.useFakeTimers()
    fake = installFakeAudio()
    const synth = new Synth()
    let done = 0
    const handle = synth.play([{ notes: [{ midi: 60, beats: 4 }] }], {
      tempo: 120,
      onDone: () => done++,
    })
    handle.stop()
    vi.advanceTimersByTime(5000)
    expect(done).toBe(0)
    vi.useRealTimers()
  })

  it('plays, taps and renders with a chosen instrument', async () => {
    fake = installFakeAudio()
    const synth = new Synth()
    const seqs = [
      {
        name: 'Bass',
        notes: [
          { midi: 48, beats: 1 },
          { midi: null, beats: 1 },
          { midi: 55, beats: 2 },
        ],
      },
    ]

    const handle = synth.play(seqs, { tempo: 120, voice: 'organ' })
    expect(fake.live.log.length).toBeGreaterThan(0)
    handle.stop()

    synth.playTap(72, { tempo: 90, voice: 'bell' })

    const buffer = await synth.render(seqs, { tempo: 120, voice: 'musicbox', tail: 2 })
    expect(buffer.sampleRate).toBe(44100)
    expect(nodesOfKind(fake.offline.log, 'oscillator').length).toBeGreaterThan(0)
  })

  it('defaults to the piano when no instrument is given', () => {
    fake = installFakeAudio()
    const synth = new Synth()
    synth.playTap(60)
    expect(nodesOfKind(fake.live.log, 'oscillator').length).toBe(4)
  })
})

describe('lookahead scheduling', () => {
  let fake = null

  afterEach(() => {
    if (fake) fake.restore()
    fake = null
    vi.useRealTimers()
  })

  const fourPartSheet = (notesPerPart = 56) =>
    ['Soprano', 'Alto', 'Tenor', 'Bass'].map((name, p) => ({
      name,
      notes: Array.from({ length: notesPerPart }, (_, i) => ({
        midi: 60 + ((i + p) % 12),
        beats: 2,
      })),
    }))

  it('builds a long four-part sheet a slice at a time', () => {
    vi.useFakeTimers()
    fake = installFakeAudio()
    const synth = new Synth()

    synth.play(fourPartSheet(), { tempo: 90, voice: 'hymn', sustain: 1.5 })

    // Scheduling the whole sheet up front used to hand the browser every node
    // in one pass — about ten thousand for this score — before a sound played.
    const firstSlice = nodeCount(fake.live.log)
    expect(firstSlice).toBeGreaterThan(0)
    expect(firstSlice).toBeLessThan(250)

    // And every note must still arrive, over the length of the song.
    vi.advanceTimersByTime(120000)
    expect(synth.lastBudget.scheduled).toBe(56 * 4)
    expect(synth.lastBudget.skipped).toBe(0)
    expect(synth.lastBudget.trimmed).toBe(0)
    expect(synth.lastError).toBe(null)
  })

  it('schedules every note exactly once across slice boundaries', () => {
    const ctx = createFakeContext()
    const synth = new Synth()
    const seqs = [{ notes: Array.from({ length: 20 }, (_, i) => ({ midi: 60 + i, beats: 2 })) }]
    const budget = newPlaybackBudget()
    const t0 = 0
    const beat = 0.5
    // Awkward boundaries, including one that falls between two notes.
    const bounds = [0, 1.5, 3, 7.5, 20]

    let inWindows = 0
    for (let i = 0; i < bounds.length - 1; i++) {
      const slice = synth._scheduleAll(ctx, ctx.createGain(), seqs, t0, beat, 'hymn', 0, {
        from: bounds[i],
        to: bounds[i + 1],
        budget,
      })
      inWindows += slice.notes
    }

    expect(inWindows).toBe(20)
    expect(budget.scheduled).toBe(20)
    expect(budget.skipped).toBe(0)
  })

  it('stops scheduling once the playback is stopped', () => {
    vi.useFakeTimers()
    fake = installFakeAudio()
    const synth = new Synth()
    const seqs = [{ notes: Array.from({ length: 56 }, () => ({ midi: 60, beats: 2 })) }]

    const handle = synth.play(seqs, { tempo: 90, voice: 'hymn' })
    const afterFirstSlice = nodeCount(fake.live.log)
    handle.stop()

    vi.advanceTimersByTime(120000)
    expect(nodeCount(fake.live.log)).toBe(afterFirstSlice)
    expect(synth.lastBudget.scheduled).toBeLessThan(56)
  })
})

describe('periodic wave folding', () => {
  it('carries over exactly the harmonic amplitudes it replaces', () => {
    const voice = VOICE_PRESETS.organ
    const banks = voiceBanks(voice)
    const wave = banks.find((b) => b.kind === 'wave')
    expect(wave).toBeDefined()
    expect(banks).toHaveLength(1)

    const sources = voiceSources(voice)
    for (const s of sources) {
      expect(wave.imag[s.mult], `harmonic ${s.mult}`).toBeCloseTo(s.gain, 10)
      expect(wave.real[s.mult], `harmonic ${s.mult} phase`).toBe(0)
    }
    expect(wave.imag.length - 1).toBe(Math.max(...sources.map((s) => s.mult)))
    // disableNormalization: true, so the browser does not rescale the sum.
    expect(wave.real).toHaveLength(wave.imag.length)
  })

  it('leaves every preset without the wave flag untouched', () => {
    for (const id of ['piano', 'bell', 'marimba', 'musicbox', 'guitar', 'flute', 'voice', 'synth', 'strings', 'epiano']) {
      const banks = voiceBanks(VOICE_PRESETS[id])
      expect(banks.every((b) => b.kind === 'osc'), id).toBe(true)
      // Same node cost as if the folding code did not exist.
      expect(noteCost({ ...VOICE_PRESETS[id], wave: false }), id).toBe(noteCost(VOICE_PRESETS[id]))
    }
  })

  it('keeps a non-integer rank as its own oscillator', () => {
    // The organ's 0.5 pedal rank is not a whole multiple of the frequency, so
    // no PeriodicWave can express it.
    const banks = voiceBanks(VOICE_PRESETS.churchOrgan)
    const wave = banks.filter((b) => b.kind === 'wave')
    const pedal = banks.filter((b) => b.kind === 'osc' && b.mult === 0.5)
    expect(wave).toHaveLength(1)
    expect(pedal).toHaveLength(1)
    expect(wave[0].imag.length).toBe(9)
  })
})
