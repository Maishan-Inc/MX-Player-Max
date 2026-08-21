export const REPOSITORY_URL = 'https://github.com/Maishan-Inc/MX-Player-Max'

export function resolveDefaultMediaUrl(baseUrl: string, pageUrl: string): string {
  return new URL('flower.webm', new URL(baseUrl, pageUrl)).href
}

/** Where `pnpm build:pages` publishes the Browser SDK bundle next to the Demo. */
export function resolveSdkBaseUrl(baseUrl: string, pageUrl: string): string {
  return new URL('sdk/', new URL(baseUrl, pageUrl)).href
}

export function displayBuildVersion(value: string | undefined): string {
  const normalized = value?.trim()
  return normalized ? normalized.slice(0, 64) : 'dev'
}
