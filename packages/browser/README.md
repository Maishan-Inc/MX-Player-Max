# @mx-player-max/browser

Browser-ready composition package for MX-Player-Max. It creates the SDK player, mounts the official UI on the same host, and owns their shared lifecycle.

```ts
import { create } from '@mx-player-max/browser'
import '@mx-player-max/browser/style.css'

const handle = create({
  target: '#player',
  source: { kind: 'url', url: 'https://media.example/video.mp4' },
  ui: { theme: 'dark' },
})

await handle.ready
```

Use `handle.load({ source })` to replace media while retaining the original host and UI controller. `handle.destroy()` is idempotent and releases the UI before the SDK engine.

The package does not proxy remote media. Remote URLs must satisfy the SDK HTTPS, CORS, Range, and response validation requirements.
