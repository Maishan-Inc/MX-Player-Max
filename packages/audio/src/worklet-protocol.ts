import type { AudioOutputState } from '@mx-player-max/types'

export interface WorkletPcmMessage {
  type: 'pcm'
  sequence: number
  epoch: number
  frames: number
  channels: number
  sampleRate: number
  data: ArrayBuffer
}

export interface WorkletResetMessage { type: 'reset'; epoch: number }
export interface WorkletPlaybackMessage { type: 'playback'; paused: boolean; rate: number; epoch: number }
export interface WorkletSharedInitMessage {
  type: 'shared-init'
  epoch: number
  channels: number
  capacityFrames: number
  header: SharedArrayBuffer
  samples: SharedArrayBuffer
}

export type AudioWorkletInputMessage = WorkletPcmMessage | WorkletResetMessage | WorkletPlaybackMessage | WorkletSharedInitMessage

export interface WorkletConsumedMessage { type: 'consumed'; sequence: number; epoch: number; frames: number }
export interface WorkletUnderrunMessage { type: 'underrun'; epoch: number }
export interface WorkletStateMessage { type: 'state'; epoch: number; state: AudioOutputState }
export type AudioWorkletOutputMessage = WorkletConsumedMessage | WorkletUnderrunMessage | WorkletStateMessage
