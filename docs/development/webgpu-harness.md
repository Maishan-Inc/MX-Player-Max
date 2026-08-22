# WebGPU kernel harness

Phase 7 shipped hand-written WGSL with no way to execute it: the Vitest suite
re-implements the maths in JavaScript and asserts that the shader source contains
certain substrings. This harness runs the real kernels through a real Dawn/Tint
compiler and a real GPU queue.

## Commands

```bash
pnpm quality:webgpu
pnpm quality:webgpu:numerics
pnpm quality:webgpu:oracle
pnpm quality:webgpu:rife
```

`quality:webgpu` compiles every WGSL constant exported by `packages/postprocess`
and executes an `rgba16float` 2d-array storage round-trip. `quality:webgpu:numerics`
runs individual kernels against CPU references. `quality:webgpu:oracle` compares
kernels against reference tensors captured from the real upstream RT4KSR forward
pass, and `quality:webgpu:rife` does the same for the RIFE operator set. All four
need `pnpm build` first — they read the built `dist/gpu/wgsl.js` so
the gates measure shipped output, not TypeScript source.

In-page plumbing lives in `scripts/quality/webgpu-page-helpers.js`, which the
harness serves at `/helpers.js`; a gate obtains it with
`await import('/helpers.js')` inside `page.evaluate`.

## Three conditions, all easy to miss

A page needs all three before it can obtain a device. Missing any one of them
looks identical to "this machine has no GPU":

1. **Secure context.** `navigator.gpu` is `[SecureContext]`. Playwright's default
   page is `about:blank`, where `isSecureContext === false`, so `navigator.gpu` is
   `undefined` there. The harness serves a page over `http://127.0.0.1`.
2. **The full Chromium build.** `chromium.launch({ headless: true })` uses
   `chromium-headless-shell`, which exposes `navigator.gpu` but always returns
   `null` from `requestAdapter()`. `channel: 'chromium'` selects the full build.
3. **`--enable-unsafe-webgpu`.** Even the full build withholds the SwiftShader
   fallback adapter without it on a machine that has no GPU.

## What this environment can and cannot prove

On a machine with no GPU the adapter is `google/swiftshader` with
`isFallbackAdapter === true`:

| | |
|---|---|
| `maxTextureDimension2D` | 8192 — enough for 4K output, not 8K |
| `maxComputeWorkgroupStorageSize` | 32768 |
| `float32-filterable` | available |
| `shader-f16` | **unavailable** — f16 kernel variants still need real hardware |

Consequences to respect:

- **Never record timings from this harness as performance evidence.** SwiftShader
  is a CPU rasteriser; frame budgets mean nothing here.
- **The player's AI path cannot be exercised end to end.** `proposeAiPlan()`
  returns tier `off` for a fallback adapter, so AI enhancement never engages.
  Kernel tests therefore drive `postprocess` directly instead of loading media.
- Firefox returns no adapter even with `dom.webgpu.enabled` and
  `gfx.webgpu.force-enabled` forced, so the three-browser WebGPU matrix still
  depends on real hardware.

## The RT4KSR oracle

`packages/postprocess/tools/generate_rt4ksr_reference.py` runs the upstream
`RT4KSR_Rep` forward pass on a seeded 8x8 input and writes per-stage tensors to
`packages/postprocess/tests/fixtures/rt4ksr-reference.json`. Upstream source is
not vendored; the script's docstring documents the one-off fetch into a scratch
directory, and it verifies its staged walk against `model.forward` before writing.
The input is quantised to 8 bit so an `rgba8unorm` upload reproduces it exactly and
the pipeline can be compared end to end rather than op by op.

`pnpm quality:webgpu:oracle` serves the built package over the harness's HTTP
server, loads the real `rt4ksr_x2.mxai`, and runs the shipped
`Rt4kSrGraphExecutor` from an 8-bit frame to the 2x output. The current result is
`max |delta| = 3.7e-3` over the 3x16x16 output — about one 8-bit step, which is the
floor set by `rgba16float` activations plus the `rgba8unorm` output.

The gate is sensitive to the semantics it checks: swapping the body activation from
GELU to ReLU moves the error to `2.7e-1`, roughly 70x the tolerance.

### What the graph had to change to get there

Reading `code/model/arch.py` and `code/model/modules.py` at the pinned commit showed
the graph had been re-derived from tensor names and diverged in six places:

| | upstream | previously shipped |
|---|---|---|
| high-frequency branch | `hfb`, `gamma` and the gaussian blur are **dead** (`rt4ksr_rep()` sets `forget=False`) | `hfb` sat in the main sequential path |
| body activation | GELU, applied **after** the ResBlock | leaky-ReLU, applied inside it |
| `head` | no activation | leaky-ReLU |
| `fea_conv` padding | 1px border filled with the **expand bias per channel** | clamp to edge |
| `fea_conv` | plus the pre-pad identity | no inner residual |
| `tail` | no trailing activation | leaky-ReLU |

`GpuGraphLayer` now carries `kind`, `padMode`, `padValues`, `saveInput`/`saveOutput`
slots, `residualFrom` and `activationAfterResidual` so the executor can express that
structure instead of approximating it.

### Submission and upload shape

The executor records all 25 passes (input pack, unshuffle, 22 graph layers, output
shuffle) into **one** command encoder with **one** submission, and each pass reads its
uniform block from its own 256-byte-aligned slot of a single buffer. The frame's only
fence is the trailing `onSubmittedWorkDone()`, which the governor needs in order to
measure. `uploadTensorStore` takes the set from `graphTensorNames(graph)`, so the
`hfb` convolutions and `gamma` — unreachable at inference — never reach GPU memory
(RT4KSR 51 → 44 tensors, 90.5 KiB skipped; RIFE 198 → 118, 1.8 MiB skipped).

Both invariants are pinned by tests in `packages/postprocess/tests/model-graph.test.ts`
rather than left to review.

## The RIFE oracle

`packages/postprocess/tools/generate_rife_reference.py` does the same job for
Practical-RIFE 4.25. The architecture ships inside the vendored archive
(`assets/weights/rife/RIFEv4.25.zip` -> `train_log/IFNet_HDv3.py`); only
`model/warplayer.py` is fetched from upstream. The script walks `IFNet` stage by
stage on a seeded 64x64 pair and checks the walk against `IFNet.forward` before
writing `tests/fixtures/rife-reference.json`. Inputs and the tensors needed for the
final warp are recorded at full resolution; the rest are stride-4 sampled with
global stats, because a full dump of all 31 stages is several megabytes.

`pnpm quality:webgpu:rife` runs the sub-networks whose kernels exist:

| check | what it proves |
|---|---|
| `encode` | `Head`: conv 3x3 stride 2, LeakyReLU(0.2), and `ConvTranspose2d(16, 4, 4, 2, 1)` — `max delta 8.9e-4` |
| `warp` | `grid_sample(bilinear, border, align_corners=True)` reduces to sampling at `(x + flowX, y + flowY)` — `max delta 1.2e-3` |
| `resize` | `F.interpolate(bilinear, align_corners=False)` in both directions — `max delta 5.1e-4` |

The gate also prints what is still missing, so the interpolation stage's status is
measurable rather than a claim. `IFBlock` bodies, flow accumulation, a graph IR that
can express concat/slice/resize/warp nodes, and the final blend are not implemented;
`WebGpuInterpolationStage` remains a placeholder and the SDK reports the stage as
`not-implemented`, so the settings toggle stays disabled instead of shipping wrong
frames.

## Requirements for the RIFE graph

Reading `IFNet_HDv3.py` at the vendored version fixes the operator set:

- `Head`: conv s2 → LReLU(0.2) → conv → LReLU → conv → LReLU → `ConvTranspose2d`, no trailing activation.
- `IFBlock(x, flow, scale)`: resize `x` by `1/scale`; when a flow exists, resize it the same way, multiply by `1/scale` and concatenate; `conv0` (two stride-2 3x3 with LReLU); 8x `ResConv`; `lastconv` = `ConvTranspose2d(c, 52, 4, 2, 1)` + `PixelShuffle(2)`; resize the result by `scale`; then `flow = tmp[:, :4] * scale`, `mask = tmp[:, 4:5]`, `feat = tmp[:, 5:]`.
- `ResConv`: `LeakyReLU(0.2)(conv3x3(x) * beta + x)`. `beta` is per-output-channel, so it folds into the weight and bias at upload time and needs no new kernel.
- `IFNet`: five blocks at scales 16/8/4/2/1; block 0 takes `cat(img0, img1, f0, f1, timestep)`; later blocks take `cat(warped0, warped1, warp(f0, flow), warp(f1, flow), timestep, mask, feat)`; `flow` accumulates additively; the output is `sigmoid(mask)` blended between the two warped frames.
