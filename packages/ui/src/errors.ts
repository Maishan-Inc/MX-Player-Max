import { PlayerUiError, UiErrorCodes, type PlayerUiErrorSummary } from './contracts'

export { PlayerUiError, UiErrorCodes }
export type { PlayerUiErrorSummary }

export function safeUiError(code: PlayerUiErrorSummary['code'], recoverable = true): PlayerUiError {
  return new PlayerUiError(code, 'The player interface operation could not be completed', recoverable)
}
