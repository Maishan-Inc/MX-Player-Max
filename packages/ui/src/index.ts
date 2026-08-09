import type { MXPlayer } from '@mx-player-max/sdk'
import { PlayerUiControllerImpl } from './controller'
import type { PlayerUiController, PlayerUiOptions } from './contracts'

export type {
  NextEpisodeControlOptions,
  PlayerUiController,
  PlayerUiErrorCode,
  PlayerUiErrorSummary,
  PlayerUiFeatureOptions,
  PlayerUiLabels,
  PlayerUiOptions,
  TheaterModeAdapter,
} from './contracts'
export { DEFAULT_FEATURES, DEFAULT_LABELS, PlayerUiError, UiErrorCodes } from './contracts'

export function createPlayerUi(player: MXPlayer, options: PlayerUiOptions = {}): PlayerUiController {
  return new PlayerUiControllerImpl(player, options)
}

export function attachPlayerUi(player: MXPlayer, container: HTMLElement, options: PlayerUiOptions = {}): PlayerUiController {
  const controller = createPlayerUi(player, options)
  controller.attach(container)
  return controller
}
