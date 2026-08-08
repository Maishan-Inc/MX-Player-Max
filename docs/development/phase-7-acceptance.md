# Phase 7 Acceptance

日期：2026-08-08

## 已实现

- `@mx-player-max/postprocess` 提供 `AiPipeline`、RIFE arbitrary-phase temporal stage、RT4KSR x2 spatial stage、bounded `TexturePool`、packed full-channel WGSL convolution/layernorm/pixel-unshuffle/pixel-shuffle/warp kernels、governor 和 passthrough fallback。
- `MXAI` v1 parser 严格校验 magic、schema、tensor table、shape、offset、长度、类型和重复名称。
- Manifest loader 支持 approved review gate、HTTP(S) base URL、AbortSignal、Cache Storage/memory cache、SHA-256 验证和坏资产会话记忆。
- 真实资产已 vendored：RT4KSR x2 (`eduardzamfir/RT4KSR` Apache-2.0, commit `fd6627a48d789adf5d9aad29f02ab2a3d2a25296`)；Practical-RIFE 4.25 (`hzwer/Practical-RIFE` MIT, commit `17d8c7a1005b37f4c97bfee04e316aaec7fdc536`)。浏览器实际加载对应 MXAI v1 f32 派生产物，原始 `.pth/.zip` 保留用于来源复核。RIFE 上游没有可锁定的 4.6 archive，仓库不会伪造版本号。
- 提供离线转换工具（无 PyTorch 时可读取 torch zip 的 tensor storage），并记录派生文件哈希；Core 通过 `aiModelBaseUrl` 懒加载、校验、上传 tensor buffer。
- `ai-enhance` 只允许 WebCodecs custom candidate；没有 usable WebGPU 时继续使用 custom passthrough 并发出可恢复 `RENDERER_AI_UNSUPPORTED`，不会回退到 Native HTMLVideo。
- Core render loop 支持 CPU `VideoFrame` 和可选 GPU `GpuVideoFrame`，seek/epoch/close/drop 均有 exact release 路径。

## 自动化验证

当前已通过：

- postprocess：16 tests，覆盖 passthrough、manifest、SHA-256/cache、MXAI parser、governor、真实 RT4KSR/RIFE MXAI graph、tensor buffer exact release 和 packed WGSL contract。
- strategy：11 tests，覆盖 AI WebGPU gate 与 passthrough candidate。
- core：88 tests，既有 renderer/render-loop/custom lifecycle 回归保持通过。

最终阶段命令：`pnpm typecheck`、`pnpm test`、`pnpm build`、`git diff --check`。

## 待真实浏览器验证

Chrome/Chromium、Firefox、Safari 的最新两个稳定版本仍需真实 WebGPU adapter/device、VideoFrame upload、shader validation、GPU device loss、模型转换数值等价性、首帧/首音、seek、EOS、30 分钟漂移、CPU/内存/功耗和跨源隔离矩阵。fake GPU/Vitest 结果不替代这些 smoke 证据。
