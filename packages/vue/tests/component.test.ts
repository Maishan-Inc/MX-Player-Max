// @vitest-environment happy-dom

import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlayerUiController } from '@mx-player-max/ui'
import { MXPlayer } from '../src/index'

const mocks = vi.hoisted(() => ({
  constructed: vi.fn(),
  load: vi.fn(),
  attach: vi.fn(),
  update: vi.fn(),
  lifecycle: [] as string[],
  players: [] as object[],
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
    mocks.attach(player, host, options)
    return {
      attached: true,
      attach: vi.fn(),
      update: (next): void => { mocks.update(next) },
      destroy: (): void => { mocks.lifecycle.push('ui') },
    }
  },
}))

beforeEach(() => {
  mocks.constructed.mockClear()
  mocks.load.mockClear()
  mocks.attach.mockClear()
  mocks.update.mockClear()
  mocks.lifecycle.length = 0
  mocks.players.length = 0
})

afterEach(() => { document.body.replaceChildren() })

describe('@mx-player-max/vue thin adapter', () => {
  it('mounts SDK and UI once, watches option identities, and tears UI down first', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const playerOptions = ref({ source: { kind: 'url' as const, url: 'https://media.test/first.webm' } })
    const uiOptions = ref({ theme: 'dark' as const })
    const Harness = defineComponent({
      setup: () => (): ReturnType<typeof h> => h(MXPlayer, {
        class: 'adapter-host',
        playerOptions: playerOptions.value,
        uiOptions: uiOptions.value,
      }),
    })
    const app = createApp(Harness)

    app.mount(container)
    await nextTick()
    const host = container.querySelector<HTMLElement>('.adapter-host')
    expect(host).not.toBeNull()
    expect(mocks.constructed).toHaveBeenCalledWith(expect.objectContaining({ ...playerOptions.value, target: host }))
    expect(mocks.attach).toHaveBeenCalledWith(mocks.players[0], host, uiOptions.value)

    playerOptions.value = { source: { kind: 'url', url: 'https://media.test/second.webm' } }
    uiOptions.value = { theme: 'light' }
    await nextTick()
    expect(mocks.load).toHaveBeenCalledWith(expect.objectContaining({ ...playerOptions.value, target: host }))
    expect(mocks.update).toHaveBeenCalledWith(uiOptions.value)

    app.unmount()
    expect(mocks.lifecycle).toEqual(['ui', 'player'])
  })
})
