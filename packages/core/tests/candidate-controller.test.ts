import { describe, expect, it } from 'vitest'
import type { BackendCandidate } from '@mx-player-max/types'
import {
  AllCandidatesFailedError,
  runCandidateAttempts,
  type CandidateAttemptContext,
  type CandidateAttemptScope,
} from '../src/playback/candidate-controller'

const candidates: readonly BackendCandidate[] = [
  { id: 'native', kind: 'html-video', videoCodec: 'vp8', audioCodec: 'opus', renderer: 'native', score: 20, reasons: [], requires: [] },
  { id: 'custom', kind: 'webcodecs', videoCodec: 'vp8', audioCodec: 'opus', renderer: 'webgpu', score: 10, reasons: [], requires: [] },
]

describe('candidate controller', () => {
  it('disposes a failed scope before committing the next candidate', async () => {
    const log: string[] = []
    const contexts: CandidateAttemptContext[] = []
    const result = await runCandidateAttempts({
      candidates,
      isSessionActive: () => true,
      createInactiveError: () => new Error('inactive'),
      getErrorCode: (error) => error instanceof Error ? error.message : 'unknown',
      isRecoverable: () => true,
      createScope(candidate, context): CandidateAttemptScope<string> {
        contexts.push(context)
        return {
          async initialize() {
            log.push(`initialize:${candidate.id}`)
            if (candidate.id === 'native') throw new Error('native-failed')
          },
          commit() {
            log.push(`commit:${candidate.id}`)
            return candidate.id
          },
          dispose() { log.push(`dispose:${candidate.id}`) },
        }
      },
    })

    expect(result.candidate.id).toBe('custom')
    expect(result.value).toBe('custom')
    expect(result.attempts).toEqual([
      { index: 0, candidateId: 'native', kind: 'html-video', status: 'failed', errorCode: 'native-failed' },
      { index: 1, candidateId: 'custom', kind: 'webcodecs', status: 'selected', errorCode: null },
    ])
    expect(log).toEqual(['initialize:native', 'dispose:native', 'initialize:custom', 'commit:custom'])
    expect(contexts[0]?.attemptId).not.toBe(contexts[1]?.attemptId)
    expect(contexts.every((context) => context.isActive() === false)).toBe(true)
  })

  it('stops after a non-recoverable error and preserves the original error', async () => {
    const original = new Error('fatal')
    const created: string[] = []
    await expect(runCandidateAttempts({
      candidates,
      isSessionActive: () => true,
      createInactiveError: () => new Error('inactive'),
      getErrorCode: () => 'FATAL',
      isRecoverable: () => false,
      createScope(candidate): CandidateAttemptScope<string> {
        created.push(candidate.id)
        return { initialize: async () => { throw original }, commit: () => candidate.id, dispose: () => undefined }
      },
    })).rejects.toBe(original)
    expect(created).toEqual(['native'])
  })

  it('does not start another candidate after the session becomes inactive', async () => {
    let active = true
    const created: string[] = []
    const inactive = new Error('inactive')
    await expect(runCandidateAttempts({
      candidates,
      isSessionActive: () => active,
      createInactiveError: () => inactive,
      getErrorCode: () => 'FAILED',
      isRecoverable: () => true,
      createScope(candidate): CandidateAttemptScope<string> {
        created.push(candidate.id)
        return {
          initialize: async () => { active = false; throw new Error('failed') },
          commit: () => candidate.id,
          dispose: () => undefined,
        }
      },
    })).rejects.toBe(inactive)
    expect(created).toEqual(['native'])
  })

  it('treats an aborted signal as an inactive run', async () => {
    const controller = new AbortController()
    controller.abort()
    const inactive = new Error('aborted')
    await expect(runCandidateAttempts({
      candidates,
      signal: controller.signal,
      isSessionActive: () => true,
      createInactiveError: () => inactive,
      getErrorCode: () => 'FAILED',
      isRecoverable: () => true,
      createScope(): CandidateAttemptScope<string> { throw new Error('must not create') },
    })).rejects.toBe(inactive)
  })

  it('does not let cleanup errors hide the candidate failure', async () => {
    const original = new Error('candidate-failed')
    await expect(runCandidateAttempts({
      candidates: candidates.slice(0, 1),
      isSessionActive: () => true,
      createInactiveError: () => new Error('inactive'),
      getErrorCode: () => 'CANDIDATE_FAILED',
      isRecoverable: () => false,
      createScope(): CandidateAttemptScope<string> {
        return {
          initialize: async () => { throw original },
          commit: () => 'never',
          dispose: () => { throw new Error('cleanup-failed') },
        }
      },
    })).rejects.toBe(original)
  })

  it('returns only sanitized failures when every candidate fails', async () => {
    const pending = runCandidateAttempts({
      candidates,
      isSessionActive: () => true,
      createInactiveError: () => new Error('inactive'),
      getErrorCode: (_error, candidate) => `${candidate.id.toUpperCase()}_FAILED`,
      isRecoverable: () => true,
      createScope(): CandidateAttemptScope<string> {
        return { initialize: async () => { throw new Error('secret stack and URL') }, commit: () => 'never', dispose: () => undefined }
      },
    })

    await expect(pending).rejects.toMatchObject({
      code: 'STRATEGY_ALL_CANDIDATES_FAILED',
      failures: [
        { candidateId: 'native', kind: 'html-video', errorCode: 'NATIVE_FAILED' },
        { candidateId: 'custom', kind: 'webcodecs', errorCode: 'CUSTOM_FAILED' },
      ],
    })
    try { await pending } catch (error) {
      expect(error).toBeInstanceOf(AllCandidatesFailedError)
      expect(JSON.stringify(error)).not.toContain('secret')
    }
  })
})
