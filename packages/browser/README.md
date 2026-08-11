# @mx-player-max/browser

Browser-ready composition package for MX-Player-Max. It creates the SDK player, mounts the official UI on the same host, and owns their shared lifecycle.

Licensed under `PolyForm-Noncommercial-1.0.0`. Commercial use requires a separate license. The package does not contain unreviewed WASM/Codec binaries.

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

For a script tag, use the release-generated IIFE and CSS with a fixed version and SRI from `dist/manifest.json`:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@mx-player-max/browser@<VERSION>/dist/style.css" integrity="sha384-<SHA384_FROM_MANIFEST>" crossorigin="anonymous">
<script src="https://cdn.jsdelivr.net/npm/@mx-player-max/browser@<VERSION>/dist/mx-player-max.iife.min.js" integrity="sha384-<SHA384_FROM_MANIFEST>" crossorigin="anonymous"></script>
<script>const handle = MXPlayerMax.create({ target: '#player', source: { kind: 'url', url: 'https://media.example/video.mp4' } })</script>
```

The global is `MXPlayerMax`; no other global is created. Replace `<VERSION>` and both SRI placeholders during a release; do not use `latest` in production.

Use `handle.load({ source })` to replace media while retaining the original host and UI controller. `handle.destroy()` is idempotent and releases the UI before the SDK engine.

The package does not proxy remote media. Remote URLs must satisfy the SDK HTTPS, CORS, Range, and response validation requirements.
