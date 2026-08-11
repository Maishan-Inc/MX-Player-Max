// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MXPlayerOptions } from '@mx-player-max/types'

const mocks = vi.hoisted(() => ({
  initialReady: Promise.resolve(),
  nextLoad: Promise.resolve(),
  createUiError: null as Error | null,
  attachError: null as Error | null,
  lifecycle: [] as string[],
  players: [] as Array<{
    options: MXPlayerOptions
    ready: Promise<void>
    load: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
  }>,
  controllers: [] as Array<{
    attached: boolean
    attach: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
  }>,
}))

vi.mock('@mx-player-max/sdk', () => ({
  MXPlayer: class MockMXPlayer {
    readonly options: MXPlayerOptions
    readonly ready: Promise<void>
    readonly load = vi.fn((_options: MXPlayerOptions): Promise<void> => mocks.nextLoad)
    readonly destroy = vi.fn((): void => { mocks.lifecycle.push('sdk:destroy') })

    constructor(options: MXPlayerOptions) {
      this.options = options
      this.ready = mocks.initialReady
      mocks.players.push(this)
    }
  },
}))

vi.mock('@mx-player-max/ui', () => ({
  attachPlayerUi: vi.fn(),
  createPlayerUi: vi.fn(() => {
    if (mocks.createUiError) throw mocks.createUiError
    const controller = {
      attached: false,
      attach: vi.fn(function (this: { attached: boolean }, _host: HTMLElement): void {
        if (mocks.attachError) throw mocks.attachError
        this.attached = true
      }),
      update: vi.fn(),
      destroy: vi.fn(function (this: { attached: boolean }): void {
        this.attached = false
        mocks.lifecycle.push('ui:destroy')
      }),
    }
    mocks.controllers.push(controller)
    return controller
  }),
}))

import {
  attachPlayerUi,
  BrowserErrorCodes,
  BrowserPlayerError,
  create,
  MXPlayer,
} from '../src/index'

const source = { kind: 'url', url: 'https://example.test/media.mp4' } as const

beforeEach(() => {
  document.body.replaceChildren()
  vi.clearAllMocks()
  mocks.initialReady = Promise.resolve()
  mocks.nextLoad = Promise.resolve()
  mocks.createUiError = null
  mocks.attachError = null
  mocks.lifecycle.length = 0
  mocks.players.length = 0
  mocks.controllers.length = 0
})

describe('@mx-player-max/browser lifecycle', () => {
  it('creates the SDK and mounts one UI controller on the same resolved host', async () => {
    const host = document.createElement('div')
    host.id = 'player'
    document.body.append(host)

    const handle = create({ target: '#player', source, ui: { theme: 'dark' } })

    expect(handle.player).toBe(mocks.players[0])
    expect(handle.ui).toBe(mocks.controllers[0])
    expect(mocks.players[0]?.options.target).toBe(host)
    expect(mocks.controllers[0]?.attach).toHaveBeenCalledWith(host)
    await expect(handle.ready).resolves.toBeUndefined()
    expect(MXPlayer).toBeDefined()
    expect(attachPlayerUi).toBeDefined()
  })

  it('updates ready through load while reusing the host and UI controller', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const handle = create({ target: host, source })
    await handle.ready
    const controller = handle.ui
    let resolveLoad!: () => void
    mocks.nextLoad = new Promise<void>((resolve) => { resolveLoad = resolve })

    const loading = handle.load({ source: { kind: 'url', url: 'https://example.test/next.mp4' }, autoplay: true })

    expect(handle.ready).toBe(loading)
    expect(handle.ui).toBe(controller)
    expect(mocks.players[0]?.load).toHaveBeenCalledWith({
      target: host,
      source: { kind: 'url', url: 'https://example.test/next.mp4' },
      autoplay: true,
    })
    resolveLoad()
    await expect(loading).resolves.toBeUndefined()
  })

  it('destroys UI before SDK and remains idempotent', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const handle = create({ target: host, source })

    handle.destroy()
    handle.destroy()

    expect(mocks.lifecycle).toEqual(['ui:destroy', 'sdk:destroy'])
    expect(mocks.controllers[0]?.destroy).toHaveBeenCalledOnce()
    expect(mocks.players[0]?.destroy).toHaveBeenCalledOnce()
  })

  it('destroys the partial UI and SDK when UI mounting fails', () => {
    const host = document.createElement('div')
    document.body.append(host)
    mocks.attachError = new Error('mount failed')

    expect(() => create({ target: host, source })).toThrowError(
      expect.objectContaining({ code: BrowserErrorCodes.BROWSER_UI_MOUNT_FAILED }),
    )
    expect(mocks.lifecycle).toEqual(['ui:destroy', 'sdk:destroy'])
  })

  it('destroys the SDK when the UI controller cannot be created', () => {
    const host = document.createElement('div')
    document.body.append(host)
    mocks.createUiError = new Error('controller failed')

    expect(() => create({ target: host, source })).toThrowError(
      expect.objectContaining({ code: BrowserErrorCodes.BROWSER_UI_MOUNT_FAILED }),
    )
    expect(mocks.lifecycle).toEqual(['sdk:destroy'])
  })

  it('preserves an SDK load error while removing UI subscriptions', async () => {
    const mediaError = Object.assign(new Error('unsupported media'), { code: 'NATIVE_NOT_SUPPORTED', recoverable: false })
    mocks.initialReady = Promise.reject(mediaError)
    const host = document.createElement('div')
    document.body.append(host)

    const handle = create({ target: host, source })

    await expect(handle.ready).rejects.toBe(mediaError)
    expect(mocks.lifecycle).toEqual(['ui:destroy', 'sdk:destroy'])
  })

  it('reports stable Browser errors for invalid targets and options', () => {
    expect(() => create({ target: '#missing', source })).toThrowError(
      expect.objectContaining({ code: BrowserErrorCodes.BROWSER_INVALID_TARGET }),
    )
    expect(() => create(null as unknown as MXPlayerOptions)).toThrowError(BrowserPlayerError)
    expect(() => create({ target: document.createElement('div'), source, ui: null } as never)).toThrowError(
      expect.objectContaining({ code: BrowserErrorCodes.BROWSER_INVALID_OPTIONS }),
    )
    expect(mocks.players).toHaveLength(0)
  })
})
