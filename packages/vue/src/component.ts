import { defineComponent, h, onBeforeUnmount, onMounted, shallowRef, watch, type PropType, type StyleValue, type VNode } from 'vue'
import { MXPlayer as SdkPlayer } from '@mx-player-max/sdk'
import { attachPlayerUi, type PlayerUiController, type PlayerUiOptions } from '@mx-player-max/ui'
import type { MXPlayerOptions } from '@mx-player-max/types'

export interface MXPlayerVueProps {
  readonly playerOptions: Omit<MXPlayerOptions, 'target'>
  readonly uiOptions?: PlayerUiOptions
  readonly class?: string
  readonly style?: StyleValue
}

export interface MXPlayerComponentHandle {
  readonly player: SdkPlayer | null
  readonly ui: PlayerUiController | null
}

export const MXPlayer = defineComponent({
  name: 'MXPlayer',
  props: {
    playerOptions: { type: Object as PropType<Omit<MXPlayerOptions, 'target'>>, required: true },
    uiOptions: { type: Object as PropType<PlayerUiOptions>, required: false },
    class: { type: String, required: false },
    style: { type: [String, Array, Object] as PropType<StyleValue>, required: false },
  },
  setup(props, { expose }) {
    const host = shallowRef<HTMLElement | null>(null)
    const player = shallowRef<SdkPlayer | null>(null)
    const ui = shallowRef<PlayerUiController | null>(null)
    const handle: MXPlayerComponentHandle = {
      get player(): SdkPlayer | null { return player.value },
      get ui(): PlayerUiController | null { return ui.value },
    }
    expose(handle)
    onMounted((): void => {
      if (!host.value) return
      player.value = new SdkPlayer({ ...props.playerOptions, target: host.value })
      ui.value = attachPlayerUi(player.value, host.value, props.uiOptions)
      void player.value.ready.catch(() => undefined)
    })
    watch(() => props.playerOptions, (options, previous): void => {
      if (options === previous || !player.value || !host.value) return
      void player.value.load({ ...options, target: host.value }).catch(() => undefined)
    })
    watch(() => props.uiOptions, (options, previous): void => {
      if (options === previous) return
      ui.value?.update(options ?? {})
    })
    onBeforeUnmount((): void => {
      ui.value?.destroy()
      player.value?.destroy()
      ui.value = null
      player.value = null
    })
    return (): VNode => h('div', { ref: host, class: props.class, style: props.style })
  },
})
