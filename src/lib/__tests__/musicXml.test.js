import { describe, expect, it } from 'vitest'
import {
  isMusicXmlFile,
  parseMusicXml,
  readMusicXmlFile,
} from '../music/musicXml.js'

function noteXml(step, octave, { duration = 1, type = 'quarter', chord = false, rest = false, tie = '', alter = 0 } = {}) {
  return `<note>${chord ? '<chord/>' : ''}${rest ? '<rest/>' : `<pitch><step>${step}</step><alter>${alter}</alter><octave>${octave}</octave></pitch>`}<duration>${duration}</duration><type>${type}</type>${tie ? `<tie type="${tie}"/>` : ''}</note>`
}

function scoreXml({ key = 0, mode = '', parts = [], time = [4, 4] } = {}) {
  const attributes = `<attributes><key><fifths>${key}</fifths>${mode ? `<mode>${mode}</mode>` : ''}</key><time><beats>${time[0]}</beats><beat-type>${time[1]}</beat-type></time></attributes>`
  const partXml = parts
    .map((part, index) => {
      const measures =
        index === 0
          ? part.measures.replace(/(<measure[^>]*>)/, `$1${attributes}`)
          : part.measures
      return `<part id="${part.id}">${measures}</part>`
    })
    .join('')
  return `<?xml version="1.0"?><score-partwise><work><work-title>Test Hymn</work-title></work><identification><creator type="composer">A. Composer</creator></identification><part-list>${parts.map((part) => `<score-part id="${part.id}"><part-name>${part.name}</part-name></score-part>`).join('')}</part-list>${partXml}</score-partwise>`
}

function measureXml(number, notes, extraAttributes = '') {
  return `<measure number="${number}">${extraAttributes}${notes}</measure>`
}

function u16(value) {
  return [value & 0xff, (value >> 8) & 0xff]
}

function u32(value) {
  return [
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]
}

async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(
    new CompressionStream('deflate-raw')
  )
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function zipEntries(entries, { compress = false } = {}) {
  const encoder = new TextEncoder()
  const locals = []
  const central = []
  let offset = 0
  for (const [name, text] of Object.entries(entries)) {
    const nameBytes = encoder.encode(name)
    const data = encoder.encode(text)
    const stored = compress ? await deflateRaw(data) : data
    const method = compress ? 8 : 0
    const local = new Uint8Array([
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0),
      ...u16(method),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(stored.length),
      ...u32(data.length),
      ...u16(nameBytes.length),
      ...u16(0),
      ...nameBytes,
      ...stored,
    ])
    locals.push(local)
    central.push(
      new Uint8Array([
        ...u32(0x02014b50),
        ...u16(20),
        ...u16(20),
        ...u16(0),
        ...u16(method),
        ...u16(0),
        ...u16(0),
        ...u32(0),
        ...u32(stored.length),
        ...u32(data.length),
        ...u16(nameBytes.length),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u32(0),
        ...u32(offset),
        ...nameBytes,
      ])
    )
    offset += local.length
  }
  const directory = central.reduce(
    (total, entry) => total + entry.length,
    0
  )
  const end = new Uint8Array([
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(central.length),
    ...u16(central.length),
    ...u32(directory),
    ...u32(offset),
    ...u16(0),
  ])
  const all = [...locals, ...central, end]
  const length = all.reduce((total, entry) => total + entry.length, 0)
  const bytes = new Uint8Array(length)
  let cursor = 0
  for (const entry of all) {
    bytes.set(entry, cursor)
    cursor += entry.length
  }
  return bytes
}

describe('MusicXML parsing', () => {
  it('reads key, time, metadata, notes, rests and ties', () => {
    const xml = scoreXml({
      key: 1,
      parts: [
        {
          id: 'P1',
          name: 'Soprano',
          measures: measureXml(
            '1',
            [
              noteXml('G', 4),
              noteXml('A', 4, { tie: 'start' }),
              noteXml('A', 4, { tie: 'stop' }),
              noteXml('', 0, { rest: true }),
            ].join('')
          ),
        },
      ],
    })
    const score = parseMusicXml(xml)

    expect(score.title).toBe('Test Hymn')
    expect(score.composer).toBe('A. Composer')
    expect(score.key).toEqual({ fifths: 1, mode: 'major' })
    expect(score.time).toEqual({ beats: 4, beatType: 4 })
    expect(score.parts[0].name).toBe('Soprano')
    expect(score.parts[0].measures[0].notes.map((note) => note.pitch?.step || 'rest')).toEqual([
      'G',
      'A',
      'A',
      'rest',
    ])
    expect(score.parts[0].measures[0].notes[1].tieStart).toBe(true)
    expect(score.parts[0].measures[0].notes[2].tieStop).toBe(true)
  })

  it('falls back to note type when duration is missing and reduces chords', () => {
    const xml = scoreXml({
      parts: [
        {
          id: 'P1',
          name: 'Part 1',
          measures: measureXml(
            '1',
            [
              '<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>',
              '<note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration></note>',
              '<note><pitch><step>D</step><octave>4</octave></pitch><type>half</type></note>',
            ].join('')
          ),
        },
      ],
    })
    const score = parseMusicXml(xml)

    expect(score.parts[0].measures[0].notes).toHaveLength(2)
    expect(score.parts[0].measures[0].notes[0].pitch.step).toBe('E')
    expect(score.parts[0].measures[0].notes[1].duration).toBe(2)
    expect(score.warnings.join(' ')).toMatch(/chord was reduced/i)
  })

  it('assigns unnamed SATB parts by range and warns about key and time changes', () => {
    const xml = scoreXml({
      parts: [
        { id: 'P1', name: 'Part 1', measures: measureXml('1', noteXml('C', 3, { duration: 4 })) },
        { id: 'P2', name: 'Part 2', measures: measureXml('1', noteXml('E', 4, { duration: 4 })) },
        { id: 'P3', name: 'Part 3', measures: measureXml('1', noteXml('G', 4, { duration: 4 })) },
        { id: 'P4', name: 'Part 4', measures: measureXml('1', noteXml('C', 5, { duration: 4 })) },
      ],
    }).replace(
      '</part></score-partwise>',
      `${measureXml('2', noteXml('C', 5, { duration: 4 }), '<attributes><key><fifths>1</fifths></key><time><beats>3</beats><beat-type>4</beat-type></time></attributes>')}</part></score-partwise>`
    )
    const score = parseMusicXml(xml)

    expect(score.parts.map((part) => part.name)).toEqual([
      'Soprano',
      'Alto',
      'Tenor',
      'Bass',
    ])
    expect(score.warnings.join(' ')).toMatch(/assigned Soprano/i)
    expect(score.warnings.join(' ')).toMatch(/key/i)
    expect(score.warnings.join(' ')).toMatch(/time/i)
  })

  it('splits a two-staff piano part into inferred SATB voices', () => {
    const voiceNote = (step, octave, voice, staff) =>
      `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>1</duration><type>quarter</type><voice>${voice}</voice><staff>${staff}</staff></note>`
    const repeated = (value, count) => Array.from({ length: count }, () => value).join('')
    const notes = [
      repeated(voiceNote('C', 5, 1, 1), 20),
      repeated(voiceNote('G', 4, 2, 1), 20),
      voiceNote('A', 4, 3, 1),
      repeated(voiceNote('C', 4, 5, 2), 20),
      repeated(voiceNote('G', 3, 6, 2), 20),
      voiceNote('A', 3, 7, 2),
    ].join('')
    const attributes =
      '<attributes><divisions>1</divisions><staves>2</staves><key><fifths>-1</fifths><mode>major</mode></key><time><beats>3</beats><beat-type>4</beat-type></time></attributes>'
    const xml = `<?xml version="1.0"?><score-partwise><work><work-title>Makoma</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1">${attributes}${notes}</measure></part></score-partwise>`
    const score = parseMusicXml(xml)

    expect(score.parts.map((part) => part.name)).toEqual(['Soprano', 'Alto', 'Tenor', 'Bass'])
    expect(score.parts.map((part) => part.voice)).toEqual(['1', '2', '5', '6'])
    expect(score.warnings.join(' ')).toMatch(/inferred from two staves/)
    expect(score.warnings.join(' ')).toMatch(/merged/)
  })

  it('uses printed note lengths when Audiveris durations disagree', () => {
    const xml =
      '<score-partwise><work><work-title>Test</work-title></work><part-list><score-part id="P1"><part-name>Soprano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>6</divisions><key><fifths>0</fifths></key><time><beats>3</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type></note></measure></part></score-partwise>'
    const score = parseMusicXml(xml)
    expect(score.parts[0].measures[0].notes[0].duration).toBe(1)
  })

  it('rejects timewise scores and non-MusicXML files', () => {
    expect(() => parseMusicXml('<score-timewise/>')).toThrow(/Timewise/i)
    expect(() => parseMusicXml('<html/>')).toThrow(/not a MusicXML score/i)
  })

  it('detects MusicXML and MXL file names', () => {
    expect(isMusicXmlFile({ name: 'hymn.xml' })).toBe(true)
    expect(isMusicXmlFile({ name: 'hymn.MXL' })).toBe(true)
    expect(isMusicXmlFile({ name: 'hymn.pdf' })).toBe(false)
  })
})

describe('MXL extraction', () => {
  async function readMxl(compress) {
    const xml = scoreXml({
      parts: [
        {
          id: 'P1',
          name: 'Soprano',
          measures: measureXml('1', noteXml('C', 5, { duration: 4 })),
        },
      ],
    })
    const bytes = await zipEntries(
      {
        'META-INF/container.xml':
          '<?xml version="1.0"?><container><rootfiles><rootfile full-path="score.musicxml"/></rootfiles></container>',
        'score.musicxml': xml,
      },
      { compress }
    )
    return readMusicXmlFile({
      name: 'hymn.mxl',
      arrayBuffer: async () => bytes.buffer,
    })
  }

  it('reads a stored MusicXML entry', async () => {
    const score = await readMxl(false)
    expect(score.parts[0].name).toBe('Soprano')
    expect(score.parts[0].measures[0].notes[0].pitch.step).toBe('C')
  })

  it('inflates a compressed MusicXML entry', async () => {
    const score = await readMxl(true)
    expect(score.title).toBe('Test Hymn')
    expect(score.parts[0].measures[0].notes[0].pitch.octave).toBe(5)
  })
})
