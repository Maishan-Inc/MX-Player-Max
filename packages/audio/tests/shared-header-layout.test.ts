import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  SHARED_AVAILABLE_FRAMES,
  SHARED_CLOSED,
  SHARED_PAUSED,
  SHARED_READ_FRAME,
  SHARED_RENDERED_FRAMES,
  SHARED_UNDERRUNS,
} from '../src/index'

const WORKLET_SOURCE = readFileSync(new URL('../src/worklet-processor.ts', import.meta.url), 'utf8')

/**
 * The worklet ships as a standalone asset, so it duplicates the shared-header slot
 * indices instead of importing them. These tests are the reason that duplication is
 * safe: they fail if the two copies drift, or if a runtime import creeps back in and
 * makes the published module unloadable.
 */
describe('AudioWorklet shared-header layout', () => {
  it('keeps the duplicated slot indices equal to the exported constants', () => {
    const declared = new Map<string, number>()
    for (const match of WORKLET_SOURCE.matchAll(/^const (SHARED_[A-Z_]+) = (\d+)$/gm)) {
      declared.set(match[1]!, Number(match[2]))
    }
    expect(declared.size).toBeGreaterThan(0)
    const exported: Record<string, number> = {
      SHARED_READ_FRAME,
      SHARED_AVAILABLE_FRAMES,
      SHARED_RENDERED_FRAMES,
      SHARED_UNDERRUNS,
      SHARED_PAUSED,
      SHARED_CLOSED,
    }
    for (const [name, value] of declared) {
      expect(exported[name], `${name} is duplicated in the worklet but not compared here`).toBeTypeOf('number')
      expect(value, `${name} drifted from ring-buffer.ts`).toBe(exported[name])
    }
  })

  it('declares every slot index it reads', () => {
    const declared = new Set([...WORKLET_SOURCE.matchAll(/^const (SHARED_[A-Z_]+) = \d+$/gm)].map((match) => match[1]!))
    const used = new Set([...WORKLET_SOURCE.matchAll(/SHARED_[A-Z_]+/g)].map((match) => match[0]))
    for (const name of used) expect(declared.has(name), `${name} is used but not declared locally`).toBe(true)
  })

  it('has no runtime import, so the published module loads standalone', () => {
    const imports = [...WORKLET_SOURCE.matchAll(/^import\s+(?!type\b)[\s\S]*?from\s+'[^']+'/gm)].map((match) => match[0])
    expect(imports, 'an AudioWorklet module cannot resolve sibling modules').toEqual([])
  })
})
