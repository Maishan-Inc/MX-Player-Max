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
— including the `rgba32float` variant of each packed kernel, which is what the RIFE
executor actually ships — and executes a packed 2d-array storage round-trip.
`quality:webgpu:numerics` runs individual kernels against CPU references.
`quality:webgpu:oracle` compares kernels against reference tensors captured from the
real upstream RT4KSR forward pass, and `quality:webgpu:rife` does the same for RIFE,
from single operators up to the whole IFNet graph. It takes two flags:
`--mutate=leaky-slope` (a required-to-fail control) and
`--activation=rgba16float|rgba32float`. All four gates need `pnpm build` first — they
read the built `dist/gpu/wgsl.js` so the gates measure shipped output, not
TypeScript source.

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
(RT4KSR 51 → 44 tensors, 90.5 KiB skipped; RIFE 198 → 118, 1.8 MiB skipped, with
`teacher` and `caltime` dropped and each `ResConv`'s `beta` folded into its
convolution instead of uploaded — 80 of those 118 names are folded tensors supplied
through `GpuNodeGraph.derivedTensors`).

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
global stats, because a full dump of all 31 stages is several megabytes. Comparisons
must sample on that same grid — reading the values as if they were dense compares
the wrong pixels and still looks plausible.

`pnpm quality:webgpu:rife` checks two layers against that one fixture.

Operator level, driven directly so a single-op regression cannot hide inside the
graph:

| check | what it proves | measured |
|---|---|---|
| `op.encode` | `Head`: conv 3x3 stride 2, LeakyReLU(0.2), `ConvTranspose2d(16, 4, 4, 2, 1)` | `8.9e-4` |
| `op.warp` | `grid_sample(bilinear, border, align_corners=True)` reduces to sampling at `(x + flowX, y + flowY)` | `1.2e-3` |
| `op.resize` | `F.interpolate(bilinear, align_corners=False)` in both directions | `5.1e-4` |

Graph level: the shipped `RifeGraphExecutor` runs the whole of IFNet from two 8-bit
frames to the output frame — 155 nodes, one command encoder, one submission, one
fence. Every stage the fixture records is compared in place, using the executor's
`retain` option to hand the intermediate packed textures back to the gate:

| stages | measured worst delta | reference `absMax` |
|---|---|---|
| `encode.f0`, `encode.f1` | `8.8e-7` | 2.1 |
| `block0..3` flow / mask / feat / warped0 / warped1 | `≤ 9.5e-6` | 0.27 – 5.3 |
| `block4.flow`, `block4.feat`, `block4.warped0/1` | `≤ 1.5e-5` | 3.1 – 4.6 |
| `block4.mask` | `1.8e-4` | 15.1 |
| `mask.sigmoid` | `6.7e-5` | 1.0 |
| `output` | `2.0e-3` | 1.0 |

`output` is the only one that is not at fp32 noise: it is stored as `rgba8unorm`, and
`2.0e-3` is exactly half an 8-bit step. Every tolerance in the gate is about twenty
times the measured value, which leaves room for another vendor's fp32 accumulation
order and not for a semantic mistake.

### Two controls

`--mutate=leaky-slope` re-runs the graph with every LeakyReLU slope moved from 0.2
to 0.05 and **requires** the comparison to fail; it currently moves the error to
`9.1e-1` on `output`, four orders of magnitude past tolerance. A gate that cannot
be made to go red proves nothing, so this is a checked property rather than a note.

`--activation=rgba16float` measures the half-precision variant. It is not a passing
configuration and that is the point — see below.

### Why activations are fp32 here

RT4KSR keeps activations in `rgba16float` because it is feed-forward and its output
is quantised to 8 bit anyway. IFNet is not: its flow is a displacement in pixels
that reaches `|5|` on this fixture, where a half-float ulp is 4e-3 of a pixel, and
five blocks feed that flow back into each other's warps. Measured on the same
fixture, `rgba16float` gives `3.9e-3` at `block0.flow`, `2.1e-2` by `block1.flow`,
`7.5e-1` at `block4.mask` and `1.4e-1` on `output` — 36 8-bit steps. The random-noise
input is the worst case for that amplification and real frames would fare better,
but nothing here can measure "better", so the shipped default is the configuration
the gate actually verifies:

| | `rgba32float` (default) | `rgba16float` |
|---|---|---|
| `output` vs upstream | `2.0e-3` (the rgba8 floor) | `1.4e-1` |
| pool at 1080p | 62 textures, ~1040 MiB | ~520 MiB |
| pool at 4K | ~4160 MiB | ~2080 MiB |

`RifeExecutorOptions.activationFormat` selects it, and `RifeGraphExecutor` reports
`activationTextures` / `activationBytes` so the cost is measurable rather than
assumed. Both are large: IFNet keeps about 33 full-resolution channel groups live,
and the pool never shrinks. A frame size whose pool does not fit fails at texture
creation, which `AiPipeline` turns into a fallback to passthrough rather than a
broken frame.

`rgba32float` is bound through `layout: 'auto'`, which is only valid because the
packed kernels read every texture with `textureLoad` and never with a sampler, so
the derived layout is `unfilterable-float` and no `float32-filterable` feature is
required. This is verified on Dawn; a stricter implementation would reject pipeline
creation, and the stage would fall back rather than render.

### What the RIFE gate still does not cover

- **f16 kernel variants.** The fallback adapter has no `shader-f16`, so
  half-precision *weights* remain untested anywhere.
- **Performance.** SwiftShader is a CPU rasteriser; the gate records no timings.
- **Frames that are not a multiple of 64.** The fixture is 64x64, so the pad/crop
  wrapper is pinned by `packages/postprocess/tests/model-graph.test.ts` instead
  (`paddedSize(1920, 1080) === {1920, 1088}`, and the blend dispatches over the
  unpadded frame) plus a `PACKED_INPUT` zero-fill check in
  `pnpm quality:webgpu:numerics`.

## How the RIFE graph is expressed

Reading `IFNet_HDv3.py` at the vendored version fixes the operator set:

- `Head`: conv s2 → LReLU(0.2) → conv → LReLU → conv → LReLU → `ConvTranspose2d`, no trailing activation.
- `IFBlock(x, flow, scale)`: resize `x` by `1/scale`; when a flow exists, resize it the same way, multiply by `1/scale` and concatenate; `conv0` (two stride-2 3x3 with LReLU); 8x `ResConv`; `lastconv` = `ConvTranspose2d(c, 52, 4, 2, 1)` + `PixelShuffle(2)`; resize the result by `scale`; then `flow = tmp[:, :4] * scale`, `mask = tmp[:, 4:5]`, `feat = tmp[:, 5:]`.
- `ResConv`: `LeakyReLU(0.2)(conv3x3(x) * beta + x)`. `beta` is per-output-channel, so it folds into the weight and bias at graph-build time and needs no new kernel.
- `IFNet`: five blocks at scales 16/8/4/2/1; block 0 takes `cat(img0, img1, f0, f1, timestep)`; later blocks take `cat(warped0, warped1, warp(f0, flow), warp(f1, flow), timestep, mask, feat)`; `flow` accumulates additively; the output is `sigmoid(mask)` blended between the two warped frames.

`GpuGraphLayer` cannot express that: it is a single-input chain. `GpuGraphNode` is a
typed DAG — `input`, `fill`, `conv`, `transposed-conv`, `pixel-shuffle`, `resize`,
`warp`, `gather`, `add`, `blend` — and `RifeGraphExecutor` maps each kind onto one
audited kernel. Three decisions carry most of the weight:

- **Sizes are symbolic.** Every resolution IFNet visits is the padded frame size
  divided by a power of two up to 64, so each node carries one `divisor` and the
  graph is built once per model rather than once per resolution.
- **Concat gathers, it does not scatter.** A packed storage texture is written a
  whole `vec4` at a time, so a 3+3+4+4+1 concat cannot be assembled by writing each
  part into a channel offset. `PACKED_GATHER_WGSL` inverts it: output channel `c`
  walks a slot table and reads the slot that owns it. The same kernel does the
  13 → 4/1/8 split of `tmp` and the `* scale` on the flow.
- **`F.interpolate` is per-channel**, so it commutes with concat and slice. Resizing
  each part before the concat, and slicing before the upsample, keeps the wide
  15/24/28-channel block inputs and the 13-channel `tmp` at the block's own
  resolution instead of materialising them at full resolution, where IFNet already
  holds about eighteen channel groups live at once. At `scale === 1` (block 4) the
  resize is the identity and is skipped.

`validateNodeGraph` rejects a graph whose ids are not unique or topologically
ordered, whose multi-input nodes disagree on resolution, or whose channel arithmetic
does not match the operator; `createRifeGraph` runs it on every build.

