import { describe, expect, it } from 'vitest'
import { createFrameBudgetGovernor } from '../src/index'

describe('DefaultFrameBudgetGovernor', () => {
  it('degrades after a full over-budget window and recovers slowly', () => {
    let now = 0
    const changes: string[] = []
    const governor = createFrameBudgetGovernor({ initialTier: 'high', maxTier: 'high', now: () => now, recoveryMs: 100, recoveryCooldownMs: 300, windowSize: 3 })
    governor.onTierChange((tier) => changes.push(tier))
    for (let i = 0; i < 3; i += 1) governor.record(9, 10)
    expect(governor.tier).toBe('medium')
    for (let i = 0; i < 3; i += 1) governor.record(1, 10)
    now = 100
    for (let i = 0; i < 3; i += 1) governor.record(1, 10)
    expect(governor.tier).toBe('high')
    expect(changes).toEqual(['medium', 'high'])
  })

  it('freezes decisions during seek and forces off on device loss', () => {
    const governor = createFrameBudgetGovernor({ initialTier: 'high', windowSize: 3 })
    governor.freeze()
    for (let i = 0; i < 5; i += 1) governor.record(100, 1)
    expect(governor.tier).toBe('high')
    governor.resume()
    governor.setDeviceLost()
    expect(governor.tier).toBe('off')
  })
})
