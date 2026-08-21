import { describe, expect, it } from 'vitest'
import { acceptMediaFile, FAQ_ITEMS, FEATURES, formatBytes, normalizeMediaUrl, REASONS, STEPS } from './landing'

describe('Demo landing source input', () => {
  it('accepts a Matroska file even when the browser reports no MIME type', () => {
    const outcome = acceptMediaFile(new File([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], 'Episode.MKV', { type: '' }))
    expect(outcome.ok).toBe(true)
  })

  it('accepts any file the browser labels as video or audio', () => {
    const outcome = acceptMediaFile(new File([new Uint8Array([0])], 'capture-0001', { type: 'video/mp4' }))
    expect(outcome.ok).toBe(true)
  })

  it('rejects non-media files and a missing selection with an explanation', () => {
    const rejected = acceptMediaFile(new File([new Uint8Array([0])], 'notes.txt', { type: 'text/plain' }))
    expect(rejected).toEqual({ ok: false, message: '请选择视频或音频文件（.mkv、.webm、.mp4、.mov …）。' })
    expect(acceptMediaFile(undefined)).toEqual({ ok: false, message: '没有读取到文件。' })
  })

  it('resolves relative media addresses against the current page', () => {
    expect(normalizeMediaUrl(' flower.webm ', 'https://maishan-inc.github.io/MX-Player-Max/'))
      .toEqual({ ok: true, value: 'https://maishan-inc.github.io/MX-Player-Max/flower.webm' })
  })

  it('refuses empty, unparsable and non-HTTP addresses', () => {
    const page = 'https://maishan-inc.github.io/MX-Player-Max/'
    expect(normalizeMediaUrl('   ', page)).toEqual({ ok: false, message: '请输入媒体地址。' })
    expect(normalizeMediaUrl('http://', page)).toEqual({ ok: false, message: '地址无法解析，请检查拼写。' })
    expect(normalizeMediaUrl('file:///C:/movie.mkv', page))
      .toEqual({ ok: false, message: '媒体地址必须以 http:// 或 https:// 开头。' })
  })

  it('formats byte counts across every unit and guards invalid input', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.00 GB')
    expect(formatBytes(-1)).toBe('未知大小')
    expect(formatBytes(Number.NaN)).toBe('未知大小')
  })
})

describe('Demo landing copy', () => {
  it('ships every section with content', () => {
    expect(FEATURES.length).toBe(6)
    expect(REASONS.length).toBe(4)
    expect(STEPS.map((step) => step.step)).toEqual(['01', '02', '03', '04'])
    expect(FAQ_ITEMS.length).toBeGreaterThanOrEqual(6)
  })

  it('keeps every heading and question unique so React keys stay stable', () => {
    const titles = [...FEATURES, ...REASONS, ...STEPS].map((item) => item.title)
    expect(new Set(titles).size).toBe(titles.length)
    const questions = FAQ_ITEMS.map((item) => item.q)
    expect(new Set(questions).size).toBe(questions.length)
  })
})
