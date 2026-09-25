import type { TrackInfo } from '@mx-player-max/types'

/** Resolve the profile and bit depth from the codec string emitted by MP4/WebM demuxers. */
export function resolveSupportedVp9Codec(codec: string, track: TrackInfo): string | null {
  const requested = codec.trim().toLowerCase()
  // The WASM registry resolves a codec family as `vp9`; the demuxed track retains the full
  // `vp09.PP.LL.DD` string needed to distinguish profile 0 from profile 2.
  const normalized = requested === 'vp9' || requested === 'vp09'
    ? (track.codec?.trim().toLowerCase() ?? requested)
    : requested
  const match = /^vp09\.(\d{2})\.(\d{2})\.(\d{2})(?:\.\d{2})*$/.exec(normalized)
  if (match === null && normalized !== 'vp9' && normalized !== 'vp09') return null

  const codecProfile = match === null ? undefined : Number(match[1])
  const codecBitDepth = match === null ? undefined : Number(match[3])
  const trackProfile = track.profile === undefined ? undefined : /^(0|2)$/.test(track.profile) ? Number(track.profile) : NaN
  const trackBitDepth = track.color?.bitDepth ?? track.bitDepth
  if (codecProfile !== undefined && trackProfile !== undefined && codecProfile !== trackProfile) return null
  if (codecBitDepth !== undefined && trackBitDepth !== undefined && codecBitDepth !== trackBitDepth) return null

  const profile = codecProfile ?? trackProfile
  const bitDepth = codecBitDepth ?? trackBitDepth
  if (!((profile === 0 && bitDepth === 8) || (profile === 2 && bitDepth === 10))) return null
  if (track.color?.chroma !== undefined && track.color.chroma !== '420') return null

  return match === null ? `vp09.0${profile}.10.${bitDepth === 8 ? '08' : '10'}` : normalized
}
