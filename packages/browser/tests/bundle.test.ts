import { readFile, stat } from 'node:fs/promises'
import { createContext, runInContext } from 'node:vm'
import { afterEach, describe, expect, it } from 'vitest'

const dist = new URL('../dist/', import.meta.url)
const artifacts = [
  'index.js',
  'index.d.ts',
  'mx-player-max.iife.js',
  'mx-player-max.iife.js.map',
  'mx-player-max.iife.min.js',
  'mx-player-max.iife.min.js.map',
  'style.css',
] as const

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'MXPlayerMax')
})

describe('@mx-player-max/browser distribution bundle', () => {
  it('emits the ESM, declaration, IIFE, minified IIFE, source maps, and shared CSS artifacts', async () => {
    for (const artifact of artifacts) {
      await expect(stat(new URL(artifact, dist))).resolves.toMatchObject({ isFile: expect.any(Function) })
    }
  })

  it('creates only the MXPlayerMax global with the supported browser entry points', async () => {
    const bundle = await readFile(new URL('mx-player-max.iife.js', dist), 'utf8')
    const sandbox: Record<PropertyKey, unknown> = {}
    const context = createContext(sandbox)
    const before = new Set(Reflect.ownKeys(sandbox))

    runInContext(bundle, context)

    const added = Reflect.ownKeys(sandbox).filter((key) => !before.has(key))
    expect(added).toEqual(['MXPlayerMax'])
    expect(sandbox.MXPlayerMax).toEqual(expect.objectContaining({
      create: expect.any(Function),
      MXPlayer: expect.any(Function),
      attachPlayerUi: expect.any(Function),
    }))
  })

  it('keeps production bundles and source maps free of workspace paths and embedded binary payloads', async () => {
    for (const artifact of ['mx-player-max.iife.js', 'mx-player-max.iife.min.js'] as const) {
      const bundle = await readFile(new URL(artifact, dist), 'utf8')
      expect(bundle).not.toMatch(/[A-Z]:[\\/](?:Github|Users)[\\/]/i)
      expect(bundle).not.toMatch(/packages[\\/]browser[\\/]tests/i)
      expect(bundle).not.toContain('data:application/wasm')
      expect(bundle).not.toContain('AGFzbQ')
      expect(bundle).not.toContain('registerProcessor(')
      expect(bundle).not.toContain('DedicatedWorkerGlobalScope')
      expect(bundle).not.toMatch(/sourceMappingURL=data:/)
      expect(bundle).not.toMatch(/var import_meta\d* = \{\}/)
    }

    for (const artifact of ['mx-player-max.iife.js.map', 'mx-player-max.iife.min.js.map'] as const) {
      const sourceMap = JSON.parse(await readFile(new URL(artifact, dist), 'utf8')) as {
        readonly sources?: readonly string[]
        readonly sourcesContent?: readonly string[]
      }
      expect(sourceMap.sourcesContent).toBeUndefined()
      expect(sourceMap.sources ?? []).not.toContain(expect.stringMatching(/[A-Z]:[\\/](?:Github|Users)[\\/]/i))
      expect(sourceMap.sources ?? []).not.toContain(expect.stringMatching(/[\\/]tests[\\/]/i))
    }
  })
})
