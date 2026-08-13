export interface TexturePoolOptions {
  readonly device: GPUDevice
  readonly format?: GPUTextureFormat
  readonly usage?: GPUTextureUsageFlags
  readonly capacity?: number
}

export interface PooledTexture {
  readonly texture: GPUTexture
  readonly width: number
  readonly height: number
  readonly release: () => void
}

interface Slot {
  texture: GPUTexture
  width: number
  height: number
  inUse: boolean
}

const DEFAULT_USAGE: GPUTextureUsageFlags = runtimeTextureUsage()

export class TexturePool {
  readonly #device: GPUDevice
  readonly #format: GPUTextureFormat
  readonly #usage: GPUTextureUsageFlags
  readonly #capacity: number
  readonly #slots: Slot[] = []
  #closed = false

  constructor(options: TexturePoolOptions) {
    if (!Number.isSafeInteger(options.capacity ?? 4) || (options.capacity ?? 4) < 1 || (options.capacity ?? 4) > 64) throw new Error('Texture pool capacity must be an integer in [1, 64]')
    this.#device = options.device
    this.#format = options.format ?? 'rgba8unorm'
    this.#usage = options.usage ?? DEFAULT_USAGE
    this.#capacity = options.capacity ?? 4
  }

  get capacity(): number { return this.#capacity }
  get allocated(): number { return this.#slots.length }
  get inUse(): number { return this.#slots.filter((slot) => slot.inUse).length }

  acquire(width: number, height: number): PooledTexture {
    if (this.#closed) throw new Error('Texture pool is closed')
    validateSize(width, height)
    const reusable = this.#slots.find((slot) => !slot.inUse && slot.width === width && slot.height === height)
    const slot = reusable ?? this.#createSlot(width, height)
    slot.inUse = true
    let released = false
    return {
      texture: slot.texture,
      width,
      height,
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

  #createSlot(width: number, height: number): Slot {
    if (this.#slots.length >= this.#capacity) throw new Error('Texture pool capacity exceeded')
    const texture = this.#device.createTexture({
      size: { width, height, depthOrArrayLayers: 1 },
      format: this.#format,
      usage: this.#usage,
    })
    const slot: Slot = { texture, width, height, inUse: false }
    this.#slots.push(slot)
    return slot
  }
}

function validateSize(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) throw new Error('Texture dimensions must be positive safe integers')
}

function runtimeTextureUsage(): GPUTextureUsageFlags {
  const usage = (globalThis as typeof globalThis & { GPUTextureUsage?: Record<string, number> }).GPUTextureUsage
  if (usage) return (usage.TEXTURE_BINDING ?? 0) | (usage.STORAGE_BINDING ?? 0) | (usage.COPY_DST ?? 0) | (usage.COPY_SRC ?? 0)
  /* WebGPU enum values from the specification, for Node/fake-GPU imports. */
  return 0x04 | 0x08 | 0x02 | 0x01
}
