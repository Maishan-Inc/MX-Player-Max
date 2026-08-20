# Phase 10 验收记录

日期：2026-08-12；审核更新：2026-08-20

## 实现状态

Phase 10.2 单 Codec 垂直切片已实现，并于 2026-08-20 完成项目所有者授权及许可证/专利审核。
Phase 10 总体仍未完成：10.3 其余视频 Codec、10.4 WASM 音频和 10.5 FFmpeg 尚未接入。

本次交付范围固定为审核通过的 libvpx VP8：

- 上游 libvpx `v1.15.2`，commit `d168454ecd099805c675d4a98c66f4891373302a`。
- 仅支持 video-only VP8 profile 0、8-bit I420；不包含 VP9、AV1、H.264、HEVC、VVC 或音频。
- `BrowserWasmDecoderRuntime` 使用真实 `WebAssembly.compile()` / `instantiate()`。
- MXWF Frame ABI v1 固定 descriptor、I420 plane/stride、visible/display rect、微秒时间、颜色
  metadata、frame token 和必要复制边界。
- `@mx-player-max/decoder-worker` 复用既有 session/request identity、epoch、reset、flush、
  transferable `VideoFrame`、旧帧关闭和错误清洗控制面。
- Core 只有在显式 `wasmBaseUrl` 时向 `CapabilityContext` 注入 approved VP8 declaration；
  普通 HTMLVideo/WebCodecs 探测阶段使用 `includeWasm:false`，只有 WASM candidate 初始化时才
  调用 `detectWasmCapabilities()`。
- WebCodecs candidate 初始化失败后由同一个原子候选控制器回退 WASM。隔离环境 threaded
  初始化失败后由 Manager 顺序回退 SIMD/single，失败 candidate 不提交事件或旧 epoch 画面。
- 无音轨 Custom 路径在首个可交付视频帧到达时锚定墙钟，避免真实软件解码启动延迟使首批
  帧全部被调度器判为 late drop。

## 资产与供应链

Review 结论为 `approved`。项目所有者于 2026-08-20 确认所需授权已经取得；该仓库记录是授权
记录，不构成独立法律意见。BSD-3-Clause 全文保存在
`packages/decoder-wasm-vpx/third_party/libvpx/LICENSE`；上游 `PATENTS` 的 WebM 实现专利授权
及诉讼终止条款原文保存在同目录。

| Variant | Bytes | SHA-256 | 构建/运行状态 |
|---|---:|---|---|
| `single` | 113304 | `d8de9e34abade1d60ebd4646d98681dacf3c688d2f38dc7b1e1c15c699f1c5ba` | self-contained，zero imports |
| `simd` | 135291 | `79e784506b25160e650c02d6d87213075188f98fda1e829a342ad4cad980853d` | `-msimd128`，zero imports |
| `threaded` | 139725 | `422c57f2634f6e24d2745b01dcf54a4cd2da0ba079fe60f85a0377041becb07f` | real pthread/shared-memory build；10.2 无 host glue，预期初始化失败并回退 |

Toolchain 与编译选项：Emscripten `4.0.15`，release commit
`b412b6307e541b93dd93f01b61181e15c17302ec`；libvpx 配置禁用 VP9、VP8 encoder、shared、docs、
examples、tools、tests、webm-io 和 libyuv；公共 link flags 为 `-O3`、
`-sSUPPORT_LONGJMP=wasm`、`--no-entry`、`-sSTANDALONE_WASM=1`、`-sFILESYSTEM=0`、
`-sALLOW_MEMORY_GROWTH=0`、`-sINITIAL_MEMORY=268435456`、`-sMALLOC=emmalloc`。
SIMD 增加 `-msimd128`；threaded 使用 `--enable-multithread`、`-pthread` 和 decoder threads=2。

当前仓库保留 `native/mxwf_vpx.c`、资产审计脚本和完整 provenance，但没有提交自动获取
toolchain/upstream 并重建二进制的脚本。本环境没有重新编译三份资产；`audit:wasm` 只证明现有
文件的字节数、SHA-256、imports/exports 与记录一致，不等价于可复现构建证明。发布审批前必须
补做独立 clean-room rebuild 作为可复现性证据；该技术证据不撤销已完成的许可证/专利授权。

Browser release manifest 将 `single`/`simd` 记录为 `publishable:true` 并锁定审核清单 SHA-256；
`threaded` 因缺少 Emscripten pthread host glue 记录为 `publishable:false`，reason 固定为
`threaded-host-glue-unavailable`。三者的 review 均为 `approved`。

## 媒体样本

- 文件：`webm-vp8-p0-8bit-642x358.webm`
- 输出：WebM、VP8 profile 0、8-bit `yuv420p`、642x358、30000/1001 fps、1.001 s、无音频
- 输出 bytes：45408
- 输出 SHA-256：`31cc0a477479e3acde7e336769d068cd57d4d18fab8904ba9e44a47bab7ab95a`
- 来源：`https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm`
- 来源许可：CC0 / public-domain dedication
- 来源 SHA-256：`c6f8a348953395598a9a73b9bab1676436410797bce9f398f4be1531d6e76dda`
- 生成工具：FFmpeg `9.0-full_build-www.gyan.dev`

完整转码命令、工具 archive hash 和来源记录位于 fixture 同目录 `PROVENANCE.md`。

## 规模与聚焦测试

Phase 10 Manager/Worker/VP8 实现规模：

| 范围 | 源码 | 测试 |
|---|---:|---:|
| `decoder-wasm` | 1320 lines / 10 TS files | 662 lines / 8 TS files |
| `decoder-worker` | 499 lines / 1 TS file | 156 lines / 1 TS file |
| `decoder-wasm-vpx` | 736 TS + 389 C lines | 454 lines / 4 TS files |

聚焦自动化结果：types 22、capabilities 19、strategy 13、decoder-wasm 34、decoder-worker 6、
decoder-wasm-vpx 13、decoder-webcodecs 57、core 124，合计 288 tests。全仓 `pnpm test` 精确为
491 tests。分布为：types 22、audio 32、capabilities 19、decoder-wasm 34、decoder-worker 6、
demux 44、platform 12、postprocess 16、renderers 16、strategy 13、subtitles 46、
decoder-wasm-vpx 13、decoder-webcodecs 57、core 124、sdk 4、ui 18、browser 10、react 1、vue 1、
demo 3。真实 VP8 packet 测试经过
仓库 Demux，使用真实 `.wasm` compile/instantiate/decode，不使用 fake packet 作为解码结论。

浏览器证据：

- Windows Playwright Chromium desktop：非隔离 single，WebCodecs 失败后选择 WASM，渲染非空
  Canvas；连续两次 seek 后 epoch >= 2，队列与 decode queue <= 4，未请求 threaded。
- Windows Playwright Chromium desktop：隔离环境先请求 threaded，初始化失败后只请求 SIMD，
  播放与非空 Canvas 渲染不中断。
- Windows Playwright Firefox：非隔离 single，真实样本渲染非空 Canvas，未请求 threaded。
- Playwright WebKit 与物理 macOS Safari 最新两个稳定版本的真实 VP8 播放均未作为通过证据；
  物理 Safari 保持 pending。

## 完整自动化门禁

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | passed；20 个工作区项目 build + strict typecheck |
| `pnpm test` | passed；491 tests |
| `pnpm build` | passed；20 个工作区项目及 Demo production build |
| `pnpm test:browser` | passed；19 passed / 5 skipped；Chromium desktop/mobile、Firefox、Playwright WebKit |
| `pnpm --filter @mx-player-max/decoder-wasm-vpx audit:wasm` | passed；三变体 bytes/hash/imports/exports |
| `pnpm test:release` | passed；含 approved VP8 hash/manifest、single/SIMD 发布和 threaded 技术排除 |
| `pnpm verify:packages` | passed；19 publishable packages 的 package/tarball 结构 |
| `git diff --check` | passed |

## Pending 门禁

- [approved] Phase 10.2 项目所有者授权与许可证/专利发布审核。
- [pending] clean-room 可复现 WASM 重建证据。
- [pending] 物理 macOS Safari 最新两个稳定版本及 latest-two-stable 浏览器矩阵。
- [pending] 长时间 seek/内存/CPU/功耗压力测试；当前仅有有界队列、旧 epoch 和 debug live bytes 自动化。
- [pending] Phase 10.3 其他视频 Codec 插件。
- [pending] Phase 10.4 WASM 音频与 PCM ABI。
- [pending] Phase 10.5 FFmpeg 兜底与各自发布许可收口。
- [approved] 将现有 libvpx VP8 三个二进制标记为 `approved`，发布 `single`/`simd`，技术性排除 `threaded`。

Phase 10.2 的许可证/专利门禁和项目所有者授权已完成，后续阶段可继续使用批准的 VP8 资产。
自动化仍只证明仓库合同；`threaded` host glue、实机浏览器和其他 Codec 必须按各自技术门禁继续验证。
