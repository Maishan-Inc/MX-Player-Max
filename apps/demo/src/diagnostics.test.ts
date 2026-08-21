import { describe, expect, it } from 'vitest'
import { secondsFromMicros, supportPresentation } from './diagnostics'

describe('diagnostic support presentation', () => {
  it('never presents unknown capability evidence as supported', () => {
    expect(supportPresentation('supported')).toEqual({ tone: 'supported' })
    expect(supportPresentation('unsupported')).toEqual({ tone: 'unsupported' })
    expect(supportPresentation('unknown')).toEqual({ tone: 'unknown' })
  })

  it('reports an unusable buffer reading as null instead of inventing copy', () => {
    expect(secondsFromMicros(1_500_000)).toBe('1.50 s')
    expect(secondsFromMicros(null)).toBeNull()
    expect(secondsFromMicros(Number.NaN)).toBeNull()
  })
})
