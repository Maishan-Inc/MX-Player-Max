import { describe, expect, it } from 'vitest'
import { displayBuildVersion, REPOSITORY_URL, resolveDefaultMediaUrl, resolveSdkBaseUrl } from './deployment'

describe('Demo deployment helpers', () => {
  it('resolves the default media below the active Vite base', () => {
    expect(resolveDefaultMediaUrl('./', 'https://maishan-inc.github.io/MX-Player-Max/'))
      .toBe('https://maishan-inc.github.io/MX-Player-Max/flower.webm')
    expect(resolveDefaultMediaUrl('/', 'http://127.0.0.1:4173/MX-Player-Max/'))
      .toBe('http://127.0.0.1:4173/flower.webm')
    expect(resolveSdkBaseUrl('./', 'https://maishan-inc.github.io/MX-Player-Max/'))
      .toBe('https://maishan-inc.github.io/MX-Player-Max/sdk/')
  })

  it('uses a stable development fallback for missing build versions', () => {
    expect(displayBuildVersion(undefined)).toBe('dev')
    expect(displayBuildVersion('  ')).toBe('dev')
    expect(displayBuildVersion(' 1.2.3 ')).toBe('1.2.3')
  })

  it('links to the actual repository', () => {
    expect(REPOSITORY_URL).toBe('https://github.com/Maishan-Inc/MX-Player-Max')
  })
})
