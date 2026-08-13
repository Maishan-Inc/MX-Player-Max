import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileRangeLoader, probeContainer } from '@mx-player-max/demux'
import type { DecoderWorkerRequest, DecoderWorkerResponse } from '@mx-player-max/decoder-worker'
import type { CapabilitySnapshot, DemuxPacket, TrackInfo } from '@mx-player-max/types'
import {
  LibvpxVp8WorkerController,
  WorkerLibvpxVp8DecoderAdapter,
  type LibvpxVp8WorkerConfig,
  type LibvpxVp8WorkerTransport,
} from '../src/index'

const originalVideoFrame = globalThis.VideoFrame

afterEach(() => {
  Object.defineProperty(globalThis, 'VideoFrame', { configurable: true, writable: true, value: originalVideoFrame })
})

describe('libvpx VP8 WASM Worker integration', () => {
  it('configures, decodes a real packet, transfers a frame, flushes and closes', async () => {
    installVideoFrameStub()
    const { packet, track } = await realPacket()
    const resources = await resourcesByPath()
    const requests: string[] = []
    const messages: DecoderWorkerResponse[] = []
    const transfers: Transferable[][] = []
    const controller = new LibvpxVp8WorkerController({
      postMessage(message, transfer = []) { messages.push(message); transfers.push(transfer) },
    }, { fetcher: assetFetcher(resources, requests) })

    await controller.handle(configureRequest(track))
    await controller.handle({ command: 'decode', sessionId: 'worker', epoch: 0, requestId: 'decode', packet })
    await controller.handle({ command: 'flush', sessionId: 'worker', epoch: 0, requestId: 'flush' })

    const frameMessage = messages.find((message) => message.type === 'frame')
    expect(frameMessage).toMatchObject({ type: 'frame', epoch: 0, requestId: 'decode', timestamp: packet.timestamp })
    if (frameMessage?.type !== 'frame') throw new Error('decoded Worker frame missing')
    expect(frameMessage.frame.codedWidth).toBe(642)
    expect(frameMessage.frame.codedHeight).toBe(358)
    expect(transfers.some((transfer) => transfer[0] === frameMessage.frame)).toBe(true)
    expect(messages.map((message) => message.type)).toEqual(['configured', 'frame', 'dequeue', 'flushed'])
    expect(requests.map(assetName)).toEqual(['libvpx-vp8-single.wasm'])

    await controller.handle({ command: 'close', sessionId: 'worker', epoch: 1, requestId: 'close' })
    expect(messages.at(-1)?.type).toBe('closed')
    controller.close()
  })

  it('uses the shared adapter for reset and rejects stale-epoch frames', async () => {
    installVideoFrameStub()
    const { packet, track } = await realPacket()
    const resources = await resourcesByPath()
    const transport = new ControllerTransport((port) => new LibvpxVp8WorkerController(port, {
      fetcher: assetFetcher(resources, []),
    }))
    const frames: VideoFrame[] = []
    const adapter = new WorkerLibvpxVp8DecoderAdapter({
      callbacks: { onFrame: (frame) => frames.push(frame), onError: vi.fn(), onDequeue: vi.fn() },
      baseUrl: 'https://wasm.test/vp8/',
      track,
      capabilities: capabilities(),
      transportFactory: () => transport,
      sessionId: 'main',
    })

    await adapter.configure(videoConfig(track), true, 0)
    adapter.decode(packet, 0)
    await waitFor(() => frames.length === 1)
    await adapter.reset(1)

    const staleClose = vi.fn()
    transport.respond({
      type: 'frame', sessionId: 'main', epoch: 0, requestId: 'stale',
      frame: { close: staleClose } as unknown as VideoFrame, timestamp: 0, duration: null,
    })
    expect(staleClose).toHaveBeenCalledOnce()
    expect(frames).toHaveLength(1)

    adapter.decode({ ...packet, data: Uint8Array.from(packet.data) }, 1)
    await adapter.flush(1)
    await waitFor(() => frames.length === 2)
    adapter.close()
    expect(transport.terminated).toBe(true)
    expect(frames.every((frame) => frame.codedWidth === 642 && frame.codedHeight === 358)).toBe(true)
  })
})

class ControllerTransport implements LibvpxVp8WorkerTransport {
  readonly #controller: LibvpxVp8WorkerController
  #listener: ((event: MessageEvent<DecoderWorkerResponse>) => void) | null = null
  terminated = false

  constructor(createController: (port: { postMessage(message: DecoderWorkerResponse, transfer?: Transferable[]): void }) => LibvpxVp8WorkerController) {
    this.#controller = createController({ postMessage: (message) => this.respond(message) })
  }

  postMessage(message: DecoderWorkerRequest<LibvpxVp8WorkerConfig>): void {
    queueMicrotask(() => { void this.#controller.handle(message) })
  }

  addEventListener(_type: 'message', listener: (event: MessageEvent<DecoderWorkerResponse>) => void): void { this.#listener = listener }
  removeEventListener(): void { this.#listener = null }
  terminate(): void { this.terminated = true; this.#controller.close() }
  respond(message: DecoderWorkerResponse): void { this.#listener?.({ data: message } as MessageEvent<DecoderWorkerResponse>) }
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

async function resourcesByPath(): Promise<Map<string, Uint8Array>> {
  const bytes = await readFile(fileURLToPath(new URL('../wasm/libvpx-vp8-single.wasm', import.meta.url)))
  return new Map([['libvpx-vp8-single.wasm', new Uint8Array(bytes)]])
}

function assetFetcher(resources: Map<string, Uint8Array>, requests: string[]): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    requests.push(url)
    const bytes = resources.get(assetName(url))
    return bytes ? new Response(bytes, { status: 200 }) : new Response(null, { status: 404 })
  }) as typeof fetch
}

function assetName(url: string): string { return url.split('/').at(-1) ?? '' }

function configureRequest(track: TrackInfo): DecoderWorkerRequest<LibvpxVp8WorkerConfig> {
  return {
    command: 'configure', sessionId: 'worker', epoch: 0, requestId: 'configure',
    config: { kind: 'libvpx-vp8', baseUrl: 'https://wasm.test/vp8/', track, capabilities: capabilities() },
  }
}

function videoConfig(track: TrackInfo): VideoDecoderConfig {
  return { codec: 'vp8', codedWidth: track.width, codedHeight: track.height }
}

function capabilities(): CapabilitySnapshot {
  return {
    schemaVersion: 1,
    browser: { engine: 'unknown', name: 'unknown', version: '0', os: 'unknown' },
    secureContext: true,
    crossOriginIsolated: false,
    sharedArrayBuffer: false,
    worker: true,
    offscreenCanvas: false,
    webAssembly: true,
    wasmSimd: false,
    wasmThreads: false,
    webCodecs: { videoDecoder: false, audioDecoder: false, encodedVideoChunk: false, encodedAudioChunk: false },
    webGpu: { available: false, externalTexture: false },
    webGl2: false,
    canvas2d: true,
    mediaSource: { available: false, workerHandle: false, managed: false },
    native: { hls: false, pictureInPicture: false, airPlay: false, remotePlayback: false },
    diagnostics: [],
  }
}

function installVideoFrameStub(): void {
  class TestVideoFrame {
    readonly codedWidth: number
    readonly codedHeight: number
    readonly timestamp: number
    readonly duration: number | null
    readonly close = vi.fn()

    constructor(_data: AllowSharedBufferSource, init: VideoFrameBufferInit) {
      this.codedWidth = init.codedWidth
      this.codedHeight = init.codedHeight
      this.timestamp = init.timestamp
      this.duration = init.duration ?? null
    }
  }
  Object.defineProperty(globalThis, 'VideoFrame', { configurable: true, writable: true, value: TestVideoFrame })
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('Worker integration did not settle')
}
