import { describe, expect, it } from 'vitest'
import { audioBufferToWavBlob } from '../wav.js'

function fakeBuffer(values, sampleRate = 8000) {
  return {
    numberOfChannels: 1,
    length: values.length,
    sampleRate,
    getChannelData: () => values,
  }
}

describe('wav encoder', () => {
  it('encodes a mono buffer to a valid WAV file', async () => {
    const blob = audioBufferToWavBlob(fakeBuffer([0, 1, -1, 0.5]))
    console.log('DEBUG blob type:', blob.type, 'size:', blob.size)
    expect(blob.type).toBe('audio/wav')

    const buf = new Uint8Array(await blob.arrayBuffer())
    console.log('DEBUG byteLength:', buf.byteLength, 'bytes0-8:', Array.from(buf.slice(0, 8)).join(' '))
    const ascii = (o, n) => String.fromCharCode(...buf.subarray(o, o + n))

    expect(ascii(0, 4)).toBe('RIFF')
    expect(ascii(8, 4)).toBe('WAVE')
    expect(ascii(12, 4)).toBe('fmt ')
    expect(ascii(36, 4)).toBe('data')

    const view = new DataView(buf.buffer)
    expect(view.getUint32(4, true)).toBe(36 + 8)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(8000)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(8)

    expect(view.getInt16(44, true)).toBe(0)
    expect(view.getInt16(46, true)).toBe(0x7fff)
    expect(view.getInt16(48, true)).toBe(-0x8000)
    expect(view.getInt16(50, true)).toBe(0x4000)
  })

  it('clamps out-of-range samples', async () => {
    const blob = audioBufferToWavBlob(fakeBuffer([2, -3, 0.25, -0.5]), 8000)
    const buf = new Uint8Array(await blob.arrayBuffer())
    const view = new DataView(buf.buffer)
    expect(view.getInt16(44, true)).toBe(0x7fff)
    expect(view.getInt16(46, true)).toBe(-0x8000)
    expect(view.getInt16(48, true)).toBe(8192) // 0.25 * 32767 = 8191.75 -> 8192
    expect(view.getInt16(50, true)).toBe(-16384) // -0.5 * 32768
  })

  it('encodes stereo buffers interleaved', async () => {
    const values = {
      numberOfChannels: 2,
      length: 2,
      sampleRate: 44100,
      getChannelData: (c) => (c === 0 ? [0.5, -0.5] : [1, 0]),
    }
    const blob = audioBufferToWavBlob(values)
    const buf = new Uint8Array(await blob.arrayBuffer())
    const view = new DataView(buf.buffer)
    expect(view.getUint16(22, true)).toBe(2)
    expect(view.getUint32(40, true)).toBe(8)
    expect(view.getInt16(44, true)).toBe(0x4000)
    expect(view.getInt16(46, true)).toBe(0x7fff)
    expect(view.getInt16(48, true)).toBe(-0x4000)
    expect(view.getInt16(50, true)).toBe(0)
  })
})
