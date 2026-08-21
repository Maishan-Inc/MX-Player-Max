import { describe, expect, it } from 'vitest'
import {
  DEMO_COPY,
  DEMO_LANGUAGES,
  detectDemoLocale,
  format,
  isDemoLocale,
  matchDemoLocale,
  type DemoCopy,
  type DemoLocale,
} from './i18n'

const LOCALES: readonly DemoLocale[] = ['zh-CN', 'zh-TW', 'en', 'ja']

function collectStrings(value: unknown, path: string, sink: [string, string][]): void {
  if (typeof value === 'string') { sink.push([path, value]); return }
  if (Array.isArray(value)) { value.forEach((entry, index) => collectStrings(entry, `${path}[${index}]`, sink)); return }
  if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) collectStrings(entry, `${path}.${key}`, sink)
  }
}

function stringPaths(copy: DemoCopy): string[] {
  const sink: [string, string][] = []
  collectStrings(copy, '', sink)
  return sink.map(([path]) => path).sort()
}

describe('Demo locale packs', () => {
  it('ships one pack per advertised language', () => {
    expect(DEMO_LANGUAGES.map((language) => language.code)).toEqual(LOCALES)
    for (const locale of LOCALES) expect(DEMO_COPY[locale]).toBeDefined()
  })

  it('keeps every pack structurally identical so no locale falls back mid-page', () => {
    const reference = stringPaths(DEMO_COPY['zh-CN'])
    expect(reference.length).toBeGreaterThan(100)
    for (const locale of LOCALES) expect(stringPaths(DEMO_COPY[locale])).toEqual(reference)
  })

  it('leaves no empty string and no untranslated placeholder token', () => {
    for (const locale of LOCALES) {
      const sink: [string, string][] = []
      collectStrings(DEMO_COPY[locale], locale, sink)
      for (const [path, value] of sink) {
        expect(value.trim().length, path).toBeGreaterThan(0)
        expect(value.includes('TODO'), path).toBe(false)
      }
    }
  })

  it('carries the interpolation placeholders every pack is read with', () => {
    for (const locale of LOCALES) {
      expect(DEMO_COPY[locale].player.subtitleAttached).toContain('{name}')
      expect(DEMO_COPY[locale].integration.note).toContain('{version}')
      expect(DEMO_COPY[locale].footer.license).toContain('{version}')
    }
  })

  it('keeps section item counts aligned with the layout', () => {
    for (const locale of LOCALES) {
      const copy = DEMO_COPY[locale]
      expect(copy.features).toHaveLength(6)
      expect(copy.why.reasons).toHaveLength(4)
      expect(copy.how.steps.map((step) => step.step)).toEqual(['01', '02', '03', '04'])
      expect(copy.faq.items.length).toBeGreaterThanOrEqual(8)
      const titles = [...copy.features, ...copy.why.reasons, ...copy.how.steps].map((item) => item.title)
      expect(new Set(titles).size).toBe(titles.length)
      const questions = copy.faq.items.map((item) => item.q)
      expect(new Set(questions).size).toBe(questions.length)
    }
  })
})

describe('Demo locale negotiation', () => {
  it('maps script and region subtags onto the shipped packs', () => {
    expect(matchDemoLocale('zh')).toBe('zh-CN')
    expect(matchDemoLocale('zh-Hans-CN')).toBe('zh-CN')
    expect(matchDemoLocale('zh-Hant')).toBe('zh-TW')
    expect(matchDemoLocale('zh-HK')).toBe('zh-TW')
    expect(matchDemoLocale('ja-JP')).toBe('ja')
    expect(matchDemoLocale('en-GB')).toBe('en')
    expect(matchDemoLocale('fr-FR')).toBeNull()
    expect(matchDemoLocale('')).toBeNull()
    expect(matchDemoLocale(undefined)).toBeNull()
  })

  it('prefers a stored choice, then the browser order, then Simplified Chinese', () => {
    expect(detectDemoLocale('ja', ['en-US'])).toBe('ja')
    expect(detectDemoLocale('de', ['en-US'])).toBe('en')
    expect(detectDemoLocale(null, ['fr-FR', 'zh-TW'])).toBe('zh-TW')
    expect(detectDemoLocale(null, ['fr-FR'])).toBe('zh-CN')
    expect(isDemoLocale('zh-TW')).toBe(true)
    expect(isDemoLocale('pt-BR')).toBe(false)
  })

  it('substitutes known placeholders and keeps unknown ones visible', () => {
    expect(format('build {version} ok', { version: '1.2.3' })).toBe('build 1.2.3 ok')
    expect(format('{missing} stays', {})).toBe('{missing} stays')
  })
})
