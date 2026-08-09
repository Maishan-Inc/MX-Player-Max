import { describe, expect, it } from 'vitest'
import { ErrorCodes, type DemuxPacket } from '@mx-player-max/types'
import { AssPacketParser, parseEmbeddedSubtitlePackets } from '../src/index'

function packet(timestamp: number, data: string, duration: number | null = 1_000_000): DemuxPacket {
  return {
    trackId: 7,
    kind: 'subtitle',
    timestamp,
    duration,
    keyframe: false,
    data: new TextEncoder().encode(data),
  }
}

describe('embedded subtitle packets', () => {
  it('bounds UTF-8 packets, normalizes text, and sorts overlapping cues', () => {
    const result = parseEmbeddedSubtitlePackets([
      packet(2_000_000, '<b>late</b>'),
      packet(0, 'first\r\nsecond'),
    ], { trackId: 'embedded-7', format: 'srt' })

    expect(result.diagnostics).toEqual([])
    expect(result.cues.map((cue) => cue.start)).toEqual([0, 2_000_000])
    expect(result.cues[0]?.text).toBe('first\nsecond')
    expect(result.cues[1]?.text).toContain('<b>')
  })

  it('maps standard Matroska ASS packet fields and preserves commas in Text', () => {
    const header = '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'
    const codecPrivate = new TextEncoder().encode(header).buffer
    const result = parseEmbeddedSubtitlePackets([
      packet(0, '0,2,Default,Speaker,0010,0020,0030,,Hello, world'),
      packet(2_000_000, '1,3,Default,,0000,0000,0000,,Short, packet'),
    ], { trackId: 'ass', format: 'ass', codecPrivate })

    expect(result.cues).toHaveLength(2)
    expect(result.cues[0]).toMatchObject({ layer: 2, text: 'Hello, world', start: 0, end: 1_000_000 })
    expect(result.cues[1]).toMatchObject({ layer: 3, text: 'Short, packet', start: 2_000_000, end: 3_000_000 })
  })

  it('maps the Matroska SSA Marked field without treating packet text as timestamps', () => {
    const header = '[V4 Styles]\n[Events]\nFormat: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'
    const codecPrivate = new TextEncoder().encode(header).buffer
    const result = parseEmbeddedSubtitlePackets([
      packet(4_000_000, '9,Marked=1,Default,Speaker,0000,0000,0000,,SSA, text'),
    ], { trackId: 'ssa', format: 'ssa', codecPrivate })

    expect(result.diagnostics).toEqual([])
    expect(result.cues[0]).toMatchObject({ start: 4_000_000, end: 5_000_000, text: 'SSA, text', layer: 0 })
  })

  it('returns stable diagnostics for invalid times and caps diagnostics', () => {
    const invalid: DemuxPacket[] = Array.from({ length: 20 }, (_, index) => ({
      ...packet(index * 1_000_000, 'bad', 0),
      timestamp: -1,
    }))
    const result = parseEmbeddedSubtitlePackets(invalid, {
      trackId: 'bounded',
      format: 'srt',
      limits: { maxDiagnostics: 3, maxCues: 2 },
    })

    expect(result.cues).toEqual([])
    expect(result.diagnostics.length).toBeLessThanOrEqual(3)
    expect(result.diagnostics[0]?.code).toBe(ErrorCodes.SUBTITLE_PACKET_INVALID)
  })

  it('rejects negative ASS packet timestamps at the packet parser boundary', () => {
    const header = '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'
    const parser = new AssPacketParser({ trackId: 'negative-ass', header })
    const result = parser.parsePacket('0,0,Default,,,,,,,negative', -1, 1_000_000, 0)
    expect(result.cues).toEqual([])
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === ErrorCodes.SUBTITLE_TIME_INVALID)).toBe(true)
  })

  it('reports CodecPrivate diagnostics once instead of once per packet', () => {
    const codecPrivate = new TextEncoder().encode('[Events]\nFormat: Text\n').buffer
    const result = parseEmbeddedSubtitlePackets([
      packet(0, '0,0,Default,,0,0,0,,first'),
      packet(1_000_000, '1,0,Default,,0,0,0,,second'),
    ], { trackId: 'ass-diagnostic', format: 'ass', codecPrivate })

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === ErrorCodes.SUBTITLE_ASS_INVALID)).toHaveLength(1)
  })
})
