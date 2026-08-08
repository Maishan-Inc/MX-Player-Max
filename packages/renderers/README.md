# @mx-player-max/renderers

`@mx-player-max/renderers` 只消费标准 `VideoFrame`，不依赖 demux、decoder、core、audio 或 UI。它提供固定资源预算的 WebGPU、WebGL2 和 Canvas2D backend，以及保持旧 `VideoRenderer`/`RendererFactory` 入口兼容的 `ManagedVideoRenderer`。

## Backend selection

`createRenderer('auto', options)` 按 WebGPU -> WebGL2 -> Canvas2D 初始化。能力快照只用于能力约束，运行时初始化仍会验证真实 context/device。显式 `webgpu`、`webgl2` 或 `canvas2d` 在不可用时返回 `RENDERER_BACKEND_UNAVAILABLE` 或对应稳定初始化错误，不会静默改用另一种显式 backend。Auto 初始化失败、WebGPU device lost 且重建失败、或 WebGL2 context 无法恢复时，Managed renderer 原子切换到链中的下一个 backend，并通过 fallback 事件报告原因码。

```ts
const renderer = createRenderer('auto', {
  capabilities: snapshot,
  filter: { kind: 'grayscale', amount: 1 },
  transform: { rotation: 90, fit: 'contain', devicePixelRatio: 2 },
  preserveHdr: true,
})
await renderer.attach(canvas)
renderer.render(videoFrame) // renderer closes this frame exactly once
```

## Ownership and bounds

- A frame returned by `MediaEngine.readVideoFrame()` belongs to the caller. The caller must close it exactly once.
- Passing a frame to `renderer.render(frame)` transfers temporary ownership to the renderer. Upload/draw, invalid, stale, device-lost and closed paths all close it exactly once. A frame never passed to the renderer is never closed by it.
- The same `VideoFrame` object cannot be submitted twice; the second submission returns `RENDERER_FRAME_INVALID` without a second close.
- Crop coordinates are checked against coded/display bounds. Rotation is limited to 0/90/180/270. Width, height and output size are positive safe integers. DPR is finite in `(0, 8]` and the backing canvas is capped at 16,384 pixels per dimension (also constrained by the GPU/WebGL texture limit).
- The normal path never calls `readPixels()` or full-frame `getImageData()`.

## Color and HDR

VideoFrame `colorSpace` metadata is used when present. SDR BT.709/sRGB and full/limited/unknown range are reported in `RendererStats`. Unknown metadata remains `unknown`; BT.2020 primaries alone do not imply HDR. Phase 6 does not have a standard end-to-end display-HDR confirmation signal, so WebGPU, WebGL2 and Canvas2D all conservatively report `hdrPreserved: false` with a stable reason. Native HTMLVideo remains the only path that can currently claim platform-managed HDR fidelity.

## Filters and transforms

The bounded filter set is `none`, `grayscale`, `brightness`, `contrast`, and `saturate`. Amounts are finite and clamped (`grayscale` 0..1, other filters 0..4). Invalid kinds/amounts return `RENDERER_FILTER_UNSUPPORTED`. `VideoTransformOptions` supports crop, contain/cover/fill, rotation, output size and DPR. No dynamic or unbounded shader code is generated.

WebGPU uploads with `copyExternalImageToTexture` and submits one fixed pipeline. WebGL2 uploads with `texImage2D` to one reusable texture and fixed GLSL resources. Canvas2D uses `drawImage(VideoFrame, ...)` with save/restore and CSS filters. None of the paths performs GPU-to-CPU pixel readback.

## Loss and cleanup

WebGPU listens to `device.lost`, stops presentation while rebuilding, destroys old textures/buffers, and atomically reconfigures the canvas. A failed rebuild emits `RENDERER_DEVICE_REBUILD_FAILED` and triggers Managed fallback. WebGL2 listens to `webglcontextlost/restored`, prevents the default loss, deletes and recreates program/texture/buffer/VAO resources, then falls back if restore does not arrive. `close()` removes canvas listeners, cancels recovery timers, releases GPU/GL resources, detaches the target and rejects future operations with `RENDERER_CLOSED`.

Renderer events contain only backend kind, state, stable error code, fallback reason, or bounded statistics. They never contain VideoFrame, GPUTexture, pixel arrays, AudioData, PCM or raw browser exception text.
