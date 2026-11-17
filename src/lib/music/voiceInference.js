import { child, children, childText, hasChild } from './xml.js'

const STEP_PITCH_CLASS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const SATB_ROLES = ['soprano', 'alto', 'tenor', 'bass']
const SATB_NAMES = ['Soprano', 'Alto', 'Tenor', 'Bass']

function pitchMidi(node) {
  const step = String(childText(node, 'step') || '').toUpperCase()
  const octave = Number(childText(node, 'octave'))
  if (!Object.prototype.hasOwnProperty.call(STEP_PITCH_CLASS, step)) return null
  if (!Number.isFinite(octave)) return null
  const alter = Number(childText(node, 'alter') || 0)
  return (Math.round(octave) + 1) * 12 + STEP_PITCH_CLASS[step] + (Number.isFinite(alter) ? alter : 0)
}

function emptySatb() {
  return {
    satb: false,
    satbConfirmed: false,
    satbInferred: false,
    mapping: {},
    warning: null,
  }
}

function namedRole(name) {
  const lower = String(name || '').toLowerCase()
  return SATB_ROLES.find((role) => lower.startsWith(role)) || null
}

function inferSatb(active) {
  if (active.length !== 4) return emptySatb()

  const roles = active.map((voice) => namedRole(voice.partName))
  if (roles.every(Boolean) && new Set(roles).size === 4) {
    const mapping = {}
    active.forEach((voice, index) => {
      const role = namedRole(voice.partName)
      mapping[role] = {
        index,
        name: SATB_NAMES[SATB_ROLES.indexOf(role)],
        voice: voice.voice,
        staff: voice.staff,
      }
    })
    return {
      satb: true,
      satbConfirmed: true,
      satbInferred: false,
      mapping,
      warning: null,
    }
  }

  const byStaff = new Map()
  for (const voice of active) {
    if (!byStaff.has(voice.staff)) byStaff.set(voice.staff, [])
    byStaff.get(voice.staff).push(voice)
  }
  const staffKeys = [...byStaff.keys()].sort((a, b) => Number(a) - Number(b))
  if (staffKeys.length !== 2 || staffKeys.some((key) => byStaff.get(key).length !== 2)) {
    return emptySatb()
  }

  const ranked = staffKeys.map((key) =>
    [...byStaff.get(key)].sort((a, b) => b.averageMidi - a.averageMidi)
  )
  const ordered = [ranked[0][0], ranked[0][1], ranked[1][0], ranked[1][1]]
  const mapping = {}
  ordered.forEach((voice, index) => {
    mapping[SATB_ROLES[index]] = {
      index,
      name: SATB_NAMES[index],
      voice: voice.voice,
      staff: voice.staff,
    }
  })
  return {
    satb: true,
    satbConfirmed: false,
    satbInferred: true,
    mapping,
    warning:
      'Audiveris wrote four voices as one part. Soprano, Alto, Tenor and Bass were inferred from two staves and pitch range; check every voice against the original page.',
  }
}

export function inferVoices(parts, { listedNames = new Map(), artifactThreshold = 0.05 } = {}) {
  const voices = new Map()

  parts.forEach((part, partIndex) => {
    const id = part.attrs?.id || ''
    const partName = listedNames.get(id) || `Part ${partIndex + 1}`
    for (const measure of children(part, 'measure')) {
      for (const note of children(measure, 'note')) {
        if (hasChild(note, 'grace')) continue
        const voice = childText(note, 'voice') || '1'
        const staff = childText(note, 'staff') || '1'
        const key = `${partIndex}|${staff}|${voice}`
        if (!voices.has(key)) {
          voices.set(key, {
            key,
            partIndex,
            partName,
            voice,
            staff,
            noteCount: 0,
            midiSum: 0,
            midiCount: 0,
          })
        }
        const entry = voices.get(key)
        if (!hasChild(note, 'rest')) entry.noteCount += 1
        const pitch = child(note, 'pitch')
        if (pitch) {
          const midi = pitchMidi(pitch)
          if (midi != null) {
            entry.midiSum += midi
            entry.midiCount += 1
          }
        }
      }
    }
  })

  const allVoices = [...voices.values()].map((voice) => ({
    ...voice,
    averageMidi: voice.midiCount ? voice.midiSum / voice.midiCount : 0,
    artifact: false,
  }))

  const byStaff = new Map()
  for (const voice of allVoices) {
    if (!byStaff.has(voice.staff)) byStaff.set(voice.staff, [])
    byStaff.get(voice.staff).push(voice)
  }
  for (const staffVoices of byStaff.values()) {
    const maxNotes = Math.max(1, ...staffVoices.map((voice) => voice.noteCount))
    for (const voice of staffVoices) {
      voice.artifact = voice.noteCount <= maxNotes * artifactThreshold
    }
  }

  const activeVoices = allVoices.filter((voice) => !voice.artifact)
  const artifactVoices = allVoices
    .filter((voice) => voice.artifact)
    .map((voice) => {
      const candidates = activeVoices.filter((candidate) => candidate.staff === voice.staff)
      const pool = candidates.length ? candidates : activeVoices
      const target = [...pool].sort(
        (a, b) => Math.abs(a.averageMidi - voice.averageMidi) - Math.abs(b.averageMidi - voice.averageMidi)
      )[0]
      return { ...voice, targetKey: target?.key || null }
    })

  const warnings = []
  if (artifactVoices.length) {
    const labels = artifactVoices.map((voice) => voice.voice).join(', ')
    warnings.push(
      `${artifactVoices.length} tiny Audiveris voice fragment${artifactVoices.length === 1 ? '' : 's'} (${labels}) were merged into nearby voices on the same staff; check against the page.`
    )
  }

  const satb = inferSatb(activeVoices)
  if (satb.warning) warnings.push(satb.warning)

  return { allVoices, activeVoices, artifactVoices, satb, warnings }
}
