import type { DecoderCodecDeclaration } from '@mx-player-max/types'

/**
 * The codecs `createVideoDecoderConfig` and `createAudioDecoderConfig` will attempt, published as
 * data so the strategy layer can refuse to rank this backend for anything else. A browser can be
 * more capable than this list — Chrome decodes Vorbis and HEVC — and a candidate built on the
 * browser's verdict alone fails at pipeline initialisation instead of never being offered.
 *
 * `packages/decoder-webcodecs/tests/codec-scope.test.ts` compares every entry against what the two
 * config builders actually accept, so the list cannot drift away from them.
 */
export const WEBCODECS_CODEC_SCOPE: readonly DecoderCodecDeclaration[] = [
  // A bare avc1/avc3 is in scope because the builder completes it from the avcC record.
  { kind: 'video', match: 'exact', codec: 'avc1' },
  { kind: 'video', match: 'exact', codec: 'avc3' },
  { kind: 'video', match: 'prefix', codec: 'avc1.' },
  { kind: 'video', match: 'prefix', codec: 'avc3.' },
  { kind: 'video', match: 'exact', codec: 'vp8' },
  { kind: 'video', match: 'prefix', codec: 'vp08.' },
  { kind: 'video', match: 'prefix', codec: 'vp09.' },
  { kind: 'video', match: 'prefix', codec: 'av01.' },
  // Only mono and stereo are wired through the audio output chain.
  { kind: 'audio', match: 'prefix', codec: 'mp4a.40.', maxChannels: 2 },
  { kind: 'audio', match: 'exact', codec: 'opus', maxChannels: 2 },
  { kind: 'audio', match: 'exact', codec: 'mp3', maxChannels: 2 },
]
