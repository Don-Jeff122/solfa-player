/**
 * A minimal Web Audio stand-in.
 *
 * There is no real AudioContext in the test environment, and the bugs that
 * matter for these presets are exactly the ones a real context would throw on
 * (exponential ramps to zero, oscillators started twice, filters at 0 Hz). This
 * fake records every node and every scheduled value so the tests can assert the
 * whole graph is legal.
 */

const FILTER_TYPES = new Set([
  'lowpass',
  'highpass',
  'bandpass',
  'lowshelf',
  'highshelf',
  'peaking',
  'notch',
  'allpass',
])

function createParam(log, name) {
  // A real AudioParam keeps its automation events in time order and misbehaves
  // badly when they are inserted out of order, so the fake refuses them too.
  let lastTime = -Infinity
  const order = (time, kind) => {
    if (!Number.isFinite(time)) throw new Error(`${name}: ${kind} needs a finite time`)
    if (time < lastTime) {
      throw new Error(`${name}: ${kind} at ${time} is before the previous event at ${lastTime}`)
    }
    lastTime = time
  }
  return {
    value: 0,
    setValueAtTime(value, time) {
      order(time, 'set')
      log.push({ param: name, kind: 'set', value, time })
      this.value = value
      return this
    },
    linearRampToValueAtTime(value, time) {
      order(time, 'linear ramp')
      log.push({ param: name, kind: 'linear', value, time })
      return this
    },
    exponentialRampToValueAtTime(value, time) {
      order(time, 'exponential ramp')
      if (!(value > 0)) {
        throw new Error(`${name}: exponential ramp needs a positive target, got ${value}`)
      }
      log.push({ param: name, kind: 'exponential', value, time })
      return this
    },
    cancelScheduledValues(time) {
      log.push({ param: name, kind: 'cancel', value: 0, time })
      lastTime = -Infinity
      return this
    },
  }
}

function createNode(log, kind, extra = {}) {
  const node = {
    kind,
    connected: [],
    started: false,
    stopped: false,
    connect(dest) {
      node.connected.push(dest)
      return dest
    },
    disconnect() {},
    start(time) {
      if (node.started) throw new Error(`${kind} started twice`)
      if (typeof time !== 'number' || !Number.isFinite(time)) {
        throw new Error(`${kind} started without a finite time`)
      }
      node.started = true
    },
    stop(time) {
      if (!node.started) throw new Error(`${kind} stopped before it started`)
      if (typeof time !== 'number' || !Number.isFinite(time)) {
        throw new Error(`${kind} stopped without a finite time`)
      }
      node.stopped = true
      node.stopTime = time
    },
    ...extra,
  }
  log.push(node)
  return node
}

export function createFakeContext({ sampleRate = 44100 } = {}) {
  const log = []
  const ctx = {
    log,
    sampleRate,
    state: 'running',
    currentTime: 0,
    destination: createNode(log, 'destination'),
    resume() {
      ctx.state = 'running'
    },
    createGain() {
      return createNode(log, 'gain', { gain: createParam(log, 'gain') })
    },
    createOscillator() {
      return createNode(log, 'oscillator', {
        type: 'sine',
        wave: null,
        frequency: createParam(log, 'frequency'),
        detune: createParam(log, 'detune'),
        setPeriodicWave(wave) {
          if (!wave || !wave.imag) throw new Error('setPeriodicWave needs a real wave')
          this.wave = wave
          log.push({ kind: 'wave', wave, time: log.length })
        },
      })
    },
    createPeriodicWave(real, imag, options = {}) {
      if (!Array.isArray(real) || !Array.isArray(imag)) {
        throw new Error('createPeriodicWave needs real and imag arrays')
      }
      if (imag.length !== real.length) throw new Error('real and imag must be the same length')
      if (imag.length < 2) throw new Error('a periodic wave needs at least one harmonic')
      const all = real.concat(imag)
      if (!all.every((v) => Number.isFinite(v))) {
        throw new Error('periodic wave coefficients must be finite')
      }
      if (all.every((v) => v === 0)) {
        throw new Error('a periodic wave of all zeros is not a sound')
      }
      const wave = {
        real: real.slice(),
        imag: imag.slice(),
        disableNormalization: !!options.disableNormalization,
      }
      log.push({ kind: 'createWave', wave, time: log.length })
      return wave
    },
    createBiquadFilter() {
      let type = 'lowpass'
      return createNode(log, 'filter', {
        frequency: createParam(log, 'frequency'),
        Q: createParam(log, 'Q'),
        gain: createParam(log, 'gain'),
        get type() {
          return type
        },
        set type(value) {
          if (!FILTER_TYPES.has(value)) throw new Error(`unknown filter type ${value}`)
          type = value
        },
      })
    },
    createDynamicsCompressor() {
      return createNode(log, 'compressor', {
        threshold: createParam(log, 'threshold'),
        knee: createParam(log, 'knee'),
        ratio: createParam(log, 'ratio'),
      })
    },
    createBufferSource() {
      return createNode(log, 'bufferSource', { buffer: null })
    },
    createBuffer(channels, length, rate) {
      const data = Array.from({ length: channels }, () => new Float32Array(length))
      return {
        numberOfChannels: channels,
        length,
        sampleRate: rate,
        getChannelData: (i) => data[i],
      }
    },
    async startRendering() {
      return {
        numberOfChannels: 1,
        length: 1024,
        sampleRate,
        getChannelData: () => new Float32Array(1024),
      }
    },
  }
  return ctx
}

/** Installs fake live and offline contexts on globalThis for one test. */
export function installFakeAudio({ sampleRate = 44100 } = {}) {
  const live = createFakeContext({ sampleRate })
  const offline = createFakeContext({ sampleRate })
  const previous = {
    window: globalThis.window,
    offline: globalThis.OfflineAudioContext,
  }
  globalThis.window = {
    AudioContext: function AudioContext() {
      return live
    },
  }
  globalThis.OfflineAudioContext = function OfflineAudioContext() {
    return offline
  }
  return {
    live,
    offline,
    restore() {
      if (previous.window === undefined) delete globalThis.window
      else globalThis.window = previous.window
      if (previous.offline === undefined) delete globalThis.OfflineAudioContext
      else globalThis.OfflineAudioContext = previous.offline
    },
  }
}

export function nodesOfKind(log, kind) {
  return log.filter((n) => n.kind === kind)
}

/**
 * How many real audio nodes were built. The log also holds automation events
 * (`set`, `exponential`, ...), so count only entries that are nodes.
 */
export function nodeCount(log) {
  return log.filter((entry) => typeof entry.connect === 'function').length
}

export function scheduled(log, param) {
  return log.filter((entry) => entry.param === param)
}
