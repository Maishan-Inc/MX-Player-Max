import { describe, expect, it, vi } from 'vitest'
import { initializeDemoReveal } from './reveal'

describe('demo reveal boundary', () => {
  it('restores content visibility when animation initialization fails', () => {
    const element = { style: { visibility: 'hidden', opacity: '0' } }
    const root = { querySelectorAll: () => [element] } as unknown as HTMLElement

    const cleanup = initializeDemoReveal(root, false, () => { throw new Error('animation unavailable') })

    expect(element.style).toEqual({ visibility: 'visible', opacity: '1' })
    expect(cleanup).not.toThrow()
  })

  it('passes reduced-motion preference to the animator without adding motion', () => {
    const root = { querySelectorAll: () => [] } as unknown as HTMLElement
    const cleanup = vi.fn()
    const animate = vi.fn(() => cleanup)

    expect(initializeDemoReveal(root, true, animate)).toBe(cleanup)
    expect(animate).toHaveBeenCalledWith(root, true)
  })
})
