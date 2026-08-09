import { describe, expect, it, vi } from 'vitest'
import { ErrorCodes, type SubtitleClockSnapshot, type SubtitleCue } from '@mx-player-max/types'
import { activeCues, CallbackSubtitleClock, SubtitleScheduler, SubtitleTrackManager } from '../src/index'

function createClock(): { clock: CallbackSubtitleClock; set(snapshot: Partial<SubtitleClockSnapshot>): void } {
  let snapshot: SubtitleClockSnapshot = { source: 'wall-clock', mediaTime: 0, playbackRate: 1, playing: false, ended: false, epoch: 0 }
  const clock = new CallbackSubtitleClock(() => snapshot)
  return {
    clock,
    set(value) { snapshot = { ...snapshot, ...value }; clock.notify() },
  }
}

describe('subtitle track manager and clock scheduling', () => {
  it('preserves the public activeCues helper with end-exclusive microsecond boundaries', () => {
    const cues: SubtitleCue[] = [{ cueId: 'legacy', trackId: 't', start: 1_000_000, end: 2_000_000, text: 'active', layer: 0 }]
    expect(activeCues(cues, 1_000_000)).toEqual(cues)
    expect(activeCues(cues, 2_000_000)).toEqual([])
  })

  it('loads, selects, disables, removes tracks and keeps overlap order stable', async () => {
    const { clock, set } = createClock()
    const events: Array<{ type: string; cues?: readonly { cueId: string }[] }> = []
    const cues: SubtitleCue[] = [
      { cueId: 'b', trackId: 't', start: 0, end: 2_000_000, text: 'b', layer: 0 },
      { cueId: 'a', trackId: 't', start: 0, end: 2_000_000, text: 'a', layer: 2 },
    ]
    const manager = new SubtitleTrackManager({
      clock,
      styleScope: 'local-file',
      tracks: [{ id: 't', source: { kind: 'url', url: 'https://example.test/t.srt', format: 'srt' }, format: 'srt' }],
      loadTrack: async () => ({ cues, diagnostics: [] }),
      onEvent: (event) => events.push(event.type === 'cuechange' ? { type: event.type, cues: event.cues } : { type: event.type }),
    })
    await manager.selectTrack('t')
    set({ mediaTime: 1_000_000, playing: true })
    const lastCueEvent = [...events].reverse().find((event) => event.type === 'cuechange')
    expect(lastCueEvent?.cues?.map((cue) => cue.cueId)).toEqual(['a', 'b'])
    await manager.selectTrack(null)
    expect(manager.selectedTrackId).toBeNull()
    manager.removeTrack('t')
    expect(manager.tracks).toHaveLength(0)
    clock.close()
  })

  it('rejects duplicate IDs and drops stale async selections', async () => {
    const { clock } = createClock()
    let resolveLoad: ((value: { cues: SubtitleCue[]; diagnostics: [] }) => void) | null = null
    const manager = new SubtitleTrackManager({
      clock,
      styleScope: 'local-file',
      tracks: [{ id: 'one', source: { kind: 'url', url: 'https://example.test/one.srt', format: 'srt' }, format: 'srt' }],
      loadTrack: () => new Promise((resolve) => { resolveLoad = resolve }),
    })
    await expect(manager.addTrack({ kind: 'url', url: 'https://example.test/two.srt', format: 'srt' }, { id: 'one' })).rejects.toMatchObject({ code: ErrorCodes.SUBTITLE_TRACK_ID_CONFLICT })
    const pending = manager.selectTrack('one')
    await manager.selectTrack(null)
    resolveLoad?.({ cues: [], diagnostics: [] })
    await expect(pending).rejects.toMatchObject({ code: ErrorCodes.SUBTITLE_ABORTED })
    manager.closeSubtitles()
  })

  it('rejects equivalent external sources before starting a duplicate read', async () => {
    const { clock } = createClock()
    const loadTrack = vi.fn(async () => ({ cues: [], diagnostics: [] }))
    const manager = new SubtitleTrackManager({ clock, styleScope: 'local-file', loadTrack })
    const source = { kind: 'url', url: 'https://example.test/subtitle.srt#first', format: 'srt' } as const
    await manager.addTrack(source, { id: 'first' })

    await expect(manager.addTrack(
      { kind: 'url', url: 'https://example.test/subtitle.srt#second', format: 'srt' },
      { id: 'second' },
    )).rejects.toMatchObject({ code: ErrorCodes.SUBTITLE_SOURCE_CONFLICT })
    expect(loadTrack).toHaveBeenCalledTimes(1)
    clock.close()
  })

  it('rejects insecure external sources before registering a track', async () => {
    const { clock } = createClock()
    const manager = new SubtitleTrackManager({ clock, styleScope: 'local-file', loadTrack: vi.fn(async () => ({ cues: [], diagnostics: [] })) })
    await expect(manager.addTrack({ kind: 'url', url: 'http://example.test/subtitle.srt', format: 'srt' }, { id: 'insecure' }))
      .rejects.toMatchObject({ code: ErrorCodes.SUBTITLE_SOURCE_UNSUPPORTED })
    expect(manager.tracks).toEqual([])
    manager.closeSubtitles()
  })

  it('rejects equivalent external sources in initial track definitions', () => {
    const { clock } = createClock()
    expect(() => new SubtitleTrackManager({
      clock,
      styleScope: 'local-file',
      tracks: [
        { id: 'one', source: { kind: 'url', url: 'https://example.test/subtitle.srt#one', format: 'srt' }, format: 'srt' },
        { id: 'two', source: { kind: 'url', url: 'https://example.test/subtitle.srt#two', format: 'srt' }, format: 'srt' },
      ],
    })).toThrowError(expect.objectContaining({ code: ErrorCodes.SUBTITLE_SOURCE_CONFLICT }))
    clock.close()
  })

  it('uses media time rather than packet arrival order and honors EOS', () => {
    const { clock, set } = createClock()
    const updates: string[][] = []
    const scheduler = new SubtitleScheduler(clock, (update) => updates.push(update.cues.map((cue) => cue.cueId)), { requestAnimationFrame: () => 1, cancelAnimationFrame: vi.fn() })
    scheduler.setCues([
      { cueId: 'late', trackId: 't', start: 2_000_000, end: 3_000_000, text: 'late', layer: 0 },
      { cueId: 'early', trackId: 't', start: 0, end: 1_000_000, text: 'early', layer: 0 },
      { cueId: 'after-eos', trackId: 't', start: 4_000_000, end: 5_000_000, text: 'after', layer: 0 },
    ])
    set({ mediaTime: 2_500_000, playing: true })
    expect(updates.at(-1)).toEqual(['late'])
    scheduler.ended()
    set({ mediaTime: 4_500_000, playing: false, ended: true })
    expect(updates.at(-1)).toEqual([])
    scheduler.close()
  })

  it('rebuilds immediately for pause, rate changes, backward seek, and continuous epochs', () => {
    const { clock, set } = createClock()
    const updates: Array<{ ids: string[]; epoch: number; time: number }> = []
    const scheduler = new SubtitleScheduler(clock, (update) => updates.push({
      ids: update.cues.map((cue) => cue.cueId),
      epoch: update.snapshot.epoch,
      time: update.snapshot.mediaTime,
    }), { requestAnimationFrame: () => 1, cancelAnimationFrame: vi.fn() })
    scheduler.setCues([
      { cueId: 'first', trackId: 't', start: 0, end: 1_000_000, text: 'first', layer: 0 },
      { cueId: 'second', trackId: 't', start: 1_000_000, end: 2_000_000, text: 'second', layer: 0 },
    ])
    set({ mediaTime: 1_500_000, playbackRate: 2, playing: true })
    expect(updates.at(-1)?.ids).toEqual(['second'])
    scheduler.pause()
    set({ playing: false })
    expect(updates.at(-1)?.ids).toEqual(['second'])
    set({ mediaTime: 500_000, epoch: 1 })
    scheduler.seek(1)
    expect(updates.at(-1)).toMatchObject({ ids: ['first'], epoch: 1, time: 500_000 })
    set({ mediaTime: 1_500_000, epoch: 2 })
    scheduler.seek(2)
    expect(updates.at(-1)).toMatchObject({ ids: ['second'], epoch: 2, time: 1_500_000 })
    scheduler.close()
  })

  it('suppresses stale cues throughout a seek until completion', async () => {
    const { clock, set } = createClock()
    const events: Array<readonly string[]> = []
    const manager = new SubtitleTrackManager({
      clock,
      styleScope: 'local-file',
      tracks: [{ id: 'seek', source: { kind: 'url', url: 'https://example.test/seek.srt', format: 'srt' }, format: 'srt' }],
      loadTrack: async () => ({ cues: [{ cueId: 'old', trackId: 'seek', start: 0, end: 2_000_000, text: 'old', layer: 0 }, { cueId: 'new', trackId: 'seek', start: 3_000_000, end: 4_000_000, text: 'new', layer: 0 }], diagnostics: [] }),
      onEvent: (event) => { if (event.type === 'cuechange') events.push(event.cues.map((cue) => cue.cueId)) },
    })
    await manager.selectTrack('seek')
    set({ mediaTime: 500_000, playing: true })
    manager.seekStarted()
    expect(events.at(-1)).toEqual([])
    set({ mediaTime: 3_500_000, epoch: 1, playing: false })
    expect(events.at(-1)).toEqual([])
    manager.seekCompleted()
    expect(events.at(-1)).toEqual(['new'])
    manager.closeSubtitles()
  })

  it('restarts a selected track load after seek invalidates the pending epoch', async () => {
    const { clock, set } = createClock()
    let resolveFirst: ((value: { cues: SubtitleCue[]; diagnostics: [] }) => void) | null = null
    let loadCount = 0
    const cue: SubtitleCue = { cueId: 'reloaded', trackId: 'loading', start: 3_000_000, end: 4_000_000, text: 'new', layer: 0 }
    const loadTrack = vi.fn(() => {
      loadCount += 1
      return loadCount === 1
        ? new Promise<{ cues: SubtitleCue[]; diagnostics: [] }>((resolve) => { resolveFirst = resolve })
        : Promise.resolve({ cues: [cue], diagnostics: [] as [] })
    })
    const manager = new SubtitleTrackManager({
      clock,
      styleScope: 'local-file',
      tracks: [{ id: 'loading', source: { kind: 'url', url: 'https://example.test/loading.srt', format: 'srt' }, format: 'srt' }],
      loadTrack,
    })

    const pending = manager.selectTrack('loading')
    manager.seekStarted()
    set({ mediaTime: 3_500_000, epoch: 1, playing: false })
    manager.seekCompleted()
    resolveFirst?.({ cues: [], diagnostics: [] })

    await expect(pending).rejects.toMatchObject({ code: ErrorCodes.SUBTITLE_ABORTED })
    await vi.waitFor(() => expect(manager.tracks[0]).toMatchObject({ state: 'selected', cueCount: 1 }))
    expect(loadTrack).toHaveBeenCalledTimes(2)
    manager.closeSubtitles()
  })

  it('drops a pending add result when that track is removed', async () => {
    const { clock } = createClock()
    let resolveLoad: ((value: { cues: SubtitleCue[]; diagnostics: [] }) => void) | null = null
    const manager = new SubtitleTrackManager({
      clock,
      styleScope: 'local-file',
      loadTrack: () => new Promise((resolve) => { resolveLoad = resolve }),
    })
    const pending = manager.addTrack({ kind: 'url', url: 'https://example.test/late.srt', format: 'srt' }, { id: 'late' })
    manager.removeTrack('late')
    resolveLoad?.({ cues: [], diagnostics: [] })
    await expect(pending).rejects.toMatchObject({ code: ErrorCodes.SUBTITLE_ABORTED })
    expect(manager.tracks).toEqual([])
    manager.closeSubtitles()
  })

  it('re-renders only active cues when style changes or an overlay is attached', async () => {
    const { clock, set } = createClock()
    const render = vi.fn()
    const attach = vi.fn()
    const manager = new SubtitleTrackManager({
      clock,
      styleScope: 'local-file',
      overlay: { render, attach, close: vi.fn(), detach: vi.fn() } as unknown as import('../src/index').SubtitleOverlay,
      tracks: [{ id: 'styled', source: { kind: 'url', url: 'https://example.test/styled.srt', format: 'srt' }, format: 'srt' }],
      loadTrack: async () => ({
        cues: [
          { cueId: 'active', trackId: 'styled', start: 0, end: 1_000_000, text: 'active', layer: 0 },
          { cueId: 'future', trackId: 'styled', start: 2_000_000, end: 3_000_000, text: 'future', layer: 0 },
        ],
        diagnostics: [],
      }),
    })
    await manager.selectTrack('styled')
    set({ mediaTime: 500_000 })
    render.mockClear()

    manager.setStyle({ fontSize: 48 })
    expect(render.mock.calls.at(-1)?.[0].map((cue: SubtitleCue) => cue.cueId)).toEqual(['active'])

    manager.attachOverlay({} as HTMLElement, 'canvas2d')
    expect(attach).toHaveBeenCalled()
    expect(render.mock.calls.at(-1)?.[0].map((cue: SubtitleCue) => cue.cueId)).toEqual(['active'])
    manager.closeSubtitles()
  })
})
