import { ErrorCodes } from '@mx-player-max/types'
import type { WasmDecoderRuntime } from './contracts'
import { createWasmError } from './errors'

export class BrowserWasmDecoderRuntime implements WasmDecoderRuntime {
  async compile(bytes: Uint8Array): Promise<WebAssembly.Module> {
    const api = globalThis.WebAssembly
    if (api === undefined || typeof api.compile !== 'function') {
      throw createWasmError(ErrorCodes.WASM_RUNTIME_UNAVAILABLE, 'WebAssembly compilation is unavailable', false)
    }
    const copy = bytes.slice()
    try {
      return await api.compile(copy.buffer as ArrayBuffer)
    } catch (cause) {
      throw createWasmError(ErrorCodes.WASM_INSTANTIATE_FAILED, 'The WASM module could not be compiled', true, { cause })
    }
  }

  async instantiate(
    module: WebAssembly.Module,
    imports: WebAssembly.Imports = {},
  ): Promise<WebAssembly.Instance> {
    const api = globalThis.WebAssembly
    if (api === undefined || typeof api.instantiate !== 'function') {
      throw createWasmError(ErrorCodes.WASM_RUNTIME_UNAVAILABLE, 'WebAssembly instantiation is unavailable', false)
    }
    try {
      return await api.instantiate(module, imports)
    } catch (cause) {
      throw createWasmError(ErrorCodes.WASM_INSTANTIATE_FAILED, 'The WASM module could not be instantiated', true, { cause })
    }
  }
}

export function createBrowserWasmDecoderRuntime(): BrowserWasmDecoderRuntime {
  return new BrowserWasmDecoderRuntime()
}
