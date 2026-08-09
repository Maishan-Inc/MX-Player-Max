// @vitest-environment happy-dom

import { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlayerUiController } from '@mx-player-max/ui'
import { MXPlayer, type MXPlayerComponentHandle } from '../src/index'

const mocks = vi.hoisted(() => ({
  constructed: vi.fn(),
  load: vi.fn(),
  attach: vi.fn(),
  update: vi.fn(),
  lifecycle: [] as string[],
  players: [] as object[],
  controllers: [] as PlayerUiController[],
}))

vi.mock('@mx-player-max/sdk', () => ({
  MXPlayer: class FakeSdkPlayer {
    readonly ready = Promise.resolve()

    constructor(options: unknown) {
      mocks.constructed(options)
      mocks.players.push(this)
    }

    load(options: unknown): Promise<void> {
      mocks.load(options)
      return Promise.resolve()
    }

    destroy(): void { mocks.lifecycle.push('player') }
  },
}))

vi.mock('@mx-player-max/ui', () => ({
  attachPlayerUi: (player: object, host: HTMLElement, options: unknown): PlayerUiController => {
    const controller: PlayerUiController = {
      attached: true,
      attach: vi.fn(),
      update: (next): void => { mocks.update(next) },
      destroy: (): void => { mocks.lifecycle.push('ui') },
    }
    mocks.attach(player, host, options)
    mocks.controllers.push(controller)
    return controller
  },
}))

beforeEach(() => {
  mocks.constructed.mockClear()
  mocks.load.mockClear()
  mocks.attach.mockClear()
  mocks.update.mockClear()
  mocks.lifecycle.length = 0
  mocks.players.length = 0
  mocks.controllers.length = 0
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => { document.body.replaceChildren() })

describe('@mx-player-max/react thin adapter', () => {
  it('mounts SDK and UI once, forwards updates, and tears UI down first', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const handle = createRef<MXPlayerComponentHandle>()
    const firstPlayer = { source: { kind: 'url' as const, url: 'https://media.test/first.webm' } }
    const firstUi = { theme: 'dark' as const }

    await act(async () => { root.render(<MXPlayer ref={handle} className="adapter-host" playerOptions={firstPlayer} uiOptions={firstUi} />) })

    const host = container.querySelector<HTMLElement>('.adapter-host')
    expect(host).not.toBeNull()
    expect(mocks.constructed).toHaveBeenCalledWith(expect.objectContaining({ ...firstPlayer, target: host }))
    expect(mocks.attach).toHaveBeenCalledWith(mocks.players[0], host, firstUi)
    expect(handle.current?.player).toBe(mocks.players[0])
    expect(handle.current?.ui).toBe(mocks.controllers[0])

    const secondPlayer = { source: { kind: 'url' as const, url: 'https://media.test/second.webm' } }
    const secondUi = { theme: 'light' as const }
    await act(async () => { root.render(<MXPlayer ref={handle} className="adapter-host" playerOptions={secondPlayer} uiOptions={secondUi} />) })
    expect(mocks.load).toHaveBeenCalledWith(expect.objectContaining({ ...secondPlayer, target: host }))
    expect(mocks.update).toHaveBeenCalledWith(secondUi)

    await act(async () => { root.unmount() })
    expect(mocks.lifecycle).toEqual(['ui', 'player'])
    expect(handle.current).toBeNull()
  })
})
