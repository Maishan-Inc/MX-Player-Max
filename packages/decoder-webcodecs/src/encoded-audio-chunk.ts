import type { DemuxPacket } from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import type { EncodedAudioChunkFactory } from './contracts'
import { createWebCodecsError } from './errors'
import { browserEncodedAudioChunkFactory } from './runtime-adapter'

export function createEncodedAudioChunk(
  packet: DemuxPacket,
  factory: EncodedAudioChunkFactory = browserEncodedAudioChunkFactory,
): EncodedAudioChunk {
  if (packet.kind !== 'audio') throw invalidChunk('Only audio packets can be decoded')
  validateMicros(packet.timestamp, 'timestamp')
  if (packet.duration !== null) validateMicros(packet.duration, 'duration')
  if (!(packet.data instanceof Uint8Array) || packet.data.byteLength === 0 || packet.data.buffer.byteLength === 0) {
    throw invalidChunk('The compressed audio packet is empty or detached')
  }
  try {
    return factory.create({
      type: 'key',
      timestamp: packet.timestamp,
      ...(packet.duration === null ? {} : { duration: packet.duration }),
      data: packet.data,
    })
  } catch (cause) {
    if (typeof cause === 'object' && cause !== null && 'code' in cause) throw cause
    throw createWebCodecsError(ErrorCodes.WEBCODECS_AUDIO_CONFIG_INVALID, 'The encoded audio chunk is invalid', false, cause)
  }
}

function validateMicros(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw invalidChunk(`The packet ${field} is invalid`)
}

function invalidChunk(message: string) {
  return createWebCodecsError(ErrorCodes.WEBCODECS_AUDIO_CONFIG_INVALID, message, false)
}
