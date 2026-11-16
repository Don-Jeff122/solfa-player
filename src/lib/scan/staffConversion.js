import { parseSolfa } from '../parseSolfa.js'
import { normalizeStaffScore } from '../music/staffScore.js'
import { convertScoreToSolfa } from '../music/tonicSolfa.js'

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

export function validateStaffScore(raw, options = {}) {
  const normalized = normalizeStaffScore(raw, options)
  if (!normalized.ok) return normalized
  const conversion = convertScoreToSolfa(normalized.score, options)
  if (!conversion.ok) return conversion
  const parsed = parseSolfa(conversion.text)
  if (!parsed.ok) {
    return {
      ok: false,
      error: parsed.error?.message || 'The converted staff notation could not be read.',
      score: normalized.score,
      conversion,
      warnings: normalized.warnings,
      uncertain: normalized.uncertain,
      structured: true,
    }
  }
  return {
    ok: true,
    score: normalized.score,
    conversion,
    parsed,
    warnings: unique([...(normalized.warnings || []), ...(conversion.warnings || [])]),
    uncertain: normalized.uncertain || [],
  }
}

function sourceKind(source) {
  if (source === 'musicxml') return 'musicxml'
  return 'gemini-staff'
}

function sourceWarning(source) {
  if (source === 'musicxml') {
    return 'Converted locally from the MusicXML score. Check the key, rhythm and voices against the original before playing.'
  }
  return 'Read by Gemini from the page image and converted to tonic solfa. Check every note, key, rhythm and voice against the original.'
}

export function createStaffPage(pageNumber, raw, { source = 'gemini', options = {}, title = '' } = {}) {
  const checked = validateStaffScore(raw, options)
  if (!checked.ok) {
    return {
      ok: false,
      error: checked.error || 'The staff notation could not be converted.',
    }
  }
  const { score, conversion, parsed, warnings, uncertain } = checked
  const allWarnings = unique([...warnings, sourceWarning(source)])
  const parseError = parsed.ok ? null : 'The converted staff notation could not be read.'
  if (parseError) allWarnings.push(`Check the notes: ${parseError}`)
  const pageTitle = score.title || title
  const page = {
    pageNumber,
    index: pageNumber - 1,
    exactText: pageTitle || conversion.text,
    title: pageTitle,
    composer: score.composer || '',
    sheetText: conversion.text,
    sheetHeaderLines: conversion.headerLines,
    sourceKind: sourceKind(source),
    notationType: 'staff',
    mode: 'hymnal',
    key: conversion.key,
    displayKey: conversion.displayKey,
    sourceScore: score,
    conversion: {
      tonic: conversion.tonic,
      mode: conversion.mode,
      fifths: conversion.fifths,
      key: conversion.key,
      displayKey: conversion.displayKey,
      source,
    },
    uncertain,
    uncertainCount: uncertain.length,
    playable: {
      mode: 'hymnal',
      ok: true,
      text: conversion.text,
      sheetText: conversion.text,
      sheetHeaderLines: conversion.headerLines,
      key: conversion.key,
      warnings: allWarnings,
      systemsData: conversion.systems,
      rows: conversion.rows,
      bars: conversion.bars,
      parseError,
      error: parseError,
      notationType: 'staff',
      sourceKind: sourceKind(source),
      conversion: {
        tonic: conversion.tonic,
        mode: conversion.mode,
        fifths: conversion.fifths,
        key: conversion.key,
        displayKey: conversion.displayKey,
      },
    },
    warnings: allWarnings,
    ok: true,
    error: null,
  }
  return { ok: true, page }
}

export function reconvertStaffPage(page, options = {}) {
  if (!page?.sourceScore) {
    return { ok: false, error: 'This page does not keep its original staff notes.' }
  }
  const source = page.sourceKind === 'musicxml' ? 'musicxml' : 'gemini'
  return createStaffPage(page.pageNumber, page.sourceScore, {
    source,
    options,
    title: page.title || '',
  })
}

export function createMusicXmlPage(pageNumber, score, { name = '' } = {}) {
  return createStaffPage(pageNumber, score, { source: 'musicxml', title: name })
}
