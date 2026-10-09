/**
 * Instrument presets.
 *
 * Every preset is plain data so it can be validated by tests and rendered by
 * the synth without any Web Audio present. A preset is built from:
 *
 *   peak          amplitude of the note, 0..1. Several voices sound at once,
 *                 so this stays well under 1 and the compressor catches the rest
 *   attack        seconds from silence up to peak
 *   sustain       level held for the rest of the note, as a fraction of peak
 *   decayPortion  fraction of the note spent falling from peak to sustain
 *   release       seconds of ring-out after the note ends
 *
 * plus any combination of the optional layers below. Partials are mixed
 * inharmonic-free multiples of the fundamental, `osc` adds one rich waveform,
 * `fm` wobbles the fundamental, `formants` shape a vowel, `direct` is the share
 * of tone that bypasses those formants, `noise` adds breath or a pick
 * transient, `vibrato` adds a slow wobble, and `filter` sets how bright the note
 * starts and how quickly it darkens.
 *
 * Peaks are all kept within a narrow band of the piano's so no instrument is
 * noticeably quieter than another; the master compressor catches the peaks when
 * several voices sound together.
 */

export const DEFAULT_VOICE_ID = 'piano'

/**
 * Extra ring-out added to every note on top of the instrument's own release,
 * so a long chord keeps sounding like it would in a room.
 */
export const SUSTAIN_OPTIONS = [
  { id: 'off', label: 'Off', seconds: 0 },
  { id: 'short', label: 'Short', seconds: 0.5 },
  { id: 'medium', label: 'Medium', seconds: 1.5 },
  { id: 'long', label: 'Long', seconds: 3 },
]

export const DEFAULT_SUSTAIN_ID = 'medium'

export function sustainSeconds(id) {
  const found = SUSTAIN_OPTIONS.find((o) => o.id === id)
  return found ? found.seconds : SUSTAIN_OPTIONS.find((o) => o.id === DEFAULT_SUSTAIN_ID).seconds
}

export const VOICE_PRESETS = {
  piano: {
    label: 'Piano',
    peak: 0.36,
    attack: 0.008,
    sustain: 0.32,
    decayPortion: 0.85,
    release: 1.1,
    partials: [
      { mult: 1, gain: 1 },
      { mult: 2, gain: 0.42 },
      { mult: 3.004, gain: 0.16 },
      { mult: 4.009, gain: 0.07 },
    ],
    filter: { type: 'lowpass', q: 0.8, open: 9, close: 1.8, floor: 900, cap: 13000, sweep: 0.5 },
  },
  organ: {
    label: 'Organ',
    wave: true,
    peak: 0.34,
    attack: 0.02,
    sustain: 1,
    decayPortion: 0,
    release: 0.3,
    partials: [
      { mult: 1, gain: 1 },
      { mult: 2, gain: 0.7 },
      { mult: 3, gain: 0.45 },
      { mult: 4, gain: 0.5 },
      { mult: 6, gain: 0.22 },
      { mult: 8, gain: 0.16 },
    ],
    chorus: { cents: 7, gain: 0.45 },
    filter: { type: 'lowpass', q: 0.7, open: 12, close: 9, floor: 1400, cap: 14000, sweep: 0.3 },
  },
  // The registration behind a hymn: a 16' pedal under an 8' principal, with the
  // 4', 2 2/3' and 2' ranks stacked above it, the slow swell and gentle shake
  // that keeps a long chord alive, and a touch of reed chiff on the attack.
  churchOrgan: {
    label: 'Church Organ',
    wave: true,
    peak: 0.34,
    attack: 0.12,
    sustain: 1,
    decayPortion: 0,
    release: 0.5,
    partials: [
      { mult: 0.5, gain: 0.5 },
      { mult: 1, gain: 1 },
      { mult: 2, gain: 0.62 },
      { mult: 3, gain: 0.3 },
      { mult: 4, gain: 0.34 },
      { mult: 6, gain: 0.16 },
      { mult: 8, gain: 0.1 },
    ],
    chorus: { cents: 6, gain: 0.4 },
    vibrato: { rate: 5, depth: 6, onset: 0.4 },
    noise: { gain: 0.03, decay: 0.06 },
    filter: { type: 'lowpass', q: 0.7, open: 14, close: 10, floor: 1200, cap: 15000, sweep: 0.3 },
  },
  // For playing a hymn line: the same ranks as the church organ but weighted
  // lower and warmer, with a slow swell and a long ring so a chord blooms
  // through the note and fades the way a pedal and mixture actually do.
  hymn: {
    label: 'Hymn Organ',
    wave: true,
    peak: 0.36,
    attack: 0.16,
    sustain: 1,
    decayPortion: 0,
    release: 2.4,
    partials: [
      { mult: 0.5, gain: 0.45 },
      { mult: 1, gain: 1 },
      { mult: 2, gain: 0.7 },
      { mult: 3, gain: 0.34 },
      { mult: 4, gain: 0.4 },
      { mult: 6, gain: 0.22 },
      { mult: 8, gain: 0.14 },
    ],
    chorus: { cents: 5, gain: 0.45 },
    vibrato: { rate: 4.6, depth: 7, onset: 0.5 },
    noise: { gain: 0.025, decay: 0.08 },
    filter: { type: 'lowpass', q: 0.7, open: 15, close: 11, floor: 1100, cap: 15000, sweep: 0.3 },
  },
  epiano: {
    label: 'Electric Piano',
    peak: 0.36,
    attack: 0.006,
    sustain: 0.28,
    decayPortion: 0.7,
    release: 0.7,
    partials: [
      { mult: 1, gain: 1 },
      { mult: 2, gain: 0.2 },
    ],
    fm: { ratio: 14, index: 220, decay: 0.28 },
    noise: { gain: 0.05, decay: 0.02 },
    filter: { type: 'lowpass', q: 0.9, open: 7, close: 2.2, floor: 800, cap: 11000, sweep: 0.45 },
  },
  guitar: {
    label: 'Guitar',
    peak: 0.36,
    attack: 0.004,
    sustain: 0.22,
    decayPortion: 0.85,
    release: 0.5,
    partials: [
      { mult: 1, gain: 1 },
      { mult: 2, gain: 0.45 },
      { mult: 3, gain: 0.22 },
      { mult: 4, gain: 0.12 },
      { mult: 5, gain: 0.07 },
    ],
    noise: { gain: 0.08, decay: 0.025 },
    filter: { type: 'lowpass', q: 1, open: 6, close: 2.4, floor: 700, cap: 11000, sweep: 0.4 },
  },
  musicbox: {
    label: 'Music Box',
    peak: 0.34,
    attack: 0.004,
    sustain: 0.3,
    decayPortion: 0.55,
    release: 1.6,
    partials: [
      { mult: 1, gain: 1 },
      { mult: 4.02, gain: 0.32 },
      { mult: 9.1, gain: 0.12 },
    ],
    filter: { type: 'lowpass', q: 0.6, open: 10, close: 4, floor: 1500, cap: 15000, sweep: 0.4 },
  },
  marimba: {
    label: 'Marimba',
    peak: 0.38,
    attack: 0.004,
    sustain: 0.12,
    decayPortion: 0.6,
    release: 0.35,
    partials: [
      { mult: 1, gain: 1 },
      { mult: 3.9, gain: 0.28 },
      { mult: 9.2, gain: 0.07 },
    ],
    noise: { gain: 0.06, decay: 0.03 },
    filter: { type: 'lowpass', q: 0.7, open: 8, close: 3, floor: 700, cap: 12000, sweep: 0.3 },
  },
  bell: {
    label: 'Bell',
    peak: 0.3,
    attack: 0.003,
    sustain: 0.35,
    decayPortion: 0.15,
    release: 3.2,
    partials: [
      { mult: 1, gain: 1 },
      { mult: 2.76, gain: 0.5 },
      { mult: 5.4, gain: 0.28 },
      { mult: 8.9, gain: 0.14 },
    ],
    filter: { type: 'lowpass', q: 0.5, open: 12, close: 5, floor: 2000, cap: 16000, sweep: 0.5 },
  },
  strings: {
    label: 'Strings',
    peak: 0.34,
    attack: 0.24,
    sustain: 0.92,
    decayPortion: 0,
    release: 0.7,
    osc: { type: 'sawtooth', gain: 1 },
    chorus: { cents: 7, gain: 0.5 },
    vibrato: { rate: 5, depth: 12, onset: 0.25 },
    filter: { type: 'lowpass', q: 1.1, open: 6, close: 3, floor: 700, cap: 9000, sweep: 0.35 },
  },
  flute: {
    label: 'Flute',
    peak: 0.34,
    attack: 0.07,
    sustain: 1,
    decayPortion: 0,
    release: 0.2,
    partials: [
      { mult: 1, gain: 1 },
      { mult: 2, gain: 0.08 },
    ],
    noise: { gain: 0.04, decay: 0.1, sustain: 0.5 },
    vibrato: { rate: 5.5, depth: 14, onset: 0.2 },
    filter: { type: 'lowpass', q: 0.6, open: 8, close: 6, floor: 1200, cap: 14000, sweep: 0.4 },
  },
  voice: {
    label: 'Voice (ah)',
    peak: 0.42,
    attack: 0.08,
    sustain: 1,
    decayPortion: 0,
    release: 0.3,
    osc: { type: 'sawtooth', gain: 1 },
    formants: [
      { freq: 730, q: 7, gain: 1 },
      { freq: 1090, q: 9, gain: 0.6 },
      { freq: 2440, q: 11, gain: 0.25 },
    ],
    direct: 0.35,
    vibrato: { rate: 5.2, depth: 18, onset: 0.3 },
    filter: { type: 'lowpass', q: 0.7, open: 10, close: 7, floor: 1500, cap: 15000, sweep: 0.4 },
  },
  synth: {
    label: 'Synth',
    peak: 0.3,
    attack: 0.01,
    sustain: 1,
    decayPortion: 0,
    release: 0.2,
    osc: { type: 'sawtooth', gain: 1 },
    chorus: { cents: 12, gain: 0.6 },
    filter: { type: 'lowpass', q: 6, open: 4, close: 2, floor: 500, cap: 12000, sweep: 0.3 },
  },
}

export const VOICE_LIST = Object.entries(VOICE_PRESETS).map(([id, preset]) => ({
  id,
  label: preset.label,
}))

export function normalizeVoiceId(id) {
  if (Object.prototype.hasOwnProperty.call(VOICE_PRESETS, id)) return id
  return DEFAULT_VOICE_ID
}

export function getVoice(id) {
  return VOICE_PRESETS[normalizeVoiceId(id)]
}

/** Partials scaled so their gains sum to 1, leaving `peak` as the real amplitude. */
export function normalisedPartials(voice) {
  const list = voice.partials || []
  const sum = list.reduce((total, p) => total + p.gain, 0)
  if (!sum) return []
  return list.map((p) => ({ mult: p.mult, gain: p.gain / sum }))
}

/**
 * Every oscillator a preset needs: the rich waveform first, then the partials.
 * Gains are normalised across the lot so mixed presets stay balanced.
 */
export function voiceSources(voice) {
  const specs = []
  if (voice.osc) specs.push({ type: voice.osc.type || 'sine', mult: 1, gain: voice.osc.gain ?? 1 })
  for (const p of normalisedPartials(voice)) specs.push({ type: 'sine', mult: p.mult, gain: p.gain })
  if (!specs.length) specs.push({ type: 'sine', mult: 1, gain: 1 })
  const sum = specs.reduce((total, s) => total + s.gain, 0) || 1
  return specs.map((s) => ({ ...s, gain: s.gain / sum }))
}

/**
 * Oscillators grouped into as few nodes as the preset allows.
 *
 * An additive instrument builds one oscillator per harmonic, so four parts of
 * organ ask the browser for dozens of them a note. A preset flagged `wave`
 * folds its whole-number harmonics into a single PeriodicWave — the identical
 * Fourier sum, on one node. Harmonics that do not divide the frequency (the
 * organ's 0.5 pedal rank, a bell's 2.76) cannot be expressed that way and stay
 * as their own oscillators.
 *
 * `{ kind: 'wave' }` banks carry `real`/`imag` coefficients ready for
 * `createPeriodicWave(..., { disableNormalization: true })`, so the amplitude
 * is exactly the sum it replaces.
 */
export function voiceBanks(voice) {
  const specs = voiceSources(voice)
  const asOsc = () => specs.map((s) => ({ kind: 'osc', ...s }))
  if (!voice.wave) return asOsc()

  const integers = specs.filter((s) => Number.isInteger(s.mult) && s.mult >= 1)
  const others = specs.filter((s) => !(Number.isInteger(s.mult) && s.mult >= 1))
  if (integers.length < 2) return asOsc()

  const harmonics = Math.max(...integers.map((s) => s.mult))
  const real = new Array(harmonics + 1).fill(0)
  const imag = new Array(harmonics + 1).fill(0)
  for (const s of integers) imag[s.mult] = s.gain

  return [
    ...others.map((s) => ({ kind: 'osc', ...s })),
    {
      kind: 'wave',
      mult: 1,
      gain: 1,
      real,
      imag,
      fundamental: integers.some((s) => s.mult === 1),
    },
  ]
}

/** Formant bands scaled to sum to 1, since bandpass filters lose a lot of level. */
export function voiceFormants(voice) {
  const list = voice.formants || []
  const sum = list.reduce((total, f) => total + f.gain, 0)
  if (!sum) return []
  return list.map((f) => ({ freq: f.freq, q: f.q, gain: (f.gain / sum) * 3 }))
}
