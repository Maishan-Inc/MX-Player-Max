import { describe, expect, it } from 'vitest'
import { ErrorCodes } from '@mx-player-max/types'
import { parseAss, parseSrt, toSubtitleError } from '../src/index'

describe('SRT parser', () => {
  it('normalizes unknown subtitle error codes to the stable fallback', () => {
    expect(toSubtitleError({ code: 'SUBTITLE_SECRET', message: 'private', recoverable: true }).code)
      .toBe(ErrorCodes.SUBTITLE_OPERATION_FAILED)
  })

  it('handles BOM, CRLF, optional sequence numbers, multiline text, and microseconds', () => {
    const result = parseSrt('\uFEFF1\r\n00:00:01,250 --> 00:00:03.500\r\nhello\r\n<script>alert(1)</script>\r\n\r\n00:00:04 --> 00:00:05,1\r\nsecond', { trackId: 'en' })
    expect(result.diagnostics).toEqual([])
    expect(result.cues).toHaveLength(2)
    expect(result.cues[0]).toMatchObject({ trackId: 'en', start: 1_250_000, end: 3_500_000, text: 'hello\n<script>alert(1)</script>' })
    expect(result.cues[1]).toMatchObject({ start: 4_000_000, end: 5_100_000 })
  })

  it('accepts compact arrows without surrounding spaces', () => {
    const result = parseSrt('00:00:00,000-->00:00:01,000\ncompact')
    expect(result.diagnostics).toEqual([])
    expect(result.cues).toHaveLength(1)
  })

  it('returns bounded diagnostics for malformed and oversized entries', () => {
    const result = parseSrt('bad\nnot a time\n\n1\n00:00:03,000 --> 00:00:01,000\ninvalid\n\n2\n00:00:02,000 --> 00:00:04,000\nvalid', {
      limits: { maxCues: 2, maxLineLength: 64, maxDiagnostics: 8 },
    })
    expect(result.cues).toHaveLength(1)
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === ErrorCodes.SUBTITLE_SRT_INVALID)).toBe(true)
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === ErrorCodes.SUBTITLE_TIME_INVALID)).toBe(true)
    expect(result.diagnostics.length).toBeLessThanOrEqual(8)
  })

  it('rejects input over the hard byte budget without unbounded parsing', () => {
    expect(() => parseSrt('x'.repeat(9 * 1024 * 1024))).toThrowError(expect.objectContaining({ code: ErrorCodes.SUBTITLE_INPUT_TOO_LARGE }))
  })

  it('honors an injectable parse budget on small inputs', () => {
    let now = 0
    const result = parseSrt('1\n00:00:00,000 --> 00:00:01,000\nlimited', {
      now: () => { now += 2; return now },
      limits: { parseBudgetMs: 1 },
    })
    expect(result.cues).toEqual([])
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === ErrorCodes.SUBTITLE_PARSE_BUDGET_EXCEEDED)).toBe(true)
  })
})

describe('ASS/SSA parser', () => {
  const header = `[Script Info]\nPlayResX: 1920\nPlayResY: 1080\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,42,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,0,2,10,10,40,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 2,0:00:01.00,0:00:03.50,Default,Speaker,0,0,0,,{\\an8\\fs36\\1c&H0000FF00}Hello, world\\N第二行`

  it('maps ASS Format fields and preserves commas in Text', () => {
    const result = parseAss(header, { trackId: 'ass' })
    expect(result.cues).toHaveLength(1)
    expect(result.cues[0]).toMatchObject({ start: 1_000_000, end: 3_500_000, text: 'Hello, world\n第二行', layer: 2 })
    expect(result.cues[0]?.style).toMatchObject({ fontSize: 36, color: '#00FF00', alignment: 'top-center' })
  })

  it('reports unsupported override tags while keeping text safe and plain', () => {
    const result = parseAss('[Events]\nDialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,<img src=x onerror=alert(1)> {\\t(0,100,\\fs80)}', { trackId: 'safe' })
    expect(result.cues[0]?.text).toContain('<img src=x onerror=alert(1)>')
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === ErrorCodes.SUBTITLE_ASS_UNSUPPORTED_FEATURE)).toBe(true)
  })

  it('supports SSA V4 timing and basic alignment', () => {
    const result = parseAss('[V4 Styles]\n[Events]\nDialogue: Marked=0,0:00:00.10,0:00:01.20,Default,,0000,0000,0000,,hello', { trackId: 'ssa' })
    expect(result.cues[0]).toMatchObject({ start: 100_000, end: 1_200_000, text: 'hello' })
  })

  it('maps reordered Events and V4 style Format fields without claiming libass support', () => {
    const input = '[Script Info]\nPlayResX: 1280\nPlayResY: 720\n\n[V4 Styles]\nFormat: Fontsize, Name, Fontname, PrimaryColour, SecondaryColour, TertiaryColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, AlphaLevel, Encoding\nStyle: 30,Caption,Arial,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,-1,1,3,0,10,0,0,40,0,1\n\n[Events]\nFormat: Text, Style, End, Start, Marked\nDialogue: hello,Caption,0:00:02.00,0:00:01.00,0'
    const result = parseAss(input, { trackId: 'reordered' })
    expect(result.cues).toHaveLength(1)
    expect(result.cues[0]).toMatchObject({ start: 1_000_000, end: 2_000_000, text: 'hello' })
    expect(result.cues[0]?.style).toMatchObject({ fontSize: 30, italic: true, alignment: 'middle-center' })
  })

  it('applies each active Events Format declaration to following Dialogue rows', () => {
    const input = '[Events]\nFormat: Layer, Start, End, Style, Text\nDialogue: 2,0:00:00.00,0:00:01.00,Default,first, with comma\nFormat: Text, End, Start, Layer\nDialogue: second,0:00:03.00,0:00:02.00,4'
    const result = parseAss(input, { trackId: 'formats' })
    expect(result.diagnostics).toEqual([])
    expect(result.cues).toHaveLength(2)
    expect(result.cues[0]).toMatchObject({ start: 0, end: 1_000_000, layer: 2, text: 'first, with comma' })
    expect(result.cues[1]).toMatchObject({ start: 2_000_000, end: 3_000_000, layer: 4, text: 'second' })
  })

  it('maps legacy SSA top alignment values according to the V4 specification', () => {
    const input = '[V4 Styles]\nStyle: Top,Arial,24,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,1,1,0,6,0,0,0,0,1\n[Events]\nDialogue: Marked=0,0:00:00.00,0:00:01.00,Top,,0,0,0,,top'
    const result = parseAss(input, { trackId: 'ssa-top' })
    expect(result.cues[0]?.style).toMatchObject({ alignment: 'top-center' })
  })

  it('diagnoses unsupported ASS effects, collision mode, and style transforms', () => {
    const input = '[Script Info]\nCollisions: Reverse\n[V4+ Styles]\nStyle: Fx,Arial,24,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,1,0,120,80,2,15,3,1,4,2,0,0,0,1\n[Events]\nDialogue: 0,0:00:00.00,0:00:01.00,Fx,,0,0,0,Banner;5;0;20,hello'
    const result = parseAss(input, { trackId: 'effects' })
    expect(result.cues[0]?.text).toBe('hello')
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === ErrorCodes.SUBTITLE_ASS_UNSUPPORTED_FEATURE).length).toBeGreaterThanOrEqual(4)
  })

  it('maps alignment anchors while preserving explicit ASS position', () => {
    const input = '[Script Info]\nPlayResX: 1000\nPlayResY: 500\n[V4+ Styles]\nStyle: Left,Arial,24,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,7,100,0,50,1\n[Events]\nDialogue: 0,0:00:00.00,0:00:01.00,Left,,0,0,0,,style\nDialogue: 0,0:00:01.00,0:00:02.00,Left,,0,0,0,,{\\pos(750,250)\\an1}positioned'
    const result = parseAss(input, { trackId: 'position' })
    expect(result.cues[0]?.style).toMatchObject({ alignment: 'top-left', x: 10, y: 10 })
    expect(result.cues[1]?.style).toMatchObject({ alignment: 'bottom-left', x: 75, y: 50 })
  })

  it('rejects overlong cue lines instead of rendering truncated input', () => {
    const result = parseSrt('1\n00:00:00,000 --> 00:00:01,000\n' + 'x'.repeat(32), { limits: { maxLineLength: 16 } })
    expect(result.cues).toEqual([])
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === ErrorCodes.SUBTITLE_LINE_TOO_LONG)).toBe(true)
  })
})
