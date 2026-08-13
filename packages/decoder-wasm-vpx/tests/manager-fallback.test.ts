import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { FileRangeLoader, probeContainer } from '@mx-player-max/demux'
import { createMemoryWasmCache, createWasmDecoderManager, createWasmDecoderRegistry } from '@mx-player-max/decoder-wasm'
import type { CapabilitySnapshot, DemuxPacket, TrackInfo } from '@mx-player-max/types'
import { createLibvpxVp8Plugin, libvpxVp8Manifest, type MxwfFrameFactory } from '../src/index'

describe('libvpx VP8 Manager variant fallback', () => {
  it('falls back from real threaded initialization failure to real SIMD decode', async () => {
    const resources = await resourcesByPath()
    const requests: string[] = []
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      requests.push(url)
      const name = url.split('/').at(-1) ?? ''
      const bytes = resources.get(name)
      if (!bytes) return new Response(null, { status: 404 })
      return new Response(bytes, { status: 200, headers: { 'content-type': 'application/wasm', 'content-length': String(bytes.byteLength) } })
    }) as typeof fetch
    const frames: VideoFrame[] = []
    const frameFactory: MxwfFrameFactory = {
      create(_data, init) { return { timestamp: init.timestamp, duration: init.duration ?? null, close: vi.fn() } as unknown as VideoFrame },
    }
    const plugin = createLibvpxVp8Plugin({ frameFactory })
    const manager = createWasmDecoderManager({
      baseUrl: 'https://wasm.test/vp8/', registry: createWasmDecoderRegistry([plugin]),
      fetcher, cache: createMemoryWasmCache(), requireApprovedReview: false,
    })
    const { packet, track } = await realPacket()
    const instance = await manager.load('vp8', track, capabilities({ isolated: true, simd: true }), {
      callbacks: { onFrame: (frame) => frames.push(frame), onError: vi.fn(), onDequeue: vi.fn() },
    })
    expect(instance.variant).toBe('simd')
    instance.decode(packet)
    await instance.flush()
    expect(frames.length).toBeGreaterThan(0)
    expect(requests.map((url) => url.split('/').at(-1))).toEqual(['libvpx-vp8-threaded.wasm', 'libvpx-vp8-simd.wasm'])
    instance.close()
    manager.close()
  })

  it('never requests threaded on a non-isolated page', async () => {
    const resources = await resourcesByPath()
    const requests: string[] = []
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      requests.push(url)
      const bytes = resources.get(url.split('/').at(-1) ?? '')
      return bytes ? new Response(bytes, { status: 200 }) : new Response(null, { status: 404 })
    }) as typeof fetch
    const manager = createWasmDecoderManager({
      baseUrl: 'https://wasm.test/vp8/', registry: createWasmDecoderRegistry([createLibvpxVp8Plugin({ frameFactory: noopFactory() })]),
      fetcher, cache: createMemoryWasmCache(), requireApprovedReview: false,
    })
    const { track } = await realPacket()
    const instance = await manager.load('vp8', track, capabilities({ isolated: false, simd: false }))
    expect(instance.variant).toBe('single')
    expect(requests.map((url) => url.split('/').at(-1))).toEqual(['libvpx-vp8-single.wasm'])
    instance.close()
    manager.close()
  })
})

async function resourcesByPath(): Promise<Map<string, Uint8Array>> {
  const entries = await Promise.all(Object.values(libvpxVp8Manifest.variants).map(async (name) => {
    if (!name) throw new Error('manifest path missing')
    return [name, new Uint8Array(await readFile(fileURLToPath(new URL(`../wasm/${name}`, import.meta.url))))] as const
  }))
  return new Map(entries)
}

async function realPacket(): Promise<{ packet: DemuxPacket; track: TrackInfo }> {
  const bytes = await readFile(fileURLToPath(new URL('./fixtures/webm-vp8-p0-8bit-642x358.webm', import.meta.url)))
  const loader = new FileRangeLoader(new File([bytes], 'fixture.webm'))
  const selection = await probeContainer(loader)
  const track = selection.metadata.tracks.find((candidate) => candidate.kind === 'video')
  if (!track) throw new Error('video track missing')
  let packet: DemuxPacket | undefined
  while (!packet) {
    const batch = await selection.demuxer.next()
    if (batch.length === 0) break
    packet = batch.find((candidate) => candidate.kind === 'video')
  }
  selection.demuxer.close()
  loader.close()
  if (!packet) throw new Error('video packet missing')
  return { packet, track }
}

function capabilities(options: { isolated: boolean; simd: boolean }): CapabilitySnapshot {
  return {
    schemaVersion: 1, browser: { engine: 'unknown', name: 'unknown', version: '0', os: 'unknown' }, secureContext: true,
    crossOriginIsolated: options.isolated, sharedArrayBuffer: options.isolated, worker: true, offscreenCanvas: false,
    webAssembly: true, wasmSimd: options.simd, wasmThreads: options.isolated,
    webCodecs: { videoDecoder: false, audioDecoder: false, encodedVideoChunk: false, encodedAudioChunk: false },
    webGpu: { available: false, externalTexture: false }, webGl2: false, canvas2d: true,
    mediaSource: { available: false, workerHandle: false, managed: false },
    native: { hls: false, pictureInPicture: false, airPlay: false, remotePlayback: false }, diagnostics: [],
  }
}

function noopFactory(): MxwfFrameFactory {
  return { create(_data, init) { return { timestamp: init.timestamp, duration: init.duration ?? null, close: vi.fn() } as unknown as VideoFrame } }
}
