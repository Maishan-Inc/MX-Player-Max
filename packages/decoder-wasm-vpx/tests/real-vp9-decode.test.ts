import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { FileRangeLoader, probeContainer } from '@mx-player-max/demux'
import { createMemoryWasmCache, createWasmDecoderManager, createWasmDecoderRegistry } from '@mx-player-max/decoder-wasm'
import { ErrorCodes, type CapabilitySnapshot, type DemuxPacket, type TrackInfo } from '@mx-player-max/types'
import { createLibvpxVp9Plugin, createLibvpxVp9VideoDecoderConfig, type MxwfFrameFactory } from '../src/index'

const wasmUrl = new URL('../wasm/libvpx-vp9-single.wasm', import.meta.url)

describe('real libvpx VP9 WASM decode', () => {
  it.each([
    ['webm-vp9-p0-8bit-641x359.webm', '0', 8, 'I420', '1372eed5c2c2d04ea63033bb548902403b283a9918fc126d619dcd8e4f9d60c6'],
    ['webm-vp9-p2-10bit-641x359.webm', '2', 10, 'I420P10', '09ba8a0c2c2b07f42a1a0fc26af56f13d758893c65dabf2fc750037dba92741d'],
  ] as const)('demuxes %s and produces %s planes', async (name, profile, bitDepth, format, sha256) => {
    const fixtureUrl = new URL(`./fixtures/${name}`, import.meta.url)
    const fixture = await readFile(fileURLToPath(fixtureUrl))
    expect(createHash('sha256').update(fixture).digest('hex')).toBe(sha256)
    const selection = await probeContainer(new FileRangeLoader(new File([fixture], name)))
    const sourceTrack = selection.metadata.tracks.find((track) => track.kind === 'video')
    if (!sourceTrack) throw new Error('fixture video track missing')
    const track = sourceTrack
    expect(track.codec).toMatch(new RegExp(`^vp09\\.0${profile}\\.\\d{2}\\.${String(bitDepth).padStart(2, '0')}$`))
    expect(createLibvpxVp9Plugin().supports(track.codec ?? '', track)).toBe(true)
    expect(createWasmDecoderRegistry([createLibvpxVp9Plugin()]).resolve('vp9', track)).toHaveLength(1)
    expect(createLibvpxVp9VideoDecoderConfig(track).codec).toBe(track.codec)
    const packets = await readVideoPackets(selection.demuxer)
    expect(packets.length).toBeGreaterThan(0)

    const wasmBytes = new Uint8Array(await readFile(fileURLToPath(wasmUrl)))
    const fetcher = vi.fn(async () => new Response(wasmBytes, { status: 200 })) as typeof fetch
    const frames: CapturedFrame[] = []
    const manager = createWasmDecoderManager({
      baseUrl: 'https://wasm.test/vp9/',
      registry: createWasmDecoderRegistry([createLibvpxVp9Plugin({ frameFactory: captureFactory(frames) })]),
      cache: createMemoryWasmCache(), fetcher,
      // A restricted asset may be exercised in a local technical test only.
      requireApprovedReview: false,
    })
    const instance = await manager.load('vp9', track, capabilities(), {
      callbacks: { onFrame: vi.fn(), onError: vi.fn(), onDequeue: vi.fn() },
    })
    expect(instance.variant).toBe('single')
    expect(fetcher).toHaveBeenCalledOnce()
    for (const packet of packets) instance.decode(packet)
    await instance.flush()
    expect(frames.length).toBeGreaterThan(0)
    const first = frames[0]
    if (!first) throw new Error('decoded frame missing')
    expect(first.init).toMatchObject({ format, codedWidth: 641, codedHeight: 359, visibleRect: { x: 0, y: 0, width: 641, height: 359 } })
    expect(first.init.layout?.[0]?.stride).toBeGreaterThanOrEqual(bitDepth === 10 ? 1282 : 641)
    expect(first.bytes.some((value) => value !== 0)).toBe(true)
    instance.close()
    manager.close()
    selection.demuxer.close()
  })

  it('blocks restricted VP9 before fetching an asset by default', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 404 })) as typeof fetch
    const manager = createWasmDecoderManager({
      baseUrl: 'https://wasm.test/vp9/',
      registry: createWasmDecoderRegistry([createLibvpxVp9Plugin()]),
      cache: createMemoryWasmCache(), fetcher,
    })
    const track: TrackInfo = { id: 1, kind: 'video', codecId: 'V_VP9', codec: 'vp09.00.21.08', width: 641, height: 359 }
    await expect(manager.load('vp9', track, capabilities())).rejects.toMatchObject({ code: ErrorCodes.WASM_REVIEW_REQUIRED })
    expect(fetcher).not.toHaveBeenCalled()
    manager.close()
  })
})

interface CapturedFrame { readonly bytes: Uint8Array; readonly init: VideoFrameBufferInit }

function captureFactory(frames: CapturedFrame[]): MxwfFrameFactory {
  return { create(data, init) { frames.push({ bytes: Uint8Array.from(data), init }); return { close: vi.fn() } as unknown as VideoFrame } }
}

async function readVideoPackets(demuxer: { next(): Promise<DemuxPacket[]> }): Promise<DemuxPacket[]> {
  const packets: DemuxPacket[] = []
  while (true) {
    const batch = await demuxer.next()
    if (batch.length === 0) return packets
    packets.push(...batch.filter((packet) => packet.kind === 'video'))
  }
}

function capabilities(): CapabilitySnapshot {
  return {
    schemaVersion: 1, browser: { engine: 'unknown', name: 'unknown', version: '0', os: 'unknown' }, secureContext: true,
    crossOriginIsolated: false, sharedArrayBuffer: false, worker: true, offscreenCanvas: false, webAssembly: true, wasmSimd: false, wasmThreads: false,
    webCodecs: { videoDecoder: false, audioDecoder: false, encodedVideoChunk: false, encodedAudioChunk: false }, webGpu: { available: false, externalTexture: false }, webGl2: false, canvas2d: true,
    mediaSource: { available: false, workerHandle: false, managed: false }, native: { hls: false, pictureInPicture: false, airPlay: false, remotePlayback: false }, diagnostics: [],
  }
}
