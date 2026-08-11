import { describe, expect, it } from 'vitest'
import { supportPresentation } from './diagnostics'

describe('diagnostic support presentation', () => {
  it('never presents unknown capability evidence as supported', () => {
    expect(supportPresentation('supported')).toEqual({ label: 'Supported', tone: 'supported' })
    expect(supportPresentation('unsupported')).toEqual({ label: 'Unsupported', tone: 'unsupported' })
    expect(supportPresentation('unknown')).toEqual({ label: 'Pending verification', tone: 'unknown' })
  })
})
