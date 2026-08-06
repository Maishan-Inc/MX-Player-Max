import type { SubtitleCue, SubtitleCueStyle } from '@mx-player-max/types'

export interface SubtitleParser {
  parse(input: string): SubtitleCue[]
}

export interface SubtitleStyleStore {
  load(scope: string): SubtitleCueStyle
  save(scope: string, style: SubtitleCueStyle): void
}

export function activeCues(cues: SubtitleCue[], time: number): SubtitleCue[] {
  return cues.filter((cue) => time >= cue.start && time < cue.end)
}

