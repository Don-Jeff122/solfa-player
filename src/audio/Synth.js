import { midiToFreq, sequenceBeats } from '../lib/notes.js'
import { getVoice, voiceBanks, voiceFormants } from './voices.js'

// Exponential ramps cannot reach zero, so every envelope bottoms out here.
const MIN_GAIN = 0.0001
const NOISE_SECONDS = 2.5
const extraStop = 0.12
const LATE_NOTE_LEAD = 0.02
// A busy phone can delay the scheduling timer by a second or more. Notes only
// a little behind still belong in the music, so keep them and play them at
// their attack; only a genuinely stale note — one the player would hear as a
// late echo — is dropped.
const LATE_NOTE_DROP = 1.5
// The first slice is longer than the steady-state window: Play also paints the
// page and starts the audio context, and the opening notes must not be lost to
// that work.
const FIRST_WINDOW = 3
const ADVANCE_TICK_MS = 500

/**
 * The master transfer: unity gain up to a full-scale knee, soft limit above.
 *
 * A note peaks around a third of full scale, so four parts of chords sum past
 * 1.0. Any curve that bends before that — a compressor, or a `tanh` that starts
 * squashing at a third — distorts every loud moment and is heard as a crackle
 * over the music. So this curve is exactly linear up to LIMIT_KNEE and only
 * bends the rare samples above it, which keeps ordinary playing untouched
 * while still stopping the destination from ever seeing more than full scale.
 *
 * The bus divides the sum by MASTER_SCALE and the curve multiplies it back, so
 * the two cancel and `MASTER_GAIN` is the only overall attenuation.
 */
const MASTER_SCALE = 16
const MASTER_GAIN = 0.7
const LIMIT_KNEE = 1

/** The master transfer curve over u in [-1, 1]; input is `u * MASTER_SCALE`. */
export function softClipCurve(size = 2048) {
  const curve = new Float32Array(size)
  const ceiling = 1 - MASTER_GAIN * LIMIT_KNEE
  for (let i = 0; i < size; i++) {
    const u = -1 + (2 * i) / (size - 1)
    const x = Math.abs(u * MASTER_SCALE)
    const bend = (MASTER_GAIN * (x - LIMIT_KNEE)) / ceiling
    const y =
      x <= LIMIT_KNEE ? MASTER_GAIN * x : MASTER_GAIN * LIMIT_KNEE + ceiling * Math.tanh(bend)
    curve[i] = Math.sign(u) * y
  }
  return curve
}

export function deviceProfile() {
  if (typeof navigator === 'undefined') {
    return { maxNodes: MAX_NODES_PER_PLAYBACK, maxNotes: MAX_SIMULTANEOUS_NOTES, lookahead: LOOKAHEAD_SECONDS, latencyHint: 'interactive', lowPower: false }
  }
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  const cores = navigator.hardwareConcurrency || 8
  const lowPower = coarse && cores <= 6
  if (lowPower) {
    return { maxNodes: 420, maxNotes: 36, lookahead: 2, latencyHint: 'playback', lowPower: true }
  }
  return { maxNodes: MAX_NODES_PER_PLAYBACK, maxNotes: 48, lookahead: LOOKAHEAD_SECONDS, latencyHint: 'interactive', lowPower: false }
}


/**
 * How many audio nodes one song is allowed to build.
 *
 * Combining all four parts of a hymn can ask for a dozen notes at once, and
 * each note is its own small graph of oscillators, gains and filters. The organ
 * family is the worst case: roughly 35 nodes a note, so four parts of chords
 * runs past 400 nodes on its own. Past a few hundred the browser's audio thread
 * starts to glitch and can fall silent, which is why only the cheapest
 * instrument ever seemed to work. When the budget runs out a note is played in
 * a stripped-back form instead of being dropped, so nothing goes missing.
 */
export const MAX_NODES_PER_PLAYBACK = 900

/**
 * Hard cap on notes sounding at once.
 *
 * Notes are never dropped for being expensive: past the node budget they are
 * played in a plainer form instead. This cap is the backstop for input no real
 * score produces (a four-part hymn peaks at a dozen), and it is what guarantees
 * the plainest note always fits inside the budget.
 */
export const MAX_SIMULTANEOUS_NOTES = 40

/**
 * How far ahead playback schedules audio.
 *
 * Notes must exist before their start time, but not months before: a sheet of
 * four parts and fifty-six notes each asks for about ten thousand nodes if
 * they are all built at once. Three seconds of lookahead covers a tempo change
 * and typical timer throttling while holding only a handful of notes live.
 */
export const LOOKAHEAD_SECONDS = 3

/** Never schedule more narrowly than this, or a fast tempo starves the timer. */
export const LOOKAHEAD_MIN = 0.5

/**
 * How slurred notes are joined. A slur (`_`) means two notes are sung to one
 * syllable, so the first is held this many seconds into the second (the joint
 * never goes silent) and the second swells in rather than re-striking.
 */
export const LEGATO_OVERLAP = 0.06
export const LEGATO_ATTACK_SCALE = 0.4

/**
 * Which notes of a sequence flow into the next without a fresh attack.
 *
 * A note's `slur` is its group id, so two neighbours with the same id are
 * joined: the earlier one is `legatoOut` (held through the joint) and the later
 * one is `legatoIn` (softened attack).
 */
export function slurFlags(notes) {
  const list = notes || []
  return list.map((note, i) => {
    const prev = list[i - 1]
    const next = list[i + 1]
    const id = note.slur
    return {
      legatoIn: id != null && !!prev && prev.slur === id,
      legatoOut: id != null && !!next && next.slur === id,
    }
  })
}

/** The attack time a note gets: slurred continuations swell in more gently. */
export function legatoAttack(voice, legatoIn) {
  return Math.max(voice.attack * (legatoIn ? LEGATO_ATTACK_SCALE : 1), 0.001)
}

function clampHz(value, floor, cap) {
  return Math.min(Math.max(value, floor), cap)
}

/** Audio nodes `_scheduleNote` will build for one note of this instrument. */
export function noteCost(voice) {
  const banks = voiceBanks(voice)
  // The chorus copy is only made for the fundamental now.
  const doubled =
    voice.chorus && banks.some((b) => (b.kind === 'wave' ? b.fundamental : b.mult === 1))
  const perSource = banks.length * 2 + (doubled ? 2 : 0)
  const formants = voiceFormants(voice).length
  return (
    perSource +
    1 + // tone bus
    1 + // amplitude envelope
    (voice.filter ? 1 : 0) +
    // one filter and one gain per formant band, plus the node that sums them
    (formants ? formants * 2 + 1 : 0) +
    (voice.direct > 0 ? 1 : 0) +
    (voice.vibrato ? 2 : 0) +
    (voice.fm ? 2 : 0) +
    (voice.noise ? 2 : 0)
  )
}

/**
 * The same instrument with its optional decoration removed: one plain partial
 * stack, no chorus shimmer, no breath, no vibrato. Still recognisably the
 * instrument, but a fraction of the nodes.
 */
function strippedBack(voice) {
  const partials = (voice.partials || []).slice(0, 3)
  return {
    ...voice,
    partials: partials.length ? partials : [{ mult: 1, gain: 1 }],
    chorus: undefined,
    noise: undefined,
    vibrato: undefined,
    fm: undefined,
    formants: undefined,
    direct: 0,
  }
}

/** The cheapest thing that is still the right pitch and the right envelope. */
function bare(voice) {
  return {
    ...strippedBack(voice),
    partials: [{ mult: 1, gain: 1 }, { mult: 2, gain: 0.4 }],
    osc: undefined,
    filter: undefined,
  }
}

/**
 * The running state of one playback's scheduling.
 *
 * Nodes are *created* when a note is scheduled but only *cost* something while
 * it rings, so the budget has to survive across lookahead slices: a note
 * scheduled in the first three seconds is still sounding when the fourth slice
 * begins. `built` counts what has actually been handed to the browser so far,
 * which is the quantity that used to blow up on long sheets.
 */
export function newPlaybackBudget() {
  return {
    live: [],
    liveNotes: 0,
    liveNodes: 0,
    built: 0,
    scheduled: 0,
    skipped: 0,
    trimmed: 0,
    droppedLate: 0,
    error: null,
  }
}

export class Synth {
  constructor() {
    this.ctx = null
    this._noiseCtx = null
    this._noiseBuffer = null
    this._waveCtx = null
    this._waveCache = null
    this._out = null
    this._outCtx = null
    /** First scheduling failure of the current playback, or null. */
    this.lastError = null
    /** Node budget of the current playback, for diagnostics and tests. */
    this.lastBudget = null
  }

  _ensureCtx() {
    // Safari moves a context to 'interrupted' after screen lock or long idle,
    // and may 'close' it outright. A cached context in either state is dead:
    // play and tap would schedule into silence until a page reload. Drop it
    // (and everything bound to it) so the next call builds a fresh one.
    if (this.ctx && (this.ctx.state === 'closed' || this.ctx.state === 'interrupted')) {
      this.ctx = null
      this._out = null
      this._outCtx = null
      this._noiseCtx = null
      this._noiseBuffer = null
      this._waveCtx = null
      this._waveCache = null
      this.lastError = null
      this.lastBudget = null
    }
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext
      const prof = deviceProfile()
      try {
        this.ctx = new Ctor({ latencyHint: prof.latencyHint })
      } catch {
        this.ctx = new Ctor()
      }
    }
    if (this.ctx.state === 'suspended' || this.ctx.state === 'interrupted') this.ctx.resume()
    return this.ctx
  }

  /** One shared noise buffer per context; regenerating per note would click. */
  _noise(ctx) {
    if (this._noiseCtx === ctx && this._noiseBuffer) return this._noiseBuffer
    const length = Math.max(1, Math.floor(ctx.sampleRate * NOISE_SECONDS))
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
    this._noiseCtx = ctx
    this._noiseBuffer = buffer
    return buffer
  }

  /**
   * A cached PeriodicWave for a bank of harmonics.
   *
   * Waves are keyed by their coefficients and stored per context, so every note
   * of a song shares one WaveTable instead of handing the browser a fresh
   * Fourier transform each time.
   */
  _wave(ctx, spec) {
    if (this._waveCtx !== ctx) {
      this._waveCtx = ctx
      this._waveCache = new Map()
    }
    const key = spec.imag.join(',')
    let wave = this._waveCache.get(key)
    if (!wave) {
      wave = ctx.createPeriodicWave(spec.real, spec.imag, { disableNormalization: true })
      this._waveCache.set(key, wave)
    }
    return wave
  }

  _masterChain(ctx, destination, oversample = '4x') {
    const bus = ctx.createGain()
    // The sum is divided by the same figure the curve is scaled by, so the two
    // cancel: playing below the knee passes through as a plain gain, and only
    // the peaks of a very full chord are bent toward the ceiling.
    bus.gain.value = 1 / MASTER_SCALE
    const shaper = ctx.createWaveShaper()
    shaper.curve = softClipCurve()
    // Oversampling keeps the harmonics the curve adds from folding back down.
    shaper.oversample = oversample
    bus.connect(shaper)
    shaper.connect(destination)
    // Both nodes have to come out of the graph, not just the bus: a node left
    // connected to the destination still costs the audio thread on every render
    // quantum, and a pile of them is what eventually distorts.
    const dispose = () => {
      try {
        bus.disconnect()
      } catch {
        /* already disconnected */
      }
      try {
        shaper.disconnect()
      } catch {
        /* already disconnected */
      }
    }
    return { input: bus, dispose }
  }

  /**
   * One master chain that lives for the life of the context.
   *
   * Played songs build their own chain and disconnect it when they stop, but a
   * key tap must never leave a silence behind: tapping a hymn line can build a
   * fresh master chain per note in a few seconds, and a real browser's audio
   * thread starts to fall silent when it juggles a growing pile of them. Every
   * tap instead feeds the same chain the next tap uses.
   */
  _output(ctx) {
    const dead = ctx && (ctx.state === 'closed' || ctx.state === 'interrupted')
    if (!this._out || this._outCtx !== ctx || dead) {
      this._outCtx = ctx
      const profile = deviceProfile()
      this._out = this._masterChain(ctx, ctx.destination, profile.lowPower ? '2x' : '4x').input
    }
    return this._out
  }

  /**
   * A short metronome tick for a bar's downbeat. Two small nodes that decay in
   * a few milliseconds, so it never competes with the note budget.
   */
  _click(ctx, destination, time) {
    const osc = ctx.createOscillator()
    osc.type = 'square'
    osc.frequency.setValueAtTime(1900, time)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.16, time)
    g.gain.exponentialRampToValueAtTime(MIN_GAIN, time + 0.045)
    osc.connect(g)
    g.connect(destination)
    osc.onended = () => {
      try {
        g.disconnect()
      } catch {
        /* already disconnected */
      }
    }
    osc.start(time)
    osc.stop(time + 0.08)
  }

  _scheduleNote(
    ctx,
    destination,
    midi,
    t0,
    durSec,
    velocity = 0.95,
    voiceId,
    ring = 0,
    resolved,
    legatoIn = false,
  ) {
    const voice = resolved || getVoice(voiceId)
    const f = midiToFreq(midi)
    // A slurred continuation swells in from the note before it instead of
    // striking cleanly, so the two read as one sung syllable.
    const attack = legatoAttack(voice, legatoIn)
    // Automation events must be inserted in time order, and a note can be
    // shorter than the instrument's own attack or decay. Put the hold after
    // whatever the attack and decay already scheduled, or a browser throws and
    // the rest of the song is lost.
    const decayEnd =
      voice.sustain < 0.999 ? t0 + attack + Math.max(durSec * voice.decayPortion, 0.02) : t0
    // The note holds its level until it is over, then rings out for the
    // instrument's own release plus whatever ring-out the player asked for.
    const holdAt = Math.max(t0 + attack, t0 + durSec, decayEnd)
    const releaseAt = Math.max(holdAt + 0.02, t0 + durSec + voice.release + ring)
    const stopAt = releaseAt + extraStop

    // Sources, chorus copies and the modulator all feed one tone bus, which the
    // filter and any formants then colour before the amplitude envelope.
    const tone = ctx.createGain()
    tone.gain.value = 1
    const banks = voiceBanks(voice)
    const fundamentals = []
    const sources = []

    banks.forEach((spec) => {
      const isWave = spec.kind === 'wave'
      const isFundamental = isWave ? spec.fundamental : spec.mult === 1
      const build = (detune, gainScale) => {
        const osc = ctx.createOscillator()
        if (isWave) {
          // One PeriodicWave stands in for every whole-number harmonic, which
          // is the same sum the browser used to build out of a dozen
          // oscillators. disableNormalization keeps each harmonic's amplitude
          // exactly what it was, so the note sounds unchanged.
          osc.setPeriodicWave(this._wave(ctx, spec))
          osc.frequency.setValueAtTime(f, t0)
        } else {
          osc.type = spec.type
          osc.frequency.setValueAtTime(f * spec.mult, t0)
        }
        if (detune) osc.detune.setValueAtTime(detune, t0)
        const g = ctx.createGain()
        g.gain.value = (isWave ? 1 : spec.gain) * gainScale
        osc.connect(g)
        g.connect(tone)
        sources.push(osc)
        osc.start(t0)
        osc.stop(stopAt)
        if (isFundamental) fundamentals.push(osc)
        return osc
      }
      build(0, 1)
      // Only the fundamental is doubled. Detuning every partial doubled the
      // oscillator count of the organ family for a shimmer you cannot hear,
      // and four parts of hymn asked the browser for over 1000 nodes.
      if (voice.chorus && isFundamental) build(voice.chorus.cents, voice.chorus.gain)
    })

    if (voice.fm && fundamentals.length) {
      const mod = ctx.createOscillator()
      mod.type = 'sine'
      mod.frequency.setValueAtTime(f * voice.fm.ratio, t0)
      const depth = ctx.createGain()
      depth.gain.setValueAtTime(voice.fm.index, t0)
      depth.gain.exponentialRampToValueAtTime(
        Math.max(voice.fm.index * 0.01, MIN_GAIN),
        t0 + voice.fm.decay
      )
      mod.connect(depth)
      for (const osc of fundamentals) depth.connect(osc.frequency)
      mod.start(t0)
      mod.stop(stopAt)
    }

    if (voice.vibrato && fundamentals.length) {
      const lfo = ctx.createOscillator()
      lfo.frequency.setValueAtTime(voice.vibrato.rate, t0)
      const cents = ctx.createGain()
      const onset = voice.vibrato.onset ?? 0.2
      cents.gain.setValueAtTime(0, t0)
      cents.gain.linearRampToValueAtTime(voice.vibrato.depth, t0 + Math.max(onset, 0.001))
      lfo.connect(cents)
      for (const osc of fundamentals) cents.connect(osc.detune)
      lfo.start(t0)
      lfo.stop(stopAt)
    }

    if (voice.noise) {
      const src = ctx.createBufferSource()
      src.buffer = this._noise(ctx)
      const n = ctx.createGain()
      const hold = Math.max(voice.noise.gain * (voice.noise.sustain ?? 0), MIN_GAIN)
      const noiseDecay = t0 + Math.max(voice.noise.decay, 0.01)
      n.gain.setValueAtTime(Math.max(voice.noise.gain, MIN_GAIN), t0)
      n.gain.exponentialRampToValueAtTime(hold, noiseDecay)
      n.gain.setValueAtTime(hold, Math.max(holdAt, noiseDecay))
      n.gain.exponentialRampToValueAtTime(MIN_GAIN, releaseAt)
      src.connect(n)
      n.connect(tone)
      src.start(t0)
      src.stop(stopAt)
    }

    let chain = tone

    if (voice.filter) {
      const filter = ctx.createBiquadFilter()
      filter.type = voice.filter.type || 'lowpass'
      filter.Q.value = voice.filter.q ?? 0.7
      const floor = voice.filter.floor ?? 20
      const cap = voice.filter.cap ?? 20000
      const open = clampHz(f * voice.filter.open, floor, cap)
      const close = clampHz(f * voice.filter.close, floor, cap)
      filter.frequency.setValueAtTime(open, t0)
      if (close !== open) {
        filter.frequency.exponentialRampToValueAtTime(close, t0 + (voice.filter.sweep ?? 0.5))
      }
      tone.connect(filter)
      chain = filter
    }

    const formants = voiceFormants(voice)
    if (formants.length) {
      const merged = ctx.createGain()
      merged.gain.value = 1
      for (const band of formants) {
        const bp = ctx.createBiquadFilter()
        bp.type = 'bandpass'
        bp.frequency.setValueAtTime(band.freq, t0)
        bp.Q.value = band.q
        const g = ctx.createGain()
        g.gain.value = band.gain
        chain.connect(bp)
        bp.connect(g)
        g.connect(merged)
      }
      // Narrow bands reject most of a sawtooth, so let a share of the tone
      // bypass the formants to keep the note audible.
      if (voice.direct > 0) {
        const dry = ctx.createGain()
        dry.gain.value = voice.direct
        chain.connect(dry)
        dry.connect(merged)
      }
      chain = merged
    }

    const env = ctx.createGain()
    const peak = voice.peak * velocity
    const sustainLevel = Math.max(peak * voice.sustain, MIN_GAIN)
    env.gain.setValueAtTime(MIN_GAIN, t0)
    env.gain.exponentialRampToValueAtTime(peak, t0 + attack)
    if (voice.sustain < 0.999) {
      env.gain.exponentialRampToValueAtTime(sustainLevel, decayEnd)
    }
    // Pin the level for the rest of the note. Without this the release ramp
    // decays all the way from the attack, so a sustained instrument fades away
    // instead of holding, and only a preset with a long decay sounds right.
    env.gain.setValueAtTime(voice.sustain < 0.999 ? sustainLevel : peak, holdAt)
    env.gain.exponentialRampToValueAtTime(MIN_GAIN, releaseAt)
    chain.connect(env)
    env.connect(destination)

    const watcher = sources[0]
    let released = false
    const release = () => {
      if (released) return
      released = true
      try {
        env.disconnect()
      } catch {
        /* already disconnected */
      }
      try {
        tone.disconnect()
      } catch {
        /* already disconnected */
      }
    }
    if (watcher) {
      watcher.onended = () => {
        // Some browsers can report the end before the scheduled stop. Cutting
        // the note there would truncate its release, so wait out the remainder
        // instead. A late disconnect only frees the graph a little later.
        const left = (stopAt - ctx.currentTime) * 1000
        if (left > 30) setTimeout(release, left)
        else release()
      }
    }
    return stopAt
  }

  /**
   * Schedules one slice of a song, keeping the audio thread within its budget.
   *
   * Only events starting inside `[from, to)` are built, so a long sheet reaches
   * the browser a few seconds at a time instead of all at once. Scheduling the
   * whole song up front meant four parts of a 56-note hymn handed the browser
   * about ten thousand nodes in a single pass, which silenced everything while
   * never tripping the concurrency ceiling at all.
   *
   * Notes are laid out in time order first so the running count of notes that
   * are still sounding is known before each one is built. Anything past the
   * budget is played stripped-back rather than left out, so combining all four
   * parts stays audible on every instrument instead of falling silent.
   *
   * The `budget` travels between slices: a note scheduled in the first window
   * is still ringing when the fourth begins, so it still holds its nodes.
   */
  _scheduleAll(ctx, destination, seqs, t0, beat, voiceId, ring = 0, opts = {}) {
    const { from = -Infinity, to = Infinity, realtime = false } = opts
    const now = realtime ? ctx.currentTime : -Infinity
    const budget = opts.budget || newPlaybackBudget()

    if (opts.metronome) {
      // The parts have been checked to share the same bars, so one tick per
      // unique downbeat is enough — four voices would otherwise tick as four.
      const ticks = new Set()
      for (const seq of seqs) {
        if (!seq.barStarts) continue
        for (const bs of seq.barStarts) {
          const at = t0 + bs * beat
          if (at >= from && at < to) ticks.add(Math.round(at * 1000))
        }
      }
      for (const at of [...ticks].sort((a, b) => a - b)) {
        try {
          this._click(ctx, destination, at / 1000)
        } catch (err) {
          if (!budget.error) budget.error = err
        }
      }
    }

    const events = []
    seqs.forEach((seq, seqIndex) => {
      const flags = slurFlags(seq.notes)
      let t = 0
      seq.notes.forEach((n, index) => {
        const start = t0 + t * beat
        if (start >= from && start < to) {
          const legatoOut = flags[index].legatoOut
          events.push({
            midi: n.midi,
            beats: n.beats,
            index,
            seqIndex,
            start,
            // A slurred note is held a little into the next one, so the joint
            // between them never goes silent.
            dur: Math.max(n.beats * beat, 0.1) + (legatoOut ? LEGATO_OVERLAP : 0),
            legatoIn: flags[index].legatoIn,
          })
        }
        t += n.beats
      })
    })
    events.sort((a, b) => a.start - b.start)

    const preset = getVoice(voiceId)
    // Three tiers of detail, tried in order, so a busy passage loses ornament
    // rather than losing notes.
    const tiers = [
      { voice: preset, cost: noteCost(preset) },
      { voice: strippedBack(preset), cost: noteCost(strippedBack(preset)) },
      { voice: bare(preset), cost: noteCost(bare(preset)) },
    ]
    const ceiling = opts.maxNodes ?? MAX_NODES_PER_PLAYBACK
    const maxNotes = opts.maxNotes ?? MAX_SIMULTANEOUS_NOTES
    const plainest = tiers[tiers.length - 1]
    // Headroom is reserved for one plainest note, so the budget is not blown by
    // more than a single plain note in the pathological case where every note
    // already sounding is at the ceiling.
    const room = ceiling - plainest.cost
    const builtBefore = budget.built

    // The budget is about what is sounding *at once*, not about how many nodes
    // the song has ever built. Notes that have finished ringing give their
    // nodes back, so a long piece plays at full detail throughout.
    for (const ev of events) {
      if (ev.midi == null) continue
      if (realtime && ev.start < now - LATE_NOTE_DROP) {
        budget.droppedLate++
        continue
      }
      const start = realtime && ev.start < now + LATE_NOTE_LEAD ? now + LATE_NOTE_LEAD : ev.start
      const finished = budget.live.filter((item) => item.end <= ev.start)
      for (const item of finished) {
        budget.liveNodes -= item.cost
        budget.liveNotes--
      }
      budget.live = budget.live.filter((item) => item.end > ev.start)

      // Past the polyphony cap a note is dropped. A four-part hymn never gets
      // close, and this is the only path that can lose a note.
      if (budget.liveNotes >= maxNotes) {
        budget.skipped++
        continue
      }

      // Richest form that fits; failing that the plainest one, because a thin
      // note the player can hear beats a rich note that is never scheduled.
      let chosen = plainest
      for (const tier of tiers) {
        if (budget.liveNodes + tier.cost <= room) {
          chosen = tier
          break
        }
      }
      // Only once the budget is genuinely full is a note left out. Four parts of
      // hymn peak far below this, so nothing a player writes is ever dropped.
      if (budget.liveNodes + chosen.cost > ceiling) {
        budget.skipped++
        continue
      }
      if (chosen !== tiers[0]) budget.trimmed++

      let stopAt
      try {
        stopAt = this._scheduleNote(
          ctx,
          destination,
          ev.midi,
          start,
          ev.dur,
          0.95,
          voiceId,
          ring,
          chosen.voice,
          ev.legatoIn,
        )
      } catch (err) {
        // One note the context refuses must not silence the rest of the song —
        // but it is kept, because a silent failure with no message costs the
        // player an evening of guessing.
        budget.skipped++
        if (!budget.error) budget.error = err
        continue
      }
      budget.liveNodes += chosen.cost
      budget.liveNotes++
      budget.built += chosen.cost
      budget.scheduled++
      budget.live.push({
        end: stopAt ?? start + ev.dur + preset.release + ring,
        cost: chosen.cost,
      })
    }

    return {
      notes: events.length,
      skipped: budget.skipped,
      trimmed: budget.trimmed,
      droppedLate: budget.droppedLate,
      nodes: budget.liveNodes,
      built: budget.built - builtBefore,
      budget,
    }
  }

  play(
    seqs,
    {
      tempo = 90,
      voice,
      sustain = 0,
      metronome = false,
      onNoteStart,
      onNoteEnd,
      onDone,
      onError,
      lookahead,
    } = {},
  ) {
    const ctx = this._ensureCtx()
    const profile = deviceProfile()
    const chain = this._masterChain(ctx, ctx.destination, profile.lowPower ? '2x' : '4x')
    const bus = chain.input
    const beat = 60 / tempo
    const timers = []
    const budget = newPlaybackBudget()
    let stopped = false

    const t0 = ctx.currentTime + 0.08
    let longestBeats = 0
    seqs.forEach((seq) => {
      longestBeats = Math.max(longestBeats, sequenceBeats(seq))
    })

    // The song is handed over a few seconds at a time rather than all at once.
    // Scheduling everything up front built every node immediately, so a long
    // four-part sheet asked the browser for thousands of them before a single
    // note sounded. Slices cover [cursor, cursor + window) with no overlap, so
    // each note is scheduled exactly once.
    const window = Math.max(lookahead ?? profile.lookahead, LOOKAHEAD_MIN)
    let cursor = t0
    let first = true
    let advanceTimer = null
    let doneTimer = null

    const scheduleSlice = () => {
      const span = first ? Math.max(window, FIRST_WINDOW) : window
      first = false
      const to = Math.min(cursor + span, t0 + longestBeats * beat)
      this._scheduleAll(ctx, bus, seqs, t0, beat, voice, sustain, {
        from: cursor,
        to,
        budget,
        metronome,
        realtime: true,
        maxNodes: profile.maxNodes,
        maxNotes: profile.maxNotes,
      })
      cursor = to
      // An error here used to vanish into an empty catch, which left the player
      // watching notes highlight over total silence with nothing to report.
      if (budget.error && budget.error !== this.lastError) {
        this.lastError = budget.error
        if (onError) onError(budget.error)
      }
      return cursor >= t0 + longestBeats * beat
    }

    const flush = (budgetNodes = 500) => {
      // When the page is backgrounded (common on mobile), timers are heavily
      // throttled and the last slices can be delayed until much later — long
      // enough for the browser to stop audio. Flush the rest now, a chunk at a
      // time: handing the thread every remaining node in one pass stalls it.
      if (advanceTimer) {
        clearTimeout(advanceTimer)
        advanceTimer = null
      }
      const builtBefore = budget.built
      let done = scheduleSlice()
      while (!done && budget.built - builtBefore < budgetNodes) {
        done = scheduleSlice()
      }
      if (!done && !stopped) {
        setTimeout(() => {
          if (!stopped) flush(budgetNodes)
        }, 0)
      }
    }

    let visHandler = null
    if (typeof document !== 'undefined') {
      visHandler = () => {
        if (
          document.visibilityState === 'visible' &&
          (ctx.state === 'suspended' || ctx.state === 'interrupted')
        ) {
          ctx.resume()
        }
        // If we lose visibility mid-playback, flush remaining to avoid delays.
        if (document.visibilityState === 'hidden' && !stopped) {
          flush()
        }
      }
      document.addEventListener('visibilitychange', visHandler, { passive: true })
    }

    const stop = () => {
      if (stopped) return
      stopped = true
      if (advanceTimer) {
        clearTimeout(advanceTimer)
        advanceTimer = null
      }
      if (visHandler) {
        document.removeEventListener('visibilitychange', visHandler)
        visHandler = null
      }
      const now = ctx.currentTime
      bus.gain.cancelScheduledValues(now)
      bus.gain.setValueAtTime(Math.max(bus.gain.value, MIN_GAIN), now)
      bus.gain.exponentialRampToValueAtTime(MIN_GAIN, now + 0.05)
      setTimeout(chain.dispose, 120)
      timers.forEach(clearTimeout)
      if (doneTimer) clearTimeout(doneTimer)
    }

    this.lastError = null
    this.lastBudget = budget
    // If the tab starts hidden (user opened in background), don't rely on
    // throttled timers: schedule everything immediately.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      flush()
      advanceTimer = null
    } else {
      const allScheduled = scheduleSlice()
      if (!allScheduled) {
        const tick = () => {
          advanceTimer = null
          if (stopped) return
          let done = false
          let slices = 0
          // If a timer was delayed, fill the gap a window at a time. More than
          // three windows at once would build a burst of nodes on the very
          // thread that was already busy, so finish catching up on later ticks.
          while (!done && cursor - ctx.currentTime < window && slices < 3) {
            done = scheduleSlice()
            slices++
          }
          if (!done) {
            const late = cursor - ctx.currentTime < window * 0.5
            advanceTimer = setTimeout(tick, late ? 50 : ADVANCE_TICK_MS)
          }
        }
        advanceTimer = setTimeout(tick, ADVANCE_TICK_MS)
      }
    }

    seqs.forEach((seq, seqIndex) => {
      let t = 0
      seq.notes.forEach((n, index) => {
        const start = t0 + t * beat
        const startMs = (start - ctx.currentTime) * 1000
        const endMs = startMs + n.beats * beat * 1000
        const event = { ...n, index, seqIndex }
        if (onNoteStart) timers.push(setTimeout(() => onNoteStart(event), Math.max(0, startMs)))
        if (onNoteEnd) timers.push(setTimeout(() => onNoteEnd(event), Math.max(0, endMs)))
        t += n.beats
      })
    })

    const doneMs = (t0 - ctx.currentTime) * 1000 + longestBeats * beat * 1000
    doneTimer = setTimeout(() => {
      if (advanceTimer) {
        clearTimeout(advanceTimer)
        advanceTimer = null
      }
      if (onDone) onDone()
      timers.forEach(clearTimeout)
      // Release this pass's own master chain once the ring-out has died away.
      // Only stopping used to disconnect it, so every pass that finished on its
      // own — and Repeat restarts from onDone — left a live compressor on the
      // output, and enough of them made the browser's audio thread distort and
      // eventually fall silent.
      const tailMs = (getVoice(voice).release + sustain + 0.5) * 1000
      setTimeout(chain.dispose, tailMs)
    }, doneMs + 40)

    return { stop }
  }

  playTap(midi, { tempo = 90, voice, sustain = 0 } = {}) {
    const ctx = this._ensureCtx()
    const bus = this._output(ctx)
    const hold = Math.max(0.4, 60 / tempo)
    this._scheduleNote(ctx, bus, midi, ctx.currentTime + 0.02, hold, 0.95, voice, sustain)
  }

  async render(seqs, { tempo = 90, tail = 1.4, voice, sustain = 0, metronome = false } = {}) {
    const beat = 60 / tempo
    let longestBeats = 0
    for (const seq of seqs) longestBeats = Math.max(longestBeats, sequenceBeats(seq))
    const duration = 0.08 + longestBeats * beat + tail
    const sampleRate = 44100
    const ctx = new OfflineAudioContext(1, Math.ceil(duration * sampleRate), sampleRate)
    const bus = this._masterChain(ctx, ctx.destination).input

    this._scheduleAll(ctx, bus, seqs, 0.08, beat, voice, sustain, { metronome })

    return ctx.startRendering()
  }
}
