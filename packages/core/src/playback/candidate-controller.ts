import { ErrorCodes } from '@mx-player-max/types'
import type {
  BackendCandidate,
  EngineError,
  PlaybackDecisionAttempt,
} from '@mx-player-max/types'

export interface CandidateAttemptContext {
  readonly index: number
  readonly attemptId: number
  isActive(): boolean
}

export interface CandidateAttemptScope<T> {
  initialize(): void | Promise<void>
  commit(): T | Promise<T>
  dispose(): void | Promise<void>
}

export interface CandidateFailure {
  readonly candidateId: string
  readonly kind: BackendCandidate['kind']
  readonly errorCode: string
}

export interface CandidateAttemptResult<T> {
  readonly candidate: BackendCandidate
  readonly value: T
  readonly attempts: readonly PlaybackDecisionAttempt[]
}

export interface CandidateControllerOptions<T> {
  readonly candidates: readonly Readonly<BackendCandidate>[]
  readonly signal?: AbortSignal
  isSessionActive(): boolean
  createInactiveError(): unknown
  getErrorCode(error: unknown, candidate: Readonly<BackendCandidate>): string
  isRecoverable(error: unknown, candidate: Readonly<BackendCandidate>): boolean
  createScope(candidate: Readonly<BackendCandidate>, context: CandidateAttemptContext): CandidateAttemptScope<T>
  onAttempt?(attempt: PlaybackDecisionAttempt): void
}

export class AllCandidatesFailedError extends Error implements EngineError {
  readonly code = ErrorCodes.STRATEGY_ALL_CANDIDATES_FAILED
  readonly recoverable = false
  readonly failures: readonly CandidateFailure[]

  constructor(failures: readonly CandidateFailure[]) {
    super('All verified playback candidates failed to initialize')
    this.name = 'AllCandidatesFailedError'
    this.failures = Object.freeze(failures.map((failure) => Object.freeze({ ...failure })))
  }
}

export async function runCandidateAttempts<T>(options: CandidateControllerOptions<T>): Promise<CandidateAttemptResult<T>> {
  const attempts: PlaybackDecisionAttempt[] = []
  let nextAttemptId = 1
  let activeAttemptId: number | null = null

  const isRunActive = (): boolean => options.isSessionActive() && options.signal?.aborted !== true
  const ensureRunActive = (): void => {
    if (!isRunActive()) throw options.createInactiveError()
  }

  ensureRunActive()
  for (let index = 0; index < options.candidates.length; index += 1) {
    ensureRunActive()
    const candidate = options.candidates[index]
    if (!candidate) continue
    const attemptId = nextAttemptId
    nextAttemptId += 1
    activeAttemptId = attemptId
    const context: CandidateAttemptContext = {
      index,
      attemptId,
      isActive: () => isRunActive() && activeAttemptId === attemptId,
    }
    const initializing = createAttempt(index, candidate, 'initializing', null)
    options.onAttempt?.(initializing)
    let scope: CandidateAttemptScope<T> | null = null
    try {
      scope = options.createScope(candidate, context)
      await scope.initialize()
      ensureContextActive(context, options.createInactiveError)
      const value = await scope.commit()
      ensureContextActive(context, options.createInactiveError)
      const selected = createAttempt(index, candidate, 'selected', null)
      attempts.push(selected)
      options.onAttempt?.(selected)
      activeAttemptId = null
      return {
        candidate: cloneCandidate(candidate),
        value,
        attempts: Object.freeze([...attempts]),
      }
    } catch (error) {
      await disposeBestEffort(scope)
      activeAttemptId = null
      if (!isRunActive()) throw options.createInactiveError()
      const errorCode = options.getErrorCode(error, candidate)
      const failed = createAttempt(index, candidate, 'failed', errorCode)
      attempts.push(failed)
      options.onAttempt?.(failed)
      if (!options.isRecoverable(error, candidate)) throw error
    }
  }

  ensureRunActive()
  throw new AllCandidatesFailedError(attempts.map((attempt) => ({
    candidateId: attempt.candidateId,
    kind: attempt.kind,
    errorCode: attempt.errorCode ?? ErrorCodes.CUSTOM_OPERATION_FAILED,
  })))
}

function createAttempt(
  index: number,
  candidate: Readonly<BackendCandidate>,
  status: PlaybackDecisionAttempt['status'],
  errorCode: string | null,
): PlaybackDecisionAttempt {
  return Object.freeze({
    index,
    candidateId: candidate.id,
    kind: candidate.kind,
    status,
    errorCode,
  })
}

function ensureContextActive(context: CandidateAttemptContext, createInactiveError: () => unknown): void {
  if (!context.isActive()) throw createInactiveError()
}

async function disposeBestEffort<T>(scope: CandidateAttemptScope<T> | null): Promise<void> {
  if (!scope) return
  try { await scope.dispose() } catch { /* cleanup must not mask the candidate failure */ }
}

function cloneCandidate(candidate: Readonly<BackendCandidate>): BackendCandidate {
  return {
    ...candidate,
    reasons: [...candidate.reasons],
    requires: [...candidate.requires],
  }
}
