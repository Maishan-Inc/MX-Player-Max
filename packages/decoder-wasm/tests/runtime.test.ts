import { describe, expect, it } from 'vitest'
import { createBrowserWasmDecoderRuntime } from '../src'

const EMPTY_MODULE = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])

describe('BrowserWasmDecoderRuntime', () => {
  it('compiles and instantiates a real WebAssembly module', async () => {
    const runtime = createBrowserWasmDecoderRuntime()
    const module = await runtime.compile(EMPTY_MODULE)
    const instance = await runtime.instantiate(module)
    expect(module).toBeInstanceOf(WebAssembly.Module)
    expect(instance).toBeInstanceOf(WebAssembly.Instance)
  })

  it('does not retain a mutable view of input bytes', async () => {
    const runtime = createBrowserWasmDecoderRuntime()
    const bytes = EMPTY_MODULE.slice()
    const compiling = runtime.compile(bytes)
    bytes.fill(0)
    await expect(compiling).resolves.toBeInstanceOf(WebAssembly.Module)
  })
})
