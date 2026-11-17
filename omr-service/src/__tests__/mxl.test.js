import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { extractMusicXml } from '../mxl.js'

const XML = '<?xml version="1.0"?><score-partwise><part-list/></score-partwise>'

function zip(entries, { compress = false } = {}) {
  const locals = []
  const central = []
  let offset = 0

  for (const [name, text] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name, 'utf8')
    const data = Buffer.from(text, 'utf8')
    const stored = compress ? deflateRawSync(data) : data
    const method = compress ? 8 : 0

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(stored.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    const localRecord = Buffer.concat([local, nameBytes, stored])
    locals.push(localRecord)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(method, 10)
    centralHeader.writeUInt32LE(stored.length, 20)
    centralHeader.writeUInt32LE(data.length, 24)
    centralHeader.writeUInt16LE(nameBytes.length, 28)
    centralHeader.writeUInt32LE(offset, 42)
    central.push(Buffer.concat([centralHeader, nameBytes]))

    offset += localRecord.length
  }

  const directory = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(central.length, 8)
  eocd.writeUInt16LE(central.length, 10)
  eocd.writeUInt32LE(directory.length, 12)
  eocd.writeUInt32LE(offset, 16)

  return Buffer.concat([...locals, directory, eocd])
}

describe('extractMusicXml', () => {
  it('returns plain MusicXML unchanged', () => {
    expect(extractMusicXml(Buffer.from(XML))).toBe(XML)
  })

  it('extracts the score named by META-INF/container.xml from an MXL', () => {
    const mxl = zip(
      {
        'META-INF/container.xml':
          '<?xml version="1.0"?><container><rootfiles><rootfile full-path="score.musicxml"/></rootfiles></container>',
        'score.musicxml': XML,
      },
      { compress: true }
    )
    expect(extractMusicXml(mxl)).toBe(XML)
  })

  it('falls back to the first MusicXML entry when the container is absent', () => {
    const mxl = zip({ 'sheet.musicxml': XML })
    expect(extractMusicXml(mxl)).toBe(XML)
  })

  it('rejects a ZIP with no MusicXML entry', () => {
    const mxl = zip({ 'readme.txt': 'nothing here' })
    expect(() => extractMusicXml(mxl)).toThrow(/does not contain a MusicXML/)
  })
})
