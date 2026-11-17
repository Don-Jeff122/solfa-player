import { child, children, childText, parseXml } from '../../src/lib/music/xml.js'

const PITCH_STEPS = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G'])
const SATB_ROLES = ['soprano', 'alto', 'tenor', 'bass']
const SATB_LABELS = ['Soprano', 'Alto', 'Tenor', 'Bass']

function localName(node) {
  return String(node?.name || '').split(':').pop()
}

function numberText(node, name) {
  const text = childText(node, name)
  if (!text) return null
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

function listedPartNames(partList) {
  const names = new Map()
  for (const part of children(partList, 'score-part')) {
    if (part.attrs?.id) names.set(part.attrs.id, childText(part, 'part-name'))
  }
  return names
}

function scoreTitle(root) {
  const direct = childText(root, 'movement-title')
  if (direct) return direct
  const work = child(root, 'work')
  return childText(work, 'work-title')
}

function firstKeyAndTime(parts) {
  let key = null
  let time = null
  for (const part of parts) {
    for (const measure of children(part, 'measure')) {
      const attributes = child(measure, 'attributes')
      if (!attributes) continue
      if (!key) {
        const keyNode = child(attributes, 'key')
        const fifths = numberText(keyNode, 'fifths')
        if (fifths != null) {
          const mode = childText(keyNode, 'mode').toLowerCase()
          key = { fifths, mode: mode === 'minor' ? 'minor' : 'major' }
        }
      }
      if (!time) {
        const timeNode = child(attributes, 'time')
        const beats = numberText(timeNode, 'beats')
        const beatType = numberText(timeNode, 'beat-type')
        if (beats != null && beatType != null && beats > 0 && beatType > 0) {
          time = { beats, beatType }
        }
      }
    }
  }
  return { key, time }
}

function satbReport(partNames) {
  if (partNames.length !== 4) {
    return {
      satb: false,
      satbConfirmed: false,
      mapping: {},
      warning: null,
    }
  }

  const used = new Set()
  const mapping = {}
  partNames.forEach((name, index) => {
    const lower = name.toLowerCase()
    const role = SATB_ROLES.find((candidate) => lower.startsWith(candidate))
    if (role && !used.has(role)) {
      mapping[role] = { index, name: SATB_LABELS[SATB_ROLES.indexOf(role)] }
      used.add(role)
    }
  })

  const satbConfirmed = Object.keys(mapping).length === SATB_ROLES.length
  return {
    satb: satbConfirmed,
    satbConfirmed,
    mapping,
    warning: satbConfirmed
      ? null
      : 'Four parts were found, but their names do not clearly identify Soprano, Alto, Tenor and Bass. Review every part and do not assume the voice order.',
  }
}

export function validateMusicXml(xml, { fileName = 'score.musicxml' } = {}) {
  const errors = []
  const warnings = []
  const parsedFile = String(fileName || 'score.musicxml')

  if (!String(xml || '').trim()) {
    return {
      ok: false,
      errors: ['The generated MusicXML file is empty.'],
      warnings,
      fileName: parsedFile,
      summary: null,
    }
  }

  let root
  try {
    root = parseXml(xml)
  } catch (error) {
    return {
      ok: false,
      errors: [`The generated file is not valid XML: ${error.message}`],
      warnings,
      fileName: parsedFile,
      summary: null,
    }
  }

  const rootName = localName(root)
  if (rootName !== 'score-partwise') {
    errors.push(
      rootName === 'score-timewise'
        ? 'Audiveris produced timewise MusicXML, but only partwise MusicXML is supported.'
        : `Expected MusicXML score-partwise, found ${rootName || 'an unknown root element'}.`
    )
  }

  const partList = child(root, 'part-list')
  const listedNames = listedPartNames(partList)
  const listed = children(partList, 'score-part')
  if (!listed.length) errors.push('The MusicXML has no score-part entries in part-list.')

  const parts = children(root, 'part')
  if (!parts.length) errors.push('The MusicXML has no musical parts.')

  let totalPitchedNotes = 0
  let totalRests = 0
  let invalidNotes = 0
  let maxMeasures = 0
  const partNames = []

  parts.forEach((part, partIndex) => {
    const id = part.attrs?.id || ''
    const name = listedNames.get(id) || `Part ${partIndex + 1}`
    partNames.push(name)
    const measures = children(part, 'measure')
    maxMeasures = Math.max(maxMeasures, measures.length)
    if (!measures.length) errors.push(`Part “${name}” has no measures.`)

    let partNotes = 0
    for (const measure of measures) {
      for (const note of children(measure, 'note')) {
        if (child(note, 'rest')) {
          totalRests += 1
          continue
        }
        const pitch = child(note, 'pitch')
        if (!pitch) {
          invalidNotes += 1
          continue
        }
        const step = childText(pitch, 'step').toUpperCase()
        const octave = numberText(pitch, 'octave')
        if (!PITCH_STEPS.has(step) || octave == null || !Number.isInteger(octave)) {
          invalidNotes += 1
          continue
        }
        totalPitchedNotes += 1
        partNotes += 1
      }
    }
    if (!partNotes) errors.push(`Part “${name}” contains no pitched notes.`)
  })

  if (!totalPitchedNotes) errors.push('The MusicXML contains no pitched notes.')
  if (invalidNotes) {
    errors.push(`${invalidNotes} note${invalidNotes === 1 ? '' : 's'} had no valid pitch or rest.`)
  }

  if (partNames.some((name) => /^(part|voice|track)\s*\d*$/i.test(name))) {
    warnings.push(
      'Some part names are generic. The score was not given invented voice names; review the original page before relying on the parts.'
    )
  }

  const { key, time } = firstKeyAndTime(parts)
  if (!key) warnings.push('No key signature was found in the MusicXML.')
  if (!time) warnings.push('No time signature was found in the MusicXML.')

  const title = scoreTitle(root)
  if (!title) warnings.push('No score title was found in the MusicXML.')

  const satb = satbReport(partNames)
  if (satb.warning) warnings.push(satb.warning)

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    fileName: parsedFile,
    title,
    summary: {
      parts: parts.length,
      partNames,
      measures: maxMeasures,
      notes: totalPitchedNotes,
      rests: totalRests,
      key,
      time,
      satb: satb.satb,
      satbConfirmed: satb.satbConfirmed,
      satbMapping: satb.mapping,
    },
  }
}
