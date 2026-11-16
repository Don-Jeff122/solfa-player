import { validateSolfaSystems } from '../src/lib/scan/solfaValidation.js'
import { validateStaffScore } from '../src/lib/scan/staffConversion.js'

// Solfa transcription needs the strongest OCR. Keep the lite models last.
const SOLFA_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.6-flash',
  'gemini-3.7-flash',
  'gemini-3-flash-preview',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
]
const GENERAL_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3-flash-preview',
  'gemini-3.6-flash',
  'gemini-3.7-flash',
]
const RETRY_DELAY_MS = 350
const ATTEMPT_TIMEOUT_MS = 25000
const TOTAL_TIMEOUT_MS = 60000
const RATE_LIMIT_RETRY_AFTER = '10'
const BUSY_RETRY_AFTER = '5'
const TIMEOUT_RETRY_AFTER = '5'
const API_REVISION = '2026-05-20'
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions'
const MAX_BODY_BYTES = 10 * 1024 * 1024
const MAX_IMAGE_CHARS = 8_500_000
const DEFAULT_ORIGINS = [
  'https://don-jeff122.github.io',
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://127.0.0.1:4173',
  'http://localhost:4173',
]
const MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

const STAFF_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    composer: { type: 'string' },
    key: {
      type: 'object',
      properties: {
        fifths: { type: 'integer' },
        mode: { type: 'string', enum: ['major', 'minor'] },
        tonic: { type: 'string' },
      },
      required: ['fifths', 'mode', 'tonic'],
    },
    time: {
      type: 'object',
      properties: {
        beats: { type: 'integer' },
        beatType: { type: 'integer' },
      },
      required: ['beats', 'beatType'],
    },
    parts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          clef: { type: 'string' },
          measures: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                number: { type: 'string' },
                notes: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      pitch: {
                        type: 'object',
                        properties: {
                          step: { type: 'string', enum: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] },
                          alter: { type: 'integer' },
                          octave: { type: 'integer' },
                        },
                        required: ['step', 'alter', 'octave'],
                      },
                      rest: { type: 'boolean' },
                      duration: { type: 'number' },
                      voice: { type: 'string' },
                      tieStart: { type: 'boolean' },
                      tieStop: { type: 'boolean' },
                      confidence: { type: 'number' },
                    },
                    required: [
                      'pitch',
                      'rest',
                      'duration',
                      'voice',
                      'tieStart',
                      'tieStop',
                      'confidence',
                    ],
                  },
                },
              },
              required: ['number', 'notes'],
            },
          },
        },
        required: ['name', 'clef', 'measures'],
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'composer', 'key', 'time', 'parts', 'warnings'],
}

const SCHEMA = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['solfa', 'text', 'staff'] },
    notationType: { type: 'string', enum: ['solfa', 'staff', 'mixed', 'text'] },
    title: { type: 'string' },
    key: { type: 'string' },
    metre: { type: 'string' },
    composer: { type: 'string' },
    headerLines: { type: 'array', items: { type: 'string' } },
    systems: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rows: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                voice: { type: 'string', enum: ['S', 'A', 'T', 'B'] },
                cells: { type: 'array', items: { type: 'string' } },
              },
              required: ['voice', 'cells'],
            },
          },
          lyrics: { type: 'array', items: { type: 'string' } },
        },
        required: ['rows', 'lyrics'],
      },
    },
    plainText: { type: 'string' },
    staff: STAFF_SCHEMA,
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'mode',
    'notationType',
    'title',
    'key',
    'metre',
    'composer',
    'headerLines',
    'systems',
    'plainText',
    'warnings',
  ],
}

const SOLFA_PROMPT = `Transcribe this tonic solfa hymnal page. Return one JSON object matching the response schema.
Read only what is visible. Never invent notes, lyrics, headers or keys.
Set mode to "solfa" and notationType to "solfa" when the page contains printed tonic solfa notation.
Preserve the printed title, key, metre, composer and header lines exactly.
For each printed system, return its voice rows in printed order as S, A, T and B.
Split each row into cells at barlines. Each cell is one printed bar.
Cells must contain notation only. Never put lyric words, English text or labels in a cell.
Allowed notation is the printed solfa syllables (d r m f s l t, or do re mi fa sol la ti, plus de fe se le lo ta) with octave marks, rests (0), holds (-), slurs (_), dots (.) and printed beat markers (: and /) only.
Never use any other letter in a cell, especially not n, h or x. Do not put barlines, braces or pipes inside a cell.
Every voice row in one system should have the same number of cells; add a warning if a printed row is incomplete.
If a single note cannot be read, write 0 for that beat and add a warning naming the system and voice. Do not guess a note.
Keep printed lyrics in the system's lyrics array, not in cells. Put the complete page text in plainText.
If the page is not solfa, set mode to "text" and notationType to "text", then put the complete readable text in plainText.
Add a short warning for every uncertain row, key or lyric instead of guessing.`

const STAFF_PROMPT = `Read this page as staff notation and return the notes as structured JSON. Return one JSON object matching the response schema.
Set mode to "staff" and notationType to "staff". Put a short readable summary or any printed text in plainText.
Read the key signature and time signature. Set key.fifths from -7 to 7, key.mode to major or minor, and key.tonic to the printed key name.
Durations are in quarter-note beats: quarter = 1, eighth = 0.5, half = 2, dotted half = 3, whole = 4.
Return one part for each printed staff or voice. When four unnamed SATB staves are visible, name them Soprano, Alto, Tenor and Bass from top to bottom.
Return each printed bar as one measure. Keep rests, ties, slurs and voices exactly where printed.
For a chord, return only the highest note in that voice and add a warning naming the bar.
Set every note confidence from 0 to 1. Never invent a note: use a rest and a warning instead.
Add a short warning for an uncertain clef, key, time signature, voice, duration or note.`

const AUTO_PROMPT = `Read this hymn page and decide what notation it contains. Return one JSON object matching the response schema.
Set notationType to "solfa", "staff", "mixed" or "text".
If printed tonic solfa exists, set mode to "solfa" and transcribe it into systems exactly as the solfa instructions below describe. Set notationType to "solfa", or "mixed" when staff notation is also printed.
If there is staff notation but no printed tonic solfa, set mode to "staff", notationType to "staff", and return the notes in the staff object. Do not invent solfa syllables for visible staff notes.
If there is only readable prose, set mode to "text", notationType to "text", and put it in plainText.
Prefer printed tonic solfa when both forms are present; do not replace visible solfa with a new transcription.
Read only what is visible. Never invent notes, lyrics, headers or keys.
For solfa, return one row per printed voice in each system as S, A, T and B. Split rows into cells at barlines; cells contain notation only.
Allowed solfa notation is the printed syllables with octave marks, rests (0), holds (-), slurs (_), dots (.) and printed beat markers (: and /) only. Never use n, h or x in a cell.
For staff notes, durations are in quarter-note beats. Return one measure per printed bar and one part per printed staff or voice.
Set every staff note confidence from 0 to 1. For a chord, return only the highest note in that voice and add a warning.
Add a short warning for every uncertain row, note, key, metre or voice instead of guessing.`

const GENERAL_PROMPT = `Transcribe all readable text on this page in natural reading order. Return one JSON object matching the response schema.
Set mode to "text" and notationType to "text". Put the complete transcription in plainText.
Preserve line breaks, headings, punctuation, symbols and wording. Do not normalise, summarise or invent text.
Leave systems empty. Add a short warning for anything uncertain instead of guessing.`

function promptForMode(mode) {
  if (mode === 'staff') return STAFF_PROMPT
  if (mode === 'auto') return AUTO_PROMPT
  if (mode === 'solfa') return SOLFA_PROMPT
  return GENERAL_PROMPT
}

function modelsForMode(mode) {
  return mode === 'general' ? GENERAL_MODELS : SOLFA_MODELS
}

export function buildGeminiRequest(mode, data, mimeType) {
  return {
    model: modelsForMode(mode)[0],
    input: [
      { type: 'text', text: promptForMode(mode) },
      { type: 'image', data, mime_type: mimeType, resolution: 'high' },
    ],
    response_format: {
      type: 'text',
      mime_type: 'application/json',
      schema: SCHEMA,
    },
    generation_config: {
      thinking_level: 'low',
      temperature: 0,
    },
  }
}

function collectText(value, depth = 0) {
  if (value == null || depth > 6) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.map((entry) => collectText(entry, depth + 1)).filter(Boolean).join('')
  }
  if (typeof value !== 'object') return ''
  if (typeof value.text === 'string') return value.text
  if (typeof value.output_text === 'string') return value.output_text
  for (const key of ['outputs', 'steps', 'content', 'parts']) {
    if (value[key] == null) continue
    const text = collectText(value[key], depth + 1)
    if (text) return text
  }
  return ''
}

export function extractOutputText(payload) {
  if (!payload || typeof payload !== 'object') return ''
  if (payload.output_text != null) {
    const text = collectText(payload.output_text)
    if (text) return text
  }
  if (payload.outputText != null) {
    const text = collectText(payload.outputText)
    if (text) return text
  }
  return collectText(payload.outputs ?? payload.steps ?? payload.output ?? '')
}

function parseGeminiJson(text) {
  const value = String(text || '').trim()
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (!fenced) return null
    try {
      return JSON.parse(fenced[1].trim())
    } catch {
      return null
    }
  }
}

function validateGeminiOutput(mode, output) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return { ok: false, error: 'Gemini returned an unreadable result.' }
  }
  if (!['solfa', 'text', 'staff'].includes(output.mode)) {
    return { ok: false, error: 'Gemini did not return a readable page mode.' }
  }
  if (mode === 'general') {
    return String(output.plainText || '').trim()
      ? { ok: true }
      : { ok: false, error: 'Gemini returned no page text.' }
  }
  const staffPage = output.mode === 'staff' || output.notationType === 'staff'
  if (staffPage) {
    if (mode === 'solfa') {
      return { ok: false, error: 'Gemini found staff notation, not printed solfa.' }
    }
    const checked = validateStaffScore(output.staff)
    return checked.ok
      ? { ok: true }
      : { ok: false, error: checked.error, structured: true }
  }
  if (mode === 'staff') {
    return { ok: false, error: 'Gemini found no readable staff notation.' }
  }
  if (output.mode === 'text' || output.notationType === 'text') {
    return String(output.plainText || '').trim()
      ? { ok: true }
      : { ok: false, error: 'Gemini returned no page text.' }
  }
  const checked = validateSolfaSystems(output.systems)
  return checked.ok
    ? { ok: true }
    : { ok: false, error: checked.error, structured: true }
}

function allowedOrigins(env) {
  const configured = env?.ALLOWED_ORIGINS
  if (typeof configured === 'string' && configured.trim()) {
    return configured
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
  }
  return DEFAULT_ORIGINS
}

function corsHeaders(origin, _env) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Expose-Headers': 'Retry-After',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function jsonResponse(body, status, origin, env, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin, env),
      ...extraHeaders,
    },
  })
}

function positiveNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function timeoutSettings(env) {
  return {
    attempt: positiveNumber(env?.GEMINI_ATTEMPT_TIMEOUT_MS, ATTEMPT_TIMEOUT_MS),
    total: positiveNumber(env?.GEMINI_TOTAL_TIMEOUT_MS, TOTAL_TIMEOUT_MS),
  }
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController()
  let timer = 0
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve({ timedOut: true })
    }, timeoutMs)
  })
  const request = Promise.resolve()
    .then(() => fetchImpl(url, { ...init, signal: controller.signal }))
    .then((response) => ({ response }))
    .catch((reason) => ({ reason }))
  const outcome = await Promise.race([request, timeout])
  clearTimeout(timer)
  if (outcome.timedOut) return { timedOut: true }
  if (outcome.reason) throw outcome.reason
  return { response: outcome.response }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function rejectedOrigin() {
  return new Response(JSON.stringify({ error: 'Origin not allowed.' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function handleRequest(request, env = {}, fetchImpl = fetch) {
  const origin = request.headers.get('Origin') || ''
  if (!allowedOrigins(env).includes(origin)) return rejectedOrigin()

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin, env) })
  }
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405, origin, env)
  }
  if (!(request.headers.get('Content-Type') || '').toLowerCase().startsWith('application/json')) {
    return jsonResponse({ error: 'Send JSON with Content-Type: application/json.' }, 415, origin, env)
  }

  const declaredLength = Number(request.headers.get('Content-Length') || 0)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return jsonResponse({ error: 'The page image is too large.' }, 413, origin, env)
  }

  let body
  try {
    const raw = await request.text()
    if (raw.length > MAX_BODY_BYTES) {
      return jsonResponse({ error: 'The page image is too large.' }, 413, origin, env)
    }
    body = JSON.parse(raw)
  } catch {
    return jsonResponse({ error: 'The request body is not valid JSON.' }, 400, origin, env)
  }

  const mode = body?.mode
  if (!['auto', 'solfa', 'staff', 'general'].includes(mode)) {
    return jsonResponse(
      { error: 'Choose automatic, solfa, staff or general mode.' },
      400,
      origin,
      env
    )
  }

  const mimeType = String(body?.image?.mimeType || '').toLowerCase()
  if (!MIME_TYPES.has(mimeType)) {
    return jsonResponse({ error: 'Send a PNG, JPEG or WebP page image.' }, 415, origin, env)
  }

  const data = String(body?.image?.data || '').replace(/^data:[^;]+;base64,/, '')
  if (!data) {
    return jsonResponse({ error: 'The page image is missing.' }, 400, origin, env)
  }
  if (data.length > MAX_IMAGE_CHARS) {
    return jsonResponse({ error: 'The page image is too large.' }, 413, origin, env)
  }

  if (!env?.GEMINI_API_KEY) {
    return jsonResponse({ error: 'Gemini is not configured on the proxy.' }, 500, origin, env)
  }

  const models = modelsForMode(mode)
  const timeouts = timeoutSettings(env)
  const deadline = Date.now() + timeouts.total
  let lastStatus = 0
  let sawUpstream = false
  let sawUnreadable = false
  let sawTimeout = false
  let bestEffort = null

  for (let attempt = 0; attempt < models.length; attempt += 1) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      sawTimeout = true
      break
    }

    const model = models[attempt]
    let upstream = null
    try {
      const result = await fetchWithTimeout(
        fetchImpl,
        GEMINI_URL,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': env.GEMINI_API_KEY,
            'Api-Revision': API_REVISION,
          },
          body: JSON.stringify({ ...buildGeminiRequest(mode, data, mimeType), model }),
        },
        Math.min(timeouts.attempt, remaining)
      )
      if (result.timedOut) {
        sawTimeout = true
      } else {
        upstream = result.response
      }
    } catch {
      upstream = null
    }

    if (upstream) {
      sawUpstream = true
      lastStatus = upstream.status
      if (upstream.ok) {
        let upstreamText = ''
        try {
          upstreamText = await upstream.text()
        } catch {
          upstreamText = ''
        }
        let payload = null
        try {
          payload = JSON.parse(upstreamText)
        } catch {
          payload = null
        }

        const output = parseGeminiJson(extractOutputText(payload))
        const checked = validateGeminiOutput(mode, output)
        if (checked.ok) {
          return jsonResponse({ data: output }, 200, origin, env)
        }

        sawUnreadable = true
        if (
          mode === 'solfa' &&
          output?.mode === 'solfa' &&
          Array.isArray(output.systems) &&
          output.systems.length
        ) {
          bestEffort = output
        }
      } else if (upstream.status !== 429 && upstream.status !== 503) {
        break
      }
    }

    if (attempt < models.length - 1) {
      const wait = Math.min(RETRY_DELAY_MS, Math.max(0, deadline - Date.now()))
      if (wait <= 0) {
        sawTimeout = true
        break
      }
      await sleep(wait)
    }
  }

  if (bestEffort) {
    const warnings = Array.isArray(bestEffort.warnings)
      ? bestEffort.warnings.filter((warning) => typeof warning === 'string')
      : []
    const warning =
      'Gemini could not produce a fully valid solfa sheet. Check the marked rows before playing.'
    return jsonResponse(
      { data: { ...bestEffort, warnings: [...warnings, warning] } },
      200,
      origin,
      env
    )
  }

  if (!sawUpstream && sawTimeout) {
    return jsonResponse(
      { error: 'Gemini took too long to respond. Try again.' },
      504,
      origin,
      env,
      { 'Retry-After': TIMEOUT_RETRY_AFTER }
    )
  }

  if (!sawUpstream) {
    return jsonResponse({ error: 'The Gemini service could not be reached.' }, 502, origin, env)
  }

  const rateLimited = lastStatus === 429
  const busy = lastStatus === 503
  const timedOut = lastStatus === 0 && sawTimeout
  const status =
    lastStatus === 429
      ? 429
      : lastStatus === 503
        ? 503
        : timedOut
          ? 504
          : lastStatus === 400 && !sawUnreadable
            ? 400
            : 502
  const extraHeaders = rateLimited
    ? { 'Retry-After': RATE_LIMIT_RETRY_AFTER }
    : busy
      ? { 'Retry-After': BUSY_RETRY_AFTER }
      : timedOut
        ? { 'Retry-After': TIMEOUT_RETRY_AFTER }
        : {}
  return jsonResponse(
    {
      error: rateLimited
        ? 'Gemini request limit reached. Try again later.'
        : busy
          ? 'Gemini is busy. Try again in a moment.'
          : timedOut
            ? 'Gemini took too long to respond. Try again.'
            : sawUnreadable
              ? 'Gemini returned an unreadable result.'
              : 'Gemini could not read this page. Try again.',
    },
    status,
    origin,
    env,
    extraHeaders
  )
}

export default {
  async fetch(request, env) {
    return handleRequest(request, env)
  },
}
