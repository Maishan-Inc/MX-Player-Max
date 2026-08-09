import { describe, expect, it } from 'vitest'
import { createPlaybackSnapshot, summarizePlaybackError, updatePlaybackSnapshot } from '../src/playback/snapshot'

describe('playback snapshot normalization', () => {
  it('creates an immutable safe baseline and normalizes updates', () => {
    const initial = createPlaybackSnapshot(2)
    const next = updatePlaybackSnapshot(initial, {
      sessionEpoch: 3,
      state: 'playing',
      paused: false,
      currentTime: 5.2,
      duration: Number.NaN,
      buffered: [{ start: 0, end: 10 }],
      volume: 2,
      playbackRate: 1.5,
      capabilities: { seek: true },
    })
    expect(Object.isFrozen(next)).toBe(true)
    expect(next.sessionEpoch).toBe(3)
    expect(next.currentTime).toBe(5)
    expect(next.duration).toBeNull()
    expect(next.volume).toBe(1)
    expect(next.playbackRate).toBe(1.5)
    expect(next.capabilities.seek).toBe(true)
  })

  it('reduces errors to stable code and recoverability only', () => {
    const summary = summarizePlaybackError({ code: 'NATIVE_NETWORK_FAILED', message: 'https://secret.test/video?token=x', cause: new Error('stack'), recoverable: true })
    expect(summary).toEqual({ code: 'NATIVE_NETWORK_FAILED', recoverable: true })
    expect(summary).not.toHaveProperty('message')
    expect(summary).not.toHaveProperty('cause')
  })
})
