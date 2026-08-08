export interface PackedTexture {
  readonly texture: GPUTexture
  readonly width: number
  readonly height: number
  readonly channels: number
  readonly groups: number
  readonly release: () => void
}

interface Slot {
  texture: GPUTexture
  width: number
  height: number
  groups: number
  inUse: boolean
}

/** Bounded pool for rgba16float array textures used by model activations. */
export class PackedTexturePool {
  readonly #device: GPUDevice
  readonly #capacity: number
  readonly #usage: GPUTextureUsageFlags
  readonly #slots: Slot[] = []
  #closed = false

  constructor(device: GPUDevice, capacity = 32) {
    if (!Number.isSafeInteger(capacity) || capacity < 4 || capacity > 128) throw new Error('Packed texture pool capacity must be in [4, 128]')
    this.#device = device
    this.#capacity = capacity
    this.#usage = packedTextureUsage()
  }

  acquire(width: number, height: number, channels: number): PackedTexture {
    if (this.#closed) throw new Error('Packed texture pool is closed')
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || !Number.isSafeInteger(channels) || channels <= 0 || channels > 1024) throw new Error('Invalid packed tensor dimensions')
    const groups = Math.ceil(channels / 4)
    const reusable = this.#slots.find((slot) => !slot.inUse && slot.width === width && slot.height === height && slot.groups === groups)
    const slot = reusable ?? this.#create(width, height, groups)
    slot.inUse = true
    let released = false
    return {
      texture: slot.texture, width, height, channels, groups,
      release: () => {
        if (released) return
        released = true
        if (!this.#closed) slot.inUse = false
      },
    }
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    for (const slot of this.#slots) {
      try { slot.texture.destroy() } catch { /* best effort */ }
    }
    this.#slots.length = 0
  }

  #create(width: number, height: number, groups: number): Slot {
    if (this.#slots.length >= this.#capacity) throw new Error('Packed texture pool capacity exceeded')
    const texture = this.#device.createTexture({
      size: { width, height, depthOrArrayLayers: groups },
      format: 'rgba16float',
      dimension: '2d',
      usage: this.#usage,
    })
    const slot = { texture, width, height, groups, inUse: false }
    this.#slots.push(slot)
    return slot
  }
}

function packedTextureUsage(): GPUTextureUsageFlags {
  const usage = (globalThis as typeof globalThis & { GPUTextureUsage?: Record<string, number> }).GPUTextureUsage
  if (usage) return (usage.TEXTURE_BINDING ?? 0) | (usage.STORAGE_BINDING ?? 0) | (usage.COPY_SRC ?? 0) | (usage.COPY_DST ?? 0)
  return 0x04 | 0x08 | 0x01 | 0x02
}

