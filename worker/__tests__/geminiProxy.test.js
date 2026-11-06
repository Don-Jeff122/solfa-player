import { describe, expect, it } from 'vitest'
import {
  buildGeminiRequest,
  extractOutputText,
  handleRequest,
} from '../gemini-proxy.js'

const origin = 'https://don-jeff122.github.io'
const env = {
  GEMINI_API_KEY: 'test-secret-key',
  ALLOWED_ORIGINS: origin,
}
const result = {
  mode: 'text',
  title: '',
  key: '',
  metre: '',
  composer: '',
  headerLines: [],
  systems: [],
  plainText: 'Praise the Lord',
  warnings: [],
}
const solfaResult = {
  mode: 'solfa',
  title: 'Nun Danket',
  key: 'F',
  metre: '',
  composer: '',
  headerLines: [],
  systems: [
    {
      rows: [
        { voice: 'S', cells: ['d :d | r :r'] },
        { voice: 'A', cells: ['s :s | l :l'] },
        { voice: 'T', cells: ['m :m | f :f'] },
        { voice: 'B', cells: ['d :d | d :d'] },
      ],
      lyrics: [],
    },
  ],
  plainText: '',
  warnings: [],
}
const invalidSolfaResult = {
  ...solfaResult,
  systems: [
    {
      rows: [
        { voice: 'S', cells: ['d :d | r :r'] },
        { voice: 'A', cells: ['s :s | l :l'] },
        { voice: 'T', cells: ['m :m | f :f'] },
        { voice: 'B', cells: ['d :d | n :n'] },
      ],
      lyrics: [],
    },
  ],
}

function request(body, overrides = {}) {
  return new Request('https://proxy.test/', {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      ...overrides,
    },
    body: JSON.stringify(body),
  })
}

function pageBody(overrides = {}) {
  return {
    mode: 'general',
    image: { data: 'cGFnZQ==', mimeType: 'image/jpeg' },
    ...overrides,
  }
}

describe('Gemini proxy request', () => {
  it('puts the prompt before the inline image and requests structured text', () => {
    const built = buildGeminiRequest('solfa', 'cGFnZQ==', 'image/jpeg')

    expect(built.model).toBe('gemini-3.8-flash')
    expect(built.input[0].type).toBe('text')
    expect(built.input[1]).toEqual({
      type: 'image',
      data: 'cGFnZQ==',
      mime_type: 'image/jpeg',
      resolution: 'high',
    })
    expect(built.response_format.type).toBe('text')
    expect(built.response_format.mime_type).toBe('application/json')
    expect(built.response_format.schema.required).toContain('systems')
    expect(built.generation_config.thinking_level).toBe('low')
  })

  it('forbids invented letters in solfa cells', () => {
    const built = buildGeminiRequest('solfa', 'cGFnZQ==', 'image/jpeg')
    const prompt = built.input[0].text

    expect(prompt).toMatch(/Never use any other letter/)
    expect(prompt).toContain('not n')
    expect(prompt).toMatch(/lyrics array, not in cells/)
  })

  it('extracts text from the current interaction response shapes', () => {
    expect(extractOutputText({ output_text: '{"ok":true}' })).toBe('{"ok":true}')
    expect(
      extractOutputText({ output_text: [{ type: 'text', text: '{"ok":true}' }] })
    ).toBe('{"ok":true}')
    expect(
      extractOutputText({
        output_text: '',
        steps: [{ content: [{ type: 'text', text: '{"ok":true}' }] }],
      })
    ).toBe('{"ok":true}')
  })
})

describe('Gemini proxy handler', () => {
  it('returns a structured result for an allowed request', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ output_text: JSON.stringify(result) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    const response = await handleRequest(request(pageBody()), env, fetchImpl)

    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin)
    expect(await response.json()).toEqual({ data: result })
  })

  it('answers the CORS preflight for an allowed origin', async () => {
    const response = await handleRequest(
      new Request('https://proxy.test/', {
        method: 'OPTIONS',
        headers: { Origin: origin },
      }),
      env
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin)
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST')
  })

  it('rejects a foreign origin', async () => {
    const response = await handleRequest(
      request(pageBody(), { Origin: 'https://example.com' }),
      env
    )

    expect(response.status).toBe(403)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('rejects an unknown mode and a missing key', async () => {
    const badMode = await handleRequest(request(pageBody({ mode: 'other' })), env)
    expect(badMode.status).toBe(400)

    const noKey = await handleRequest(request(pageBody()), {
      ALLOWED_ORIGINS: origin,
    })
    expect(noKey.status).toBe(500)
  })

  it('falls back to the next available model when the primary is busy', async () => {
    const models = []
    const fetchImpl = async (_url, options) => {
      const body = JSON.parse(options.body)
      models.push(body.model)
      if (body.model === 'gemini-3.8-flash') {
        return new Response(JSON.stringify({ error: { message: 'high demand' } }), {
          status: 503,
        })
      }
      return new Response(JSON.stringify({ output_text: JSON.stringify(result) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const response = await handleRequest(request(pageBody()), env, fetchImpl)

    expect(response.status).toBe(200)
    expect(models).toEqual(['gemini-3.8-flash', 'gemini-3.5-flash-lite'])
  })

  it('continues through the fallback list when models are rate limited', async () => {
    const models = []
    const fetchImpl = async (_url, options) => {
      const body = JSON.parse(options.body)
      models.push(body.model)
      if (body.model === 'gemini-3.1-flash-lite') {
        return new Response(JSON.stringify({ output_text: JSON.stringify(result) }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ error: { message: 'rate limit' } }), {
        status: 429,
      })
    }

    const response = await handleRequest(request(pageBody()), env, fetchImpl)

    expect(response.status).toBe(200)
    expect(models).toEqual([
      'gemini-3.8-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
    ])
  })

  it('tries the next solfa model when the notation is invalid', async () => {
    const models = []
    const fetchImpl = async (_url, options) => {
      const body = JSON.parse(options.body)
      models.push(body.model)
      const output = body.model === 'gemini-3.8-flash' ? invalidSolfaResult : solfaResult
      return new Response(JSON.stringify({ output_text: JSON.stringify(output) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const response = await handleRequest(
      request(pageBody({ mode: 'solfa' })),
      env,
      fetchImpl
    )

    expect(response.status).toBe(200)
    expect(models).toEqual(['gemini-3.8-flash', 'gemini-3.6-flash'])
    expect((await response.json()).data).toEqual(solfaResult)
  })

  it('returns an editable solfa sheet with a warning when every model is invalid', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ output_text: JSON.stringify(invalidSolfaResult) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })

    const response = await handleRequest(
      request(pageBody({ mode: 'solfa' })),
      env,
      fetchImpl
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.data.systems).toHaveLength(1)
    expect(payload.data.warnings.join(' ')).toMatch(/fully valid solfa sheet/)
    expect(payload.data.warnings.join(' ')).toMatch(/Check the marked rows/)
  })

  it('accepts a text page from a solfa request without retrying', async () => {
    const models = []
    const fetchImpl = async (_url, options) => {
      const body = JSON.parse(options.body)
      models.push(body.model)
      return new Response(JSON.stringify({ output_text: JSON.stringify(result) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const response = await handleRequest(
      request(pageBody({ mode: 'solfa' })),
      env,
      fetchImpl
    )

    expect(response.status).toBe(200)
    expect(models).toEqual(['gemini-3.8-flash'])
    expect((await response.json()).data.mode).toBe('text')
  })

  it('reports a busy Gemini after retries are exhausted', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ error: { message: 'high demand' } }), { status: 503 })
    const response = await handleRequest(request(pageBody()), env, fetchImpl)

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: 'Gemini is busy. Try again in a moment.',
    })
  })

  it('reports a rate limit after retries are exhausted', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ error: { message: 'rate limit' } }), { status: 429 })
    const response = await handleRequest(request(pageBody()), env, fetchImpl)

    expect(response.status).toBe(429)
    expect(await response.json()).toEqual({
      error: 'Gemini request limit reached. Try again later.',
    })
  })

  it('does not leak the API key when Gemini fails', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ error: { message: 'bad request' } }), {
        status: 500,
      })
    const response = await handleRequest(request(pageBody()), env, fetchImpl)
    const text = await response.text()

    expect(response.status).toBe(502)
    expect(text).not.toContain(env.GEMINI_API_KEY)
    expect(text).not.toContain('bad request')
  })
})
