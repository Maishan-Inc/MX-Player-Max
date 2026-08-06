import type { MXPlayerOptions } from '@mx-player-max/types'

export interface MXPlayerReactProps extends Omit<MXPlayerOptions, 'target'> {
  className?: string
}

