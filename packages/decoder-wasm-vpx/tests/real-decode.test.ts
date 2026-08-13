import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { FileRangeLoader, probeContainer } from '@mx-player-max/demux'
import { createBrowserWasmDecoderRuntime } from '@mx-player-max/decoder-wasm'
import type { CapabilitySnapshot, DemuxPacket, TrackInfo } from '@mx-player-max/types'
import { createLibvpxVp8Plugin, type MxwfFrameFactory } from '../src/index'

const fixtureUrl = new URL('./fixtures/webm-vp8-p0-8bit-642x358.webm', import.meta.url)
const wasmUrl = new URL('../wasm/libvpx-vp8-single.wasm', import.meta.url)

describe('real libvpx VP8 WASM decode', () => {
  it('demuxes and decodes real VP8 packets into non-empty padded I420 frames', async () => {
    const mediaBytes = await readFile(fileURLToPath(fixtureUrl))
    const loader = new FileRangeLoader(new File([mediaBytes], 'webm-vp8-p0-8bit-642x358.webm'))
    const selection = await probeContainer(loader)
    const track = selection.metadata.tracks.find((candidate) => candidate.kind === 'video')
    if (!track) throw new Error('fixture video track missing')
    expect(track).toMatchObject({ codec: 'vp8', width: 642, height: 358 })
    const packets = await readVideoPackets(selection.demuxer)
    expect(packets.length).toBeGreaterThan(0)

    const module = await WebAssembly.compile(await readFile(fileURLToPath(wasmUrl)))
    const frames: CapturedFrame[] = []
    const frameFactory: MxwfFrameFactory = {
      create(data, init) {
        frames.push({ bytes: Uint8Array.from(data), init })
        return { close: vi.fn(), timestamp: init.timestamp, duration: init.duration ?? null } as unknown as VideoFrame
      },
    }
    const plugin = createLibvpxVp8Plugin({ frameFactory })
    const instance = await plugin.create({
      variant: 'single', module, manifest: plugin.manifest, track, capabilities: capabilities(),
      signal: new AbortController().signal, runtime: createBrowserWasmDecoderRuntime(),
      callbacks: { onFrame: vi.fn(), onError: vi.fn(), onDequeue: vi.fn() },
    })
    for (const packet of packets.slice(0, 3)) instance.decode(packet)
    await instance.flush()
    expect(frames.length).toBeGreaterThan(0)
    const first = frames[0]
    if (!first) throw new Error('decoded frame missing')
    expect(first.init).toMatchObject({
      format: 'I420', codedWidth: 642, codedHeight: 358, displayWidth: 642, displayHeight: 358,
      visibleRect: { x: 0, y: 0, width: 642, height: 358 },
      colorSpace: { primaries: 'smpte170m', transfer: 'smpte170m', matrix: 'smpte170m', fullRange: false },
      layout: [{ offset: 0, stride: 656 }, { offset: 234_848, stride: 336 }, { offset: 294_992, stride: 336 }],
    })
    expect(first.bytes.some((value) => value !== 0)).toBe(true)
    expect(instance.decodeQueueSize).toBe(0)
    instance.close()
    selection.demuxer.close()
    loader.close()
  })
})

interface CapturedFrame { bytes: Uint8Array; init: VideoFrameBufferInit }

async function readVideoPackets(demuxer: { next(): Promise<DemuxPacket[]> }): Promise<DemuxPacket[]> {
  const packets: DemuxPacket[] = []
  while (packets.length < 3) {
    const batch = await demuxer.next()
    if (batch.length === 0) break
    packets.push(...batch.filter((packet) => packet.kind === 'video'))
  }
  return packets
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
