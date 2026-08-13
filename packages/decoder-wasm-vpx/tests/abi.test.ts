import { describe, expect, it, vi } from 'vitest'
import { ErrorCodes } from '@mx-player-max/types'
import { createVideoFrameFromMxwf, readMxwfFrameDescriptor, type MxwfFrameFactory } from '../src/index'

describe('MXWF frame ABI v1', () => {
  it('preserves non-16-aligned I420 stride, color, visible and display metadata', () => {
    const fixture = descriptor()
    const create = vi.fn((_data: Uint8Array, init: VideoFrameBufferInit) => ({ close: vi.fn(), ...init }) as unknown as VideoFrame)
    const release = vi.fn()
    const frame = createVideoFrameFromMxwf(fixture.memory, fixture.pointer, release, { create })
    expect(frame).toBeDefined()
    expect(create).toHaveBeenCalledWith(expect.any(Uint8Array), expect.objectContaining({
      format: 'I420', codedWidth: 642, codedHeight: 358, displayWidth: 642, displayHeight: 358,
      timestamp: 4_294_967_301, duration: 33_366,
      visibleRect: { x: 0, y: 0, width: 642, height: 358 },
      colorSpace: { primaries: 'smpte170m', transfer: 'smpte170m', matrix: 'smpte170m', fullRange: false },
      layout: [{ offset: 0, stride: 656 }, { offset: 234_848, stride: 336 }, { offset: 294_992, stride: 336 }],
    }))
    expect(release).toHaveBeenCalledExactlyOnceWith(7)
  })

  it('releases a token exactly once when VideoFrame construction fails', () => {
    const fixture = descriptor()
    const release = vi.fn()
    const factory: MxwfFrameFactory = { create() { throw new Error('private constructor failure') } }
    expect(() => createVideoFrameFromMxwf(fixture.memory, fixture.pointer, release, factory)).toThrow('private constructor failure')
    expect(release).toHaveBeenCalledExactlyOnceWith(7)
  })

  it.each([
    ['magic', 0, 0],
    ['pixel format', 16, 2],
    ['plane count', 88, 2],
    ['reserved', 156, 1],
    ['color enum', 72, 99],
    ['overlapping plane', 116, 1024],
  ])('rejects malformed %s before constructing a frame', (_name, byteOffset, value) => {
    const fixture = descriptor()
    new DataView(fixture.memory.buffer).setUint32(fixture.pointer + byteOffset, value, true)
    expect(() => readMxwfFrameDescriptor(fixture.memory, fixture.pointer)).toThrowError(expect.objectContaining({ code: ErrorCodes.WASM_FRAME_ABI_INVALID }))
  })
})

function descriptor(): { memory: WebAssembly.Memory; pointer: number } {
  const memory = new WebAssembly.Memory({ initial: 8 })
  const pointer = 256
  const view = new DataView(memory.buffer, pointer, 160)
  const fields = [
    0x4d585746, 1, 160, 7, 1, 1, 642, 358, 0, 0, 642, 358, 642, 358,
    5, 1, 33_366, 0, 3, 2, 4, 1, 3, 0,
  ]
  fields.forEach((value, index) => view.setUint32(index * 4, value, true))
  writePlane(view, 96, 1024, 656, 358, 642, 234_848)
  writePlane(view, 116, 235_872, 336, 179, 321, 60_144)
  writePlane(view, 136, 296_016, 336, 179, 321, 60_144)
  view.setUint32(156, 0, true)
  return { memory, pointer }
}

function writePlane(view: DataView, offset: number, pointer: number, stride: number, rows: number, rowBytes: number, length: number): void {
  ;[pointer, stride, rows, rowBytes, length].forEach((value, index) => view.setUint32(offset + index * 4, value, true))
}
