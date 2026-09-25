import { detectCapabilities } from '@mx-player-max/capabilities'
import { FileRangeLoader, probeContainer, type Demuxer } from '@mx-player-max/demux'
import {
  WorkerLibvpxVp9DecoderAdapter,
  createLibvpxVp9VideoDecoderConfig,
} from '@mx-player-max/decoder-wasm-vpx'
import type { DemuxPacket } from '@mx-player-max/types'

export interface Vp9Probe {
  readonly videoFrame: boolean
  readonly i420p10: boolean
  readonly worker: boolean
  readonly isolated: boolean
  readonly userAgent: string
}

export interface Vp9BrowserResult {
  readonly userAgent: string
  readonly fixtureSha256: string
  readonly trackCodec: string
  readonly decodedFrames: number
  readonly lastEpoch: number
  readonly resetEpochs: readonly number[]
  readonly staleFramesDelivered: number
  readonly errors: readonly string[]
  readonly output: {
    readonly format: string | null
    readonly codedWidth: number
    readonly codedHeight: number
    readonly visibleWidth: number
    readonly visibleHeight: number
    readonly timestamp: number
    readonly byteLength: number
    readonly nonzeroBytes: number
    readonly maxLumaSample: number
  }
}

declare global {
  interface Window {
    __vp9Acceptance: {
      probe(): Vp9Probe
      run(): Promise<Vp9BrowserResult>
    }
  }
}

window.__vp9Acceptance = { probe, run }

function probe(): Vp9Probe {
  let i420p10 = false
  if (typeof VideoFrame === 'function') {
    try {
      const frame = new VideoFrame(new Uint8Array(12), {
        format: 'I420P10' as VideoPixelFormat, codedWidth: 2, codedHeight: 2, timestamp: 0,
      })
      i420p10 = String(frame.format) === 'I420P10'
      frame.close()
    } catch { /* Report the missing browser capability without treating it as a decoder failure. */ }
  }
  return {
    videoFrame: typeof VideoFrame === 'function', i420p10, worker: typeof Worker === 'function',
    isolated: crossOriginIsolated, userAgent: navigator.userAgent,
  }
}

async function run(): Promise<Vp9BrowserResult> {
  const response = await fetch('/fixture/vp9-p2.webm')
  if (!response.ok) throw new Error(`VP9 fixture HTTP ${response.status}`)
  const fixtureBytes = await response.arrayBuffer()
  const fixtureSha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', fixtureBytes)))
    .map((byte) => byte.toString(16).padStart(2, '0')).join('')
  if (fixtureSha256 !== '09ba8a0c2c2b07f42a1a0fc26af56f13d758893c65dabf2fc750037dba92741d') {
    throw new Error('The VP9 browser fixture hash does not match its provenance')
  }
  const loader = new FileRangeLoader(new File([fixtureBytes], 'vp9-p2.webm', { type: 'video/webm' }))
  const selection = await probeContainer(loader)
  const track = selection.metadata.tracks.find((candidate) => candidate.kind === 'video')
  if (!track?.codec) throw new Error('VP9 video track or codec is missing')
  const capabilities = await detectCapabilities({ forceRefresh: true })
  const errors: string[] = []
  const copied: Promise<void>[] = []
  let decodedFrames = 0
  let lastEpoch = -1
  const resetEpochs: number[] = []
  let minimumAllowedEpoch = 0
  let staleFramesDelivered = 0
  let output: Vp9BrowserResult['output'] | null = null
  const adapter = new WorkerLibvpxVp9DecoderAdapter({
    baseUrl: new URL('/wasm/', location.href).href,
    track,
    capabilities,
    transportFactory: () => new Worker(new URL('./worker-entry.ts', import.meta.url), { type: 'module', name: 'mxp-restricted-vp9-acceptance' }),
    callbacks: {
      onFrame(frame, epoch) {
        decodedFrames += 1
        lastEpoch = epoch
        if (epoch < minimumAllowedEpoch) staleFramesDelivered += 1
        if (epoch === 3 && frame.timestamp >= 400_000 && output === null && copied.length === 0) {
          copied.push(copyFrame(frame).then((summary) => { output = summary }).finally(() => frame.close()))
        } else {
          frame.close()
        }
      },
      onError(error, epoch) { errors.push(`${epoch}:${error.code}`) },
      onDequeue() { /* The final queue size is checked after flush. */ },
    },
  })
  try {
    await adapter.configure(createLibvpxVp9VideoDecoderConfig(track), false, 0)
    // Queue old work before each reset. The Worker may finish it at any point; the main adapter
    // must close responses from an older epoch after the new seek has started.
    for (const [index, target] of [200_000, 700_000, 400_000].entries()) {
      const epoch = index + 1
      minimumAllowedEpoch = epoch
      await adapter.reset(epoch)
      resetEpochs.push(epoch)
      await selection.demuxer.seek(target)
      await decodeThrough(selection.demuxer, adapter, epoch, target + 67_000)
      if (epoch === 3) await adapter.flush(epoch)
    }
    await Promise.all(copied)
    if (output === null) throw new Error('The VP9 Worker produced no transferable 10-bit VideoFrame')
    if (adapter.decodeQueueSize !== 0) throw new Error(`VP9 decode queue retained ${adapter.decodeQueueSize} packets`)
    return {
      userAgent: navigator.userAgent,
      fixtureSha256,
      trackCodec: track.codec,
      decodedFrames,
      lastEpoch,
      resetEpochs,
      staleFramesDelivered,
      errors,
      output,
    }
  } finally {
    adapter.close()
    selection.demuxer.close()
    loader.close()
  }
}

async function decodeThrough(
  demuxer: Demuxer,
  adapter: WorkerLibvpxVp9DecoderAdapter,
  epoch: number,
  until: number,
): Promise<void> {
  let sent = 0
  while (sent < 64) {
    const batch = await demuxer.next()
    if (batch.length === 0) break
    for (const packet of batch) {
      if (packet.kind !== 'video') continue
      adapter.decode(packet as DemuxPacket, epoch)
      sent += 1
      if (packet.timestamp >= until) return
    }
  }
  if (sent === 0) throw new Error('VP9 seek returned no video packets')
}

async function copyFrame(frame: VideoFrame): Promise<Vp9BrowserResult['output']> {
  const visibleRect = frame.visibleRect
  if (visibleRect === null) throw new Error('The VP9 frame has no visible rectangle')
  const bytes = new Uint8Array(frame.allocationSize())
  await frame.copyTo(bytes)
  const view = new DataView(bytes.buffer)
  let maxLumaSample = 0
  const lumaSamples = Math.min(frame.codedWidth * frame.codedHeight, Math.floor(bytes.byteLength / 2))
  for (let index = 0; index < lumaSamples; index += 1) {
    maxLumaSample = Math.max(maxLumaSample, view.getUint16(index * 2, true))
  }
  return {
    format: frame.format,
    codedWidth: frame.codedWidth,
    codedHeight: frame.codedHeight,
    visibleWidth: visibleRect.width,
    visibleHeight: visibleRect.height,
    timestamp: frame.timestamp,
    byteLength: bytes.byteLength,
    nonzeroBytes: bytes.reduce((count, value) => count + (value === 0 ? 0 : 1), 0),
    maxLumaSample,
  }
}
