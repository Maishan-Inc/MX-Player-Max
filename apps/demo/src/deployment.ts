export const REPOSITORY_URL = 'https://github.com/Maishan-Inc/MX-Player-Max'

export function resolveDefaultMediaUrl(baseUrl: string, pageUrl: string): string {
  return new URL('flower.webm', new URL(baseUrl, pageUrl)).href
}

/** Where `pnpm build:pages` publishes the Browser SDK bundle next to the Demo. */
export function resolveSdkBaseUrl(baseUrl: string, pageUrl: string): string {
  return new URL('sdk/', new URL(baseUrl, pageUrl)).href
}

/**
 * Root the engine resolves AI model paths against, served by the dev/preview middleware out of
 * `packages/postprocess/assets`. `undefined` on the Pages build: `prepare-pages.mjs` rejects
 * `.mxai` by design, and pointing the engine at a root that 404s would advertise the AI toggles
 * as available and then fail on the first click, instead of reporting `model-unavailable`.
 */
export function resolveAiModelBaseUrl(mode: string, pageUrl: string): string | undefined {
  if (mode === 'pages') return undefined
  return new URL('/models/', pageUrl).href
}

export function displayBuildVersion(value: string | undefined): string {
  const normalized = value?.trim()
  return normalized ? normalized.slice(0, 64) : 'dev'
}
