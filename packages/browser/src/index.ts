import { MXPlayer } from '@mx-player-max/sdk'
import type { MXPlayerOptions } from '@mx-player-max/types'
import { attachPlayerUi, createPlayerUi } from '@mx-player-max/ui'
import type { PlayerUiController, PlayerUiOptions } from '@mx-player-max/ui'

export { MXPlayer, attachPlayerUi }
export type { MXPlayerOptions } from '@mx-player-max/types'
export type { PlayerUiController, PlayerUiOptions } from '@mx-player-max/ui'

export const BrowserErrorCodes = {
  BROWSER_INVALID_TARGET: 'BROWSER_INVALID_TARGET',
  BROWSER_INVALID_OPTIONS: 'BROWSER_INVALID_OPTIONS',
  BROWSER_SDK_CREATE_FAILED: 'BROWSER_SDK_CREATE_FAILED',
  BROWSER_UI_MOUNT_FAILED: 'BROWSER_UI_MOUNT_FAILED',
  BROWSER_DESTROYED: 'BROWSER_DESTROYED',
} as const

export type BrowserErrorCode = (typeof BrowserErrorCodes)[keyof typeof BrowserErrorCodes]

export class BrowserPlayerError extends Error {
  readonly code: BrowserErrorCode
  readonly recoverable: boolean
  override readonly cause: unknown

  constructor(code: BrowserErrorCode, message: string, recoverable = false, cause?: unknown) {
    super(message)
    this.name = 'BrowserPlayerError'
    this.code = code
    this.recoverable = recoverable
    this.cause = cause
  }
}

export interface BrowserPlayerOptions extends MXPlayerOptions {
  readonly ui?: PlayerUiOptions
}

export type BrowserPlayerLoadOptions = Omit<MXPlayerOptions, 'target'>

export interface BrowserPlayerHandle {
  readonly player: MXPlayer
  readonly ui: PlayerUiController
  readonly ready: Promise<void>
  load(options: BrowserPlayerLoadOptions): Promise<void>
  destroy(): void
}

class BrowserPlayerHandleImpl implements BrowserPlayerHandle {
  readonly player: MXPlayer
  readonly ui: PlayerUiController
  readonly #host: HTMLElement
  #ready: Promise<void>
  #loadId = 0
  #destroyed = false

  constructor(player: MXPlayer, ui: PlayerUiController, host: HTMLElement) {
    this.player = player
    this.ui = ui
    this.#host = host
    this.#ready = this.#trackLoad(player.ready)
  }

  get ready(): Promise<void> { return this.#ready }

  load(options: BrowserPlayerLoadOptions): Promise<void> {
    if (this.#destroyed) {
      return Promise.reject(new BrowserPlayerError(
        BrowserErrorCodes.BROWSER_DESTROYED,
        'The Browser player has been destroyed',
      ))
    }
    validateLoadOptions(options)
    try {
      return this.#trackLoad(this.player.load({ ...options, target: this.#host }))
    } catch (cause) {
      this.destroy()
      throw cause
    }
  }

  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    this.#loadId += 1
    try {
      this.ui.destroy()
    } finally {
      this.player.destroy()
    }
  }

  #trackLoad(load: Promise<void>): Promise<void> {
    const loadId = ++this.#loadId
    const tracked = Promise.resolve(load).catch((cause: unknown): never => {
      if (!this.#destroyed && loadId === this.#loadId) this.destroy()
      throw cause
    })
    this.#ready = tracked
    return tracked
  }
}

export function create(options: BrowserPlayerOptions): BrowserPlayerHandle {
  validateCreateOptions(options)
  const host = resolveHost(options.target)
  const { ui: uiOptions, ...sdkOptions } = options

  let player: MXPlayer
  try {
    player = new MXPlayer({ ...sdkOptions, target: host })
  } catch (cause) {
    throw new BrowserPlayerError(
      BrowserErrorCodes.BROWSER_SDK_CREATE_FAILED,
      'The SDK player could not be created',
      false,
      cause,
    )
  }

  let ui: PlayerUiController
  try {
    ui = createPlayerUi(player, uiOptions)
  } catch (cause) {
    cleanupPlayerAfterSetupFailure(player)
    throw new BrowserPlayerError(
      BrowserErrorCodes.BROWSER_UI_MOUNT_FAILED,
      'The player UI controller could not be created',
      false,
      cause,
    )
  }
  try {
    ui.attach(host)
  } catch (cause) {
    try { ui.destroy() } catch { /* Preserve the mount failure. */ }
    cleanupPlayerAfterSetupFailure(player)
    throw new BrowserPlayerError(
      BrowserErrorCodes.BROWSER_UI_MOUNT_FAILED,
      'The player UI could not be mounted',
      false,
      cause,
    )
  }

  return new BrowserPlayerHandleImpl(player, ui, host)
}

function validateCreateOptions(options: BrowserPlayerOptions): void {
  if (!isRecord(options) || !isRecord(options.source)) {
    throw new BrowserPlayerError(
      BrowserErrorCodes.BROWSER_INVALID_OPTIONS,
      'Browser player options and source are required',
    )
  }
  if (options.ui !== undefined && !isRecord(options.ui)) {
    throw new BrowserPlayerError(
      BrowserErrorCodes.BROWSER_INVALID_OPTIONS,
      'Browser UI options must be an object',
    )
  }
}

function validateLoadOptions(options: BrowserPlayerLoadOptions): void {
  if (!isRecord(options) || !isRecord(options.source) || 'target' in options || 'ui' in options) {
    throw new BrowserPlayerError(
      BrowserErrorCodes.BROWSER_INVALID_OPTIONS,
      'Browser load options must contain a source and reuse the existing target',
    )
  }
}

function resolveHost(target: MXPlayerOptions['target']): HTMLElement {
  if (typeof target === 'string') {
    if (target.trim().length === 0 || typeof document === 'undefined') return invalidTarget()
    try {
      const element = document.querySelector(target)
      if (isHtmlElement(element)) return element
    } catch {
      return invalidTarget()
    }
    return invalidTarget()
  }
  if (isHtmlElement(target)) return target
  return invalidTarget()
}

function invalidTarget(): never {
  throw new BrowserPlayerError(
    BrowserErrorCodes.BROWSER_INVALID_TARGET,
    'Browser player target must resolve to an HTML element',
  )
}

function isHtmlElement(value: unknown): value is HTMLElement {
  if (typeof HTMLElement !== 'undefined' && value instanceof HTMLElement) return true
  return Boolean(value && typeof value === 'object' && typeof (value as { appendChild?: unknown }).appendChild === 'function')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cleanupPlayerAfterSetupFailure(player: MXPlayer): void {
  void player.ready.catch((): void => { /* Setup failure already owns the public error. */ })
  try { player.destroy() } catch { /* Preserve the Browser setup failure. */ }
}
