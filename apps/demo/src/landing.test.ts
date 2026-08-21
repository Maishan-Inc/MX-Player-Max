import { describe, expect, it } from 'vitest'
import { acceptMediaFile, formatBytes, normalizeMediaUrl } from './landing'

describe('Demo landing source input', () => {
  it('accepts a Matroska file even when the browser reports no MIME type', () => {
    const outcome = acceptMediaFile(new File([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], 'Episode.MKV', { type: '' }))
    expect(outcome.ok).toBe(true)
  })

  it('accepts any file the browser labels as video or audio', () => {
    const outcome = acceptMediaFile(new File([new Uint8Array([0])], 'capture-0001', { type: 'video/mp4' }))
    expect(outcome.ok).toBe(true)
  })

  it('rejects non-media files and a missing selection with a locale-free reason', () => {
    const rejected = acceptMediaFile(new File([new Uint8Array([0])], 'notes.txt', { type: 'text/plain' }))
    expect(rejected).toEqual({ ok: false, reason: 'not-media' })
    expect(acceptMediaFile(undefined)).toEqual({ ok: false, reason: 'no-file' })
  })

  it('resolves relative media addresses against the current page', () => {
    expect(normalizeMediaUrl(' flower.webm ', 'https://maishan-inc.github.io/MX-Player-Max/'))
      .toEqual({ ok: true, value: 'https://maishan-inc.github.io/MX-Player-Max/flower.webm' })
  })

  it('refuses empty, unparsable and non-HTTP addresses', () => {
    const page = 'https://maishan-inc.github.io/MX-Player-Max/'
    expect(normalizeMediaUrl('   ', page)).toEqual({ ok: false, reason: 'empty-url' })
    expect(normalizeMediaUrl('http://', page)).toEqual({ ok: false, reason: 'bad-url' })
    expect(normalizeMediaUrl('file:///C:/movie.mkv', page)).toEqual({ ok: false, reason: 'bad-protocol' })
  })

  it('formats byte counts across every unit and reports invalid input as null', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.00 GB')
    expect(formatBytes(-1)).toBeNull()
    expect(formatBytes(Number.NaN)).toBeNull()
  })
})
