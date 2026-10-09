import { createWorker } from 'tesseract.js'

const started = Date.now()
try {
  const worker = await createWorker('eng', 1, {
    logger: (m) => {
      if (m.status) process.stdout.write(`[${m.status}] `)
    },
  })
  console.log('\nworker created OK in', Date.now() - started, 'ms')
  console.log('recognize available:', typeof worker.recognize === 'function')
  await worker.terminate()
  console.log('worker terminated cleanly')
} catch (e) {
  console.log('\nFAILED:', e?.message || e)
  process.exitCode = 1
}
