import { child, childText, children, descendants, hasChild, parseXml } from './xml.js'
import { inferVoices } from './voiceInference.js'

const MUSIC_XML_RE = /\.(musicxml|xml)$/i
const MXL_RE = /\.mxl$/i
const TYPE_BEATS = {
  maxima: 32,
  long: 16,
  breve: 8,
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  '16th': 0.25,
  '32nd': 0.125,
  '64th': 0.0625,
  '128th': 0.03125,
  '256th': 0.015625,
}
const STEP_PITCH_CLASS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const SATB_ORDER = ['soprano', 'alto', 'tenor', 'bass']
const SATB_NAME = ['Soprano', 'Alto', 'Tenor', 'Bass']

export function isMusicXmlFile(file) {
  if (!file) return false
  const name = String(file.name || '')
  const type = String(file.type || '').toLowerCase()
  return (
    MXL_RE.test(name) ||
    MUSIC_XML_RE.test(name) ||
    type === 'application/vnd.recordare.musicxml' ||
    type === 'application/vnd.recordare.musicxml+xml' ||
    type === 'application/xml' ||
    type === 'text/xml'
  )
}

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

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('This browser cannot open compressed MXL files.')
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function unzipEntries(bytes) {
  let eocd = -1
  const start = Math.max(0, bytes.length - 65557)
  for (let index = bytes.length - 22; index >= start; index -= 1) {
    if (u32(bytes, index) === 0x06054b50) {
      eocd = index
      break
    }
  }
  if (eocd < 0) throw new Error('That MXL file is not a valid ZIP archive.')
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
    else if (method === 8) data = await inflateRaw(compressed)
    else throw new Error(`Unsupported compression in the MXL file (method ${method}).`)
    entries.set(name, data)
  }

  return entries
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
      if (rootfile?.attrs?.['full-path']) {
        const path = rootfile.attrs['full-path']
        if (entries.has(path)) return path
      }
    } catch {
      /* Fall back to the first XML entry below. */
    }
  }
  return [...entries.keys()].find(
    (name) => /\.(musicxml|xml)$/i.test(name) && !/META-INF\/container\.xml$/i.test(name)
  )
}

export async function readMusicXmlFile(file) {
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw new Error('Choose a MusicXML or MXL file first.')
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const entries = await unzipEntries(bytes)
    const scoreEntry = findScoreEntry(entries)
    if (!scoreEntry) throw new Error('The MXL file does not contain a MusicXML score.')
    return parseMusicXml(decodeXml(entries.get(scoreEntry)))
  }
  return parseMusicXml(decodeXml(bytes))
}

function normalizePitch(node) {
  if (!node) return null
  const step = childText(node, 'step').toUpperCase()
  if (!Object.prototype.hasOwnProperty.call(STEP_PITCH_CLASS, step)) return null
  const octave = Number(childText(node, 'octave'))
  if (!Number.isFinite(octave)) return null
  const alterText = childText(node, 'alter')
  const alter = Number(alterText || 0)
  return {
    step,
    alter: Number.isFinite(alter) ? Math.max(-2, Math.min(2, Math.round(alter))) : 0,
    octave: Math.round(octave),
  }
}

function pitchMidi(pitch) {
  if (!pitch) return null
  return (pitch.octave + 1) * 12 + STEP_PITCH_CLASS[pitch.step] + pitch.alter
}

function noteDuration(note, divisions) {
  const duration = Number(childText(note, 'duration'))
  if (Number.isFinite(duration) && duration > 0) {
    return duration / (divisions > 0 ? divisions : 1)
  }
  const type = childText(note, 'type').toLowerCase()
  const base = TYPE_BEATS[type]
  if (!base) return null
  const dots = children(note, 'dot').length
  return base * (dots ? 1.5 ** dots : 1)
}

function noteTies(note) {
  let start = false
  let stop = false
  for (const tie of children(note, 'tie')) {
    if (tie.attrs?.type === 'start') start = true
    if (tie.attrs?.type === 'stop') stop = true
  }
  const notations = child(note, 'notations')
  for (const tied of children(notations, 'tied')) {
    if (tied.attrs?.type === 'start') start = true
    if (tied.attrs?.type === 'stop') stop = true
  }
  return { start, stop }
}

function normalizeTime(node) {
  if (!node) return null
  const beats = Number(childText(node, 'beats'))
  const beatType = Number(childText(node, 'beat-type'))
  if (!Number.isFinite(beats) || !Number.isFinite(beatType) || beats <= 0 || beatType <= 0) {
    return null
  }
  return {
    beats: Math.round(beats),
    beatType: Math.round(beatType),
  }
}

function normalizeKey(node) {
  if (!node) return null
  const fifths = Number(childText(node, 'fifths'))
  if (!Number.isFinite(fifths)) return null
  return {
    fifths: Math.max(-7, Math.min(7, Math.round(fifths))),
    mode: childText(node, 'mode').toLowerCase() === 'minor' ? 'minor' : 'major',
  }
}

function isGenericName(name) {
  return !name || /^(part|voice|staff|track)\s*\d*$/i.test(name) || /^p\d+$/i.test(name)
}

function voiceName(partName, voice, totalVoices, genericPart) {
  const base = partName || 'Part'
  if (totalVoices === 1) return base
  if (genericPart) return `${base} voice ${voice}`
  return `${base} ${voice}`
}

function averageMidi(part) {
  const notes = part.measures
    .flatMap((measure) => measure.notes)
    .filter((note) => !note.rest && note.pitch)
  if (!notes.length) return 0
  return notes.reduce((sum, note) => sum + (pitchMidi(note.pitch) || 0), 0) / notes.length
}

function assignSatbNames(parts, warnings) {
  if (parts.length !== 4) return parts
  const named = parts.filter((part) =>
    SATB_ORDER.some((name) => part.name.toLowerCase().startsWith(name))
  )
  if (named.length === parts.length) {
    return [...parts].sort((a, b) => {
      const ai = SATB_ORDER.findIndex((name) => a.name.toLowerCase().startsWith(name))
      const bi = SATB_ORDER.findIndex((name) => b.name.toLowerCase().startsWith(name))
      return ai - bi
    })
  }
  if (!parts.every((part) => isGenericName(part.name) || /voice/i.test(part.name))) {
    return parts
  }
  const sorted = [...parts].sort((a, b) => averageMidi(b) - averageMidi(a))
  sorted.forEach((part, index) => {
    part.name = SATB_NAME[index]
  })
  warnings.push(
    'No voice names were printed, so the four parts were assigned Soprano, Alto, Tenor and Bass by range.'
  )
  return sorted
}

export function parseMusicXml(text) {
  const root = parseXml(text)
  const rootName = String(root?.name || '').split(':').pop()
  if (rootName !== 'score-partwise') {
    throw new Error(
      rootName === 'score-timewise'
        ? 'Timewise MusicXML is not supported. Save the score as partwise MusicXML.'
        : 'That file is not a MusicXML score.'
    )
  }

  const warnings = []
  const partList = child(root, 'part-list')
  const names = new Map()
  for (const scorePart of children(partList, 'score-part')) {
    names.set(scorePart.attrs?.id, childText(scorePart, 'part-name'))
  }

  const work = child(root, 'work')
  const title = childText(work, 'work-title') || childText(root, 'movement-title')
  const composer =
    descendants(root, 'creator').find((node) => node.attrs?.type === 'composer')?.text.trim() ||
    ''

  let initialKey = null
  let firstTime = null
  let keyChanged = false
  let timeChanged = false
  const parts = []
  const partNodes = children(root, 'part')
  const voiceInference = inferVoices(partNodes, { listedNames: names })
  const inferredVoiceNames = new Map()
  for (const mapping of Object.values(voiceInference.satb.mapping)) {
    const match = voiceInference.activeVoices.find(
      (voice) => voice.voice === mapping.voice && voice.staff === mapping.staff
    )
    if (match) inferredVoiceNames.set(match.key, mapping.name)
  }
  warnings.push(...voiceInference.warnings)

  partNodes.forEach((partNode, partIndex) => {
    const id = partNode.attrs?.id
    const partName = names.get(id) || `Part ${partIndex + 1}`
    const measureNodes = children(partNode, 'measure')
    const measureMeta = []
    const voices = new Map()
    const voiceMeta = new Map()
    let divisions = 1
    let time = null
    let clef = null
    let transposed = false

    measureNodes.forEach((measureNode, measureIndex) => {
      const attributes = child(measureNode, 'attributes')
      if (attributes) {
        const divisionsText = childText(attributes, 'divisions')
        const nextDivisions = Number(divisionsText)
        if (Number.isFinite(nextDivisions) && nextDivisions > 0) divisions = nextDivisions
        const nextKey = normalizeKey(child(attributes, 'key'))
        if (nextKey) {
          if (!initialKey) initialKey = nextKey
          else if (nextKey.fifths !== initialKey.fifths || nextKey.mode !== initialKey.mode) {
            keyChanged = true
          }
        }
        const nextTime = normalizeTime(child(attributes, 'time'))
        if (nextTime) {
          if (!firstTime) firstTime = nextTime
          else if (
            nextTime.beats !== firstTime.beats ||
            nextTime.beatType !== firstTime.beatType
          ) {
            timeChanged = true
          }
          time = nextTime
        }
        const clefNode = child(attributes, 'clef')
        if (clefNode) {
          clef = `${childText(clefNode, 'sign') || ''}${childText(clefNode, 'line') || ''}`
        }
        if (child(attributes, 'transpose')) transposed = true
      }

      const number = measureNode.attrs?.number || String(measureIndex + 1)
      const measureNotes = new Map()

      for (const noteNode of children(measureNode, 'note')) {
        if (hasChild(noteNode, 'grace')) continue
        const voice = childText(noteNode, 'voice') || '1'
        const staff = childText(noteNode, 'staff') || '1'
        const voiceKey = `${partIndex}|${staff}|${voice}`
        if (!voiceMeta.has(voiceKey)) {
          voiceMeta.set(voiceKey, { key: voiceKey, partName, voice, staff })
        }
        if (!measureNotes.has(voiceKey)) measureNotes.set(voiceKey, [])
        const list = measureNotes.get(voiceKey)
        const duration = noteDuration(noteNode, divisions)
        if (!duration || duration <= 0) {
          warnings.push(
            `${partName}, measure ${number}: a note had no readable length and was skipped.`
          )
          continue
        }
        const rest = hasChild(noteNode, 'rest')
        const pitch = rest ? null : normalizePitch(child(noteNode, 'pitch'))
        if (!rest && !pitch) {
          warnings.push(
            `${partName}, measure ${number}: an unreadable note was replaced with a rest.`
          )
        }
        const ties = noteTies(noteNode)
        const normalized = {
          pitch,
          rest: rest || !pitch,
          duration,
          confidence: 1,
          tieStart: ties.start,
          tieStop: ties.stop,
          measure: number,
        }
        if (hasChild(noteNode, 'chord') && list.length) {
          const previous = list[list.length - 1]
          const previousMidi = pitchMidi(previous.pitch)
          const nextMidi = pitchMidi(pitch)
          if (nextMidi != null && previousMidi != null && nextMidi > previousMidi) {
            previous.pitch = pitch
            previous.rest = false
            previous.tieStart = ties.start
            previous.tieStop = ties.stop
          }
          warnings.push(
            `${partName}, measure ${number}: a chord was reduced to one note.`
          )
          continue
        }
        list.push(normalized)
      }

      measureMeta.push({
        number,
        beats: time ? (time.beats * 4) / time.beatType : null,
      })

      for (const [voiceKey, list] of measureNotes) {
        if (!voices.has(voiceKey)) voices.set(voiceKey, measureNodes.map(() => []))
        const measures = voices.get(voiceKey)
        if (!measures[measureIndex]) measures[measureIndex] = []
        measures[measureIndex].push(...list)
      }
    })

    for (const artifact of voiceInference.artifactVoices) {
      if (artifact.partIndex !== partIndex || !artifact.targetKey) continue
      const source = voices.get(artifact.key)
      const target = voices.get(artifact.targetKey)
      if (!source || !target) continue
      source.forEach((notes, index) => target[index].push(...notes))
      voices.delete(artifact.key)
    }

    const genericPart = isGenericName(partName)
    for (const [voiceKey, measureNotes] of voices) {
      const measures = measureMeta.map((meta, index) => ({
        number: meta.number,
        beats: meta.beats,
        notes: measureNotes[index] || [],
      }))
      const notes = measures.flatMap((measure) => measure.notes)
      if (!notes.length) continue
      const meta = voiceMeta.get(voiceKey) || { voice: '1', staff: '1' }
      parts.push({
        name: inferredVoiceNames.get(voiceKey) || voiceName(partName, meta.voice, voices.size, genericPart),
        clef,
        voice: meta.voice,
        staff: meta.staff,
        measures,
        notes,
        confidence: 1,
      })
    }

    if (transposed) {
      warnings.push(`${partName} uses a transposing instrument; written pitches were kept.`)
    }
  })

  if (!parts.length) throw new Error('No readable notes were found in that MusicXML score.')
  if (keyChanged) {
    warnings.push('The score changes key; the first key signature was used for playback.')
  }
  if (timeChanged) {
    warnings.push('The score changes time signature; the first time signature was used.')
  }

  const ordered = assignSatbNames(parts, warnings)
  return {
    title,
    composer,
    key: initialKey || { fifths: 0, mode: 'major' },
    time: firstTime,
    parts: ordered,
    warnings,
    source: 'musicxml',
    confidence: 1,
  }
}
