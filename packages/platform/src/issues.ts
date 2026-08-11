import type { BackendCandidate, CapabilitySnapshot, PlaybackIntent } from '@mx-player-max/types'
import type { PlatformIssueRule } from './contracts'

export const BUILT_IN_PLATFORM_ISSUES: readonly PlatformIssueRule[] = [{
  id: 'firefox-1918769-h264-webcodecs-configure',
  browser: 'gecko',
  versions: { minInclusive: '130', maxExclusive: '146' },
  issueUrl: 'https://bugzilla.mozilla.org/show_bug.cgi?id=1918769',
  expiresOn: '2027-03-31',
  testSample: 'packages/platform/tests/fixtures/firefox-h264.ts#firefox-h264-webcodecs-configure-failure',
  scoreDelta: -100,
  match: {
    candidateKinds: ['webcodecs'],
    videoCodecPrefixes: ['avc1', 'avc3'],
  },
}]

export function normalizePlatformIssueRules(
  rules: readonly PlatformIssueRule[],
): readonly PlatformIssueRule[] {
  return rules.filter(isValidPlatformIssueRule).map(cloneIssueRule)
}

export function matchesPlatformIssue(
  rule: PlatformIssueRule,
  capabilities: CapabilitySnapshot,
  candidate: BackendCandidate,
  intent: PlaybackIntent,
  now: Date,
): boolean {
  if (rule.browser !== capabilities.browser || capabilities.browserVersion === null) return false
  if (!isVersionInRange(capabilities.browserVersion, rule.versions)) return false
  const expiry = parseIsoDate(rule.expiresOn)
  if (expiry === null || startOfUtcDay(now).getTime() > expiry.getTime()) return false
  if (!matchesOptionalValue(candidate.kind, rule.match.candidateKinds)) return false
  if (!matchesOptionalValue(candidate.renderer, rule.match.renderers)) return false
  if (!matchesOptionalValue(intent, rule.match.intents)) return false
  if (!matchesCodec(candidate.videoCodec, rule.match.videoCodecPrefixes)) return false
  return matchesCodec(candidate.audioCodec, rule.match.audioCodecPrefixes)
}

function isValidPlatformIssueRule(rule: PlatformIssueRule): boolean {
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(rule.id)) return false
  if (!isHttpsUrl(rule.issueUrl)) return false
  if (parseIsoDate(rule.expiresOn) === null) return false
  if (rule.testSample.length === 0 || rule.testSample.length > 256) return false
  if (!Number.isFinite(rule.scoreDelta) || rule.scoreDelta >= 0 || rule.scoreDelta < -1000) return false
  if (!isVersion(rule.versions.minInclusive) || !isVersion(rule.versions.maxExclusive)) return false
  if (rule.versions.minInclusive !== undefined && rule.versions.maxExclusive !== undefined
    && compareVersions(rule.versions.minInclusive, rule.versions.maxExclusive) >= 0) return false
  return true
}

function cloneIssueRule(rule: PlatformIssueRule): PlatformIssueRule {
  return {
    ...rule,
    versions: { ...rule.versions },
    match: {
      ...(rule.match.candidateKinds ? { candidateKinds: [...rule.match.candidateKinds] } : {}),
      ...(rule.match.renderers ? { renderers: [...rule.match.renderers] } : {}),
      ...(rule.match.videoCodecPrefixes ? { videoCodecPrefixes: [...rule.match.videoCodecPrefixes] } : {}),
      ...(rule.match.audioCodecPrefixes ? { audioCodecPrefixes: [...rule.match.audioCodecPrefixes] } : {}),
      ...(rule.match.intents ? { intents: [...rule.match.intents] } : {}),
    },
  }
}

function isVersion(value: string | undefined): boolean {
  return value === undefined || /^\d+(?:\.\d+){0,3}$/.test(value)
}

function isVersionInRange(version: string, range: PlatformIssueRule['versions']): boolean {
  if (!isVersion(version)) return false
  if (range.minInclusive !== undefined && compareVersions(version, range.minInclusive) < 0) return false
  if (range.maxExclusive !== undefined && compareVersions(version, range.maxExclusive) >= 0) return false
  return true
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (delta !== 0) return delta
  }
  return 0
}

function matchesOptionalValue<T>(value: T, allowed: readonly T[] | undefined): boolean {
  return allowed === undefined || allowed.includes(value)
}

function matchesCodec(codec: string | null, prefixes: readonly string[] | undefined): boolean {
  if (prefixes === undefined) return true
  if (codec === null) return false
  const normalized = codec.toLowerCase()
  return prefixes.some((prefix) => normalized.startsWith(prefix.toLowerCase()))
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? null : parsed
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
}
