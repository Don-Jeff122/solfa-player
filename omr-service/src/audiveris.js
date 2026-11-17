import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { OmrError } from './errors.js'
import { extractMusicXml } from './mxl.js'

export const AUDIVERIS_STEPS = [
  'LOAD',
  'BINARY',
  'SCALE',
  'GRID',
  'HEADERS',
  'STEM_SEEDS',
  'BEAMS',
  'LEDGERS',
  'HEADS',
  'STEMS',
  'REDUCTION',
  'CUE_BEAMS',
  'TEXTS',
  'MEASURES',
  'CHORDS',
  'CURVES',
  'SYMBOLS',
  'LINKS',
  'RHYTHMS',
  'PAGE',
]

const MAX_LOG_CHARS = 160_000

export function resolveAudiverisBin({
  env = process.env,
  platform = process.platform,
  existsSync = fs.existsSync,
} = {}) {
  if (env.AUDIVERIS_BIN) return env.AUDIVERIS_BIN

  const candidates =
    platform === 'win32'
      ? [
          path.join(env.ProgramFiles || 'C:\\Program Files', 'Audiveris', 'Audiveris.exe'),
          path.join(
            env.LOCALAPPDATA || path.join(env.USERPROFILE || '', 'AppData', 'Local'),
            'Programs',
            'Audiveris',
            'Audiveris.exe'
          ),
          'C:\\Program Files\\Audiveris\\Audiveris.exe',
        ]
      : ['/opt/audiveris/bin/Audiveris', '/usr/bin/audiveris']

  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate
    } catch {
      /* keep looking */
    }
  }

  return platform === 'win32' ? 'Audiveris.exe' : 'Audiveris'
}

export function isAudiverisAvailable(
  bin,
  { env = process.env, platform = process.platform, existsSync = fs.existsSync } = {}
) {
  if (!bin) return false
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  const hasPath = pathApi.isAbsolute(bin) || /[\\/]/.test(bin)
  if (hasPath) {
    try {
      return existsSync(bin)
    } catch {
      return false
    }
  }

  const directories = String(env.PATH || env.Path || '')
    .split(platform === 'win32' ? ';' : ':')
    .filter(Boolean)
  const extensions =
    platform === 'win32' ? String(env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean) : ['']
  const hasExtension = Boolean(pathApi.extname(bin))
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = pathApi.join(directory, hasExtension ? bin : `${bin}${extension}`)
      try {
        if (existsSync(candidate)) return true
      } catch {
        /* keep looking */
      }
    }
  }
  return false
}

export function parseAudiverisLine(line) {
  const stepMatch = String(line).match(new RegExp(`\\b(${AUDIVERIS_STEPS.join('|')})\\b`))
  if (!stepMatch) return null
  const sheetMatch = String(line).match(/sheet\s*#?\s*(\d+)/i)
  return {
    step: stepMatch[1],
    stepIndex: AUDIVERIS_STEPS.indexOf(stepMatch[1]),
    totalSteps: AUDIVERIS_STEPS.length,
    sheet: sheetMatch ? Number(sheetMatch[1]) : null,
    line: String(line).trim(),
  }
}

export function buildAudiverisArgs({ inputPath, outputDir }) {
  return [
    '-batch',
    '-transcribe',
    '-export',
    '-swap',
    '-constant',
    'org.audiveris.omr.sheet.BookManager.useCompression=false',
    '-output',
    outputDir,
    '--',
    inputPath,
  ]
}

function stopProcess(child, platform = process.platform) {
  if (!child || child.killed) return
  if (platform === 'win32' && child.pid) {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    })
    killer.on('error', () => {
      try {
        child.kill()
      } catch {
        /* already gone */
      }
    })
    return
  }
  try {
    child.kill('SIGTERM')
  } catch {
    /* already gone */
  }
}

export function runAudiveris({
  bin,
  inputPath,
  outputDir,
  timeoutMs = 10 * 60 * 1000,
  onLog = () => {},
  onStep = () => {},
  spawnImpl = spawn,
  platform = process.platform,
}) {
  const args = buildAudiverisArgs({ inputPath, outputDir })
  return new Promise((resolve, reject) => {
    let child
    let settled = false
    let timedOut = false
    let logs = ''
    let timer = null

    const finish = (fn, value) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      fn(value)
    }

    try {
      child = spawnImpl(bin, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      reject(
        new OmrError('AUDIVERIS_NOT_FOUND', 'Audiveris could not be started.', {
          detail: `${bin}: ${error.message}`,
          retryable: false,
        })
      )
      return
    }

    const consume = (chunk) => {
      const text = String(chunk)
      logs = (logs + text).slice(-MAX_LOG_CHARS)
      const lines = text.split(/\r?\n/)
      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line) continue
        onLog(line)
        const parsed = parseAudiverisLine(line)
        if (parsed) onStep(parsed)
      }
    }

    child.stdout?.on('data', consume)
    child.stderr?.on('data', consume)
    child.on('error', (error) => {
      if (error?.code === 'ENOENT') {
        finish(
          reject,
          new OmrError(
            'AUDIVERIS_NOT_FOUND',
            'Audiveris is not installed or AUDIVERIS_BIN is wrong.',
            {
              detail: `${bin}: ${error.message}`,
              retryable: false,
            }
          )
        )
        return
      }
      finish(
        reject,
        new OmrError('AUDIVERIS_FAILED', 'Audiveris could not be started.', {
          detail: error?.message || String(error),
          retryable: true,
        })
      )
    })

    child.on('close', (code, signal) => {
      if (timedOut) {
        finish(
          reject,
          new OmrError('AUDIVERIS_TIMEOUT', 'Audiveris took too long to process this PDF.', {
            detail: `Stopped after ${Math.round(timeoutMs / 1000)} seconds.\n${logs.slice(-4000)}`,
            retryable: true,
          })
        )
        return
      }
      if (code === 0) {
        finish(resolve, { logs })
        return
      }
      finish(
        reject,
        new OmrError('AUDIVERIS_FAILED', 'Audiveris could not transcribe this score.', {
          detail:
            `Audiveris exited with ${code == null ? `signal ${signal}` : `code ${code}`}.` +
            (logs ? `\n${logs.slice(-4000)}` : ''),
          retryable: true,
        })
      )
    })

    timer = setTimeout(() => {
      timedOut = true
      stopProcess(child, platform)
    }, timeoutMs)
  })
}

async function findFiles(directory, extensions, depth = 0) {
  if (depth > 5) return []
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }
  const found = []
  for (const entry of entries) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      found.push(...(await findFiles(full, extensions, depth + 1)))
    } else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
      found.push(full)
    }
  }
  return found
}

export async function findMusicXmlOutputs(outputDir) {
  return findFiles(outputDir, new Set(['.xml', '.musicxml', '.mxl']))
}

export async function readMusicXmlResult(outputDir) {
  const files = await findMusicXmlOutputs(outputDir)
  if (!files.length) {
    throw new OmrError('MUSICXML_MISSING', 'Audiveris did not produce a MusicXML file.', {
      detail: `No .xml, .musicxml or .mxl output was found in ${outputDir}.`,
      retryable: true,
    })
  }

  const groups = new Map()
  for (const file of files) {
    const base = path.basename(file).replace(/\.(xml|musicxml|mxl)$/i, '').toLowerCase()
    const group = groups.get(base) || []
    group.push(file)
    groups.set(base, group)
  }

  if (groups.size > 1) {
    throw new OmrError(
      'MULTIPLE_MUSICXML',
      'Audiveris produced more than one score. This module expects one movement per PDF.',
      {
        detail: files.map((file) => path.basename(file)).join(', '),
        retryable: false,
      }
    )
  }

  const [group] = [...groups.values()]
  const preferred =
    group.find((file) => /\.(xml|musicxml)$/i.test(file)) ||
    group.find((file) => /\.mxl$/i.test(file))

  const bytes = await readFile(preferred)
  const xml = extractMusicXml(bytes)
  return {
    xml,
    sourceName: path.basename(preferred),
  }
}
