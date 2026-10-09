const barLength = (bar) => bar.notes.reduce((s, n) => s + n.beats, 0)

/**
 * Expands a part's bars into the order a performer plays them.
 *
 * Simple repeats and voltas are the only structure supported:
 *   |: A | B :|            ->  A B A B
 *   |: A B | 1. C :| 2. D  ->  A B C  A D
 *
 * The close bar plays on pass 1 (it is usually the "1." ending) and is skipped
 * on pass 2, while the "2." bars that follow the close play naturally on the
 * second trip. Bars with no ending label play on every pass. The same bar
 * object is reused, so a repeated section costs nothing to schedule twice.
 *
 * Returns the flattened notes plus, for a metronome, the starting beat offset
 * of every expanded bar.
 */
export function expandBars(part) {
  const bars = part.bars || []
  if (!bars.length) {
    return { notes: [...part.notes], order: [], barStarts: [] }
  }

  const regions = []
  const stack = []
  for (let i = 0; i < bars.length; i++) {
    if (bars[i].openRepeat) stack.push(i)
    if (bars[i].closeRepeat) {
      const open = stack.length ? stack.pop() : 0
      regions.push({ open, close: i })
    }
  }

  const order = []
  let i = 0
  while (i < bars.length) {
    const region = regions.find((r) => r.open === i)
    if (!region) {
      order.push(i)
      i++
      continue
    }
    const firstPass = []
    const secondPass = []
    for (let j = region.open; j <= region.close; j++) {
      if (!bars[j].endings.includes(2)) firstPass.push(j)
      if (!bars[j].endings.includes(1)) secondPass.push(j)
    }
    order.push(...firstPass, ...secondPass)
    i = region.close + 1
  }

  const notes = order.flatMap((barIdx) => bars[barIdx].notes)
  const barStarts = []
  let beats = 0
  for (const barIdx of order) {
    barStarts.push(beats)
    beats += barLength(bars[barIdx])
  }
  return { notes, order, barStarts }
}