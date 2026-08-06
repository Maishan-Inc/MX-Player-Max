import type { MXPlayerOptions } from '@mx-player-max/types'

export interface MXPlayerVueProps extends Omit<MXPlayerOptions, 'target'> {
  class?: string
}

