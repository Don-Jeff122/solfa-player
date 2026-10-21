/**
 * How much silence the renderer puts before the first note.
 *
 * A played song starts a moment after Play so the opening attack is not lost
 * to the work of starting the audio context. Offline renders use the same
 * lead, so a file's clock and a note's start line up without guessing.
 */
export const RENDER_LEAD_SECONDS = 0.08

/**
 * Where every note sits on a rendered track's clock.
 *
 * The result is one entry per voice, in the same order as `sequences`, with
 * each note's start and end in seconds. Rests are kept: they occupy time and
 * the preview highlights them too. `index` is the index back into `seq.notes`.
 */
export function buildTimeline(sequences, tempo, lead = RENDER_LEAD_SECONDS) {
  const beat = 60 / tempo
  return (sequences || []).map((seq) => {
    let t = 0
    const notes = (seq.notes || []).map((note, index) => {
      const start = lead + t * beat
      const end = start + note.beats * beat
      t += note.beats
      return { index, midi: note.midi ?? null, start, end }
    })
    return { name: seq.name, notes }
  })
}

/**
 * The note each voice is on at `seconds`, plus the MIDI notes sounding.
 *
 * A voice between its first and last note always has a current index (a rest
 * is a note with no MIDI value). Before the lead-in and after the final note
 * there is no current note, so the index is -1.
 */
export function timelineAt(timeline, seconds) {
  const indexes = []
  const midi = new Set()
  for (const seq of timeline || []) {
    const notes = seq.notes || []
    let lo = 0
    let hi = notes.length - 1
    let found = -1
    while (lo <= hi) {
      const middle = (lo + hi) >> 1
      if (notes[middle].start <= seconds) {
        found = middle
        lo = middle + 1
      } else {
        hi = middle - 1
      }
    }
    if (found >= 0 && seconds < notes[found].end) {
      indexes.push(notes[found].index)
      if (notes[found].midi != null) midi.add(notes[found].midi)
    } else {
      indexes.push(-1)
    }
  }
  return { indexes, midi }
}

/** A short elapsed-time label: 0:07, 1:35, or 1:02:03 for very long pieces. */
export function formatClock(seconds) {
  const whole = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const secs = whole % 60
  if (hours) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`
}
