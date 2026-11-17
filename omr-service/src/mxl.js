import { inflateRawSync } from 'node:zlib'
import { descendants, parseXml } from '../../src/lib/music/xml.js'
import { OmrError } from './errors.js'

function u16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function u32(bytes, offset) {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  )
}

function decodeXml(bytes) {
  return new TextDecoder('utf-8').decode(bytes)
}

function findScoreEntry(entries) {
  const container = entries.get('META-INF/container.xml')
  if (container) {
    try {
      const root = parseXml(decodeXml(container))
      const rootfile = descendants(root, 'rootfile').find((node) => node.attrs?.['full-path'])
      const fullPath = rootfile?.attrs?.['full-path']
      if (fullPath && entries.has(fullPath)) return fullPath
    } catch {
      /* Fall back to the first XML entry below. */
    }
  }
  return [...entries.keys()].find(
    (name) =>
      /\.(musicxml|xml)$/i.test(name) && !/META-INF\/container\.xml$/i.test(name)
  )
}

function unzip(bytes) {
  let eocd = -1
  const start = Math.max(0, bytes.length - 65557)
  for (let index = bytes.length - 22; index >= start; index -= 1) {
    if (u32(bytes, index) === 0x06054b50) {
      eocd = index
      break
    }
  }
  if (eocd < 0) {
    throw new OmrError('INVALID_MXL', 'Audiveris produced an unreadable MXL file.', {
      retryable: true,
    })
  }

  const count = u16(bytes, eocd + 10)
  const directoryOffset = u32(bytes, eocd + 16)
  const entries = new Map()
  let cursor = directoryOffset

  for (let index = 0; index < count; index += 1) {
    if (u32(bytes, cursor) !== 0x02014b50) break
    const method = u16(bytes, cursor + 10)
    const compressedSize = u32(bytes, cursor + 20)
    const nameLength = u16(bytes, cursor + 28)
    const extraLength = u16(bytes, cursor + 30)
    const commentLength = u16(bytes, cursor + 32)
    const localOffset = u32(bytes, cursor + 42)
    const name = new TextDecoder().decode(
      bytes.subarray(cursor + 46, cursor + 46 + nameLength)
    )
    cursor += 46 + nameLength + extraLength + commentLength

    if (name.endsWith('/')) continue
    if (u32(bytes, localOffset) !== 0x04034b50) continue
    const localNameLength = u16(bytes, localOffset + 26)
    const localExtraLength = u16(bytes, localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize)
    let data
    if (method === 0) data = compressed
    else if (method === 8) data = inflateRawSync(compressed)
    else {
      throw new OmrError(
        'INVALID_MXL',
        `Audiveris produced an MXL file with unsupported compression (${method}).`,
        { retryable: false }
      )
    }
    entries.set(name, data)
  }

  return entries
}

export function extractMusicXml(bytes) {
  const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  if (data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b) {
    const entries = unzip(data)
    const entry = findScoreEntry(entries)
    if (!entry) {
      throw new OmrError('INVALID_MXL', 'The MXL file does not contain a MusicXML score.', {
        retryable: true,
      })
    }
    return decodeXml(entries.get(entry))
  }
  return decodeXml(data)
}
