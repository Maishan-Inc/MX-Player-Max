export type DemoRevealAnimator = (root: HTMLElement, reducedMotion: boolean) => () => void

export function initializeDemoReveal(root: HTMLElement, reducedMotion: boolean, animate: DemoRevealAnimator): () => void {
  try {
    return animate(root, reducedMotion)
  } catch {
    root.querySelectorAll<HTMLElement>('[data-demo-reveal]').forEach((element) => {
      element.style.visibility = 'visible'
      element.style.opacity = '1'
    })
    return (): void => undefined
  }
}
