# Phase 10.2: WASM Codec Vertical Slice Design

日期：2026-08-12

状态：Phase 10.2 已按本设计实现，待子阶段评审

## 1. 目标

Phase 10.2 交付一个真实、可审计、默认不可发布的 WASM 视频解码垂直切片。首个切片从
WebM/Matroska Demux 输出的 VP8 压缩 packet 开始，经校验加载、真实 WebAssembly 编译与实例化、
Dedicated Worker、Codec 无关帧 ABI、Core Custom Pipeline 和现有 Renderer，最终输出并渲染
非空 `VideoFrame`。

本阶段只覆盖 libvpx VP8 8-bit 4:2:0 视频。VP9、AV1、H.264、HEVC、VVC、WASM 音频、
FFmpeg、HLS、DASH、MSE、直播、DRM、Renderer、AI、字幕和 UI 均不在范围内。

## 2. Codec 选择与上游审查

### 2.1 选择 libvpx VP8

首切片选择 libvpx `v1.15.2` 的 VP8 decoder，固定源码 commit：

```text
upstream: https://chromium.googlesource.com/webm/libvpx
tag: v1.15.2
commit: d168454ecd099805c675d4a98c66f4891373302a
```

选择理由：

- libvpx 使用 BSD-3-Clause，允许源码和二进制再分发，但二进制分发必须在文档或材料中保留
  版权、条件和免责声明。
- 上游 `PATENTS` 包含 Google 针对 WebM 实现的永久、全球、非独占、免费专利许可，并包含
  专利诉讼终止条款。该授权降低了首切片的审查风险，但不等于完整的第三方法律意见。
- 仓库已具备 WebM/Matroska VP8 轨道识别、Range Demux、压缩 packet、VP8 WebCodecs 配置、
  Custom Pipeline 和 CC0 WebM 样本来源记录，可避免同时引入新容器或 Codec private data 风险。
- VP8 固定为 8-bit 4:2:0，首版 ABI 可以先验证 I420 plane、stride、可见区域、颜色和所有权，
  不必在同一切片中解决高位深或多种 subsampling。

### 2.2 不选择 dav1d AV1

核实的 dav1d 上游源码 commit `54706fc6bc0cdecab7e9593974a4039cc038fca7` 使用
BSD-2-Clause。其 README 明确说明 dav1d 只是 AV1 decoder 实现，本身不额外授予 AV1
专利权，并要求使用方阅读 AOM AV1 Patent License 1.0。AV1 还会同时扩大 sequence header、
profile、bit depth、subsampling 和样本夹具范围，因此不作为首个切片。

### 2.3 发布结论

本阶段的法律与专利结论为 `restricted`，不是 `approved`：

- 二进制可用于仓库内开发、自动化验收和调用方显式 opt-in 的自托管验证。
- Core 只有在调用方显式传入 `wasmBaseUrl` 时才注册该插件、向 Strategy 暴露声明，并以
  `requireApprovedReview: false` 创建该次受限 Manager。
- 默认 SDK/Browser 构建不注册插件、不产生 WASM 候选、不请求任何 WASM。
- 二进制不得进入 `packages/browser` release manifest、正式 npm publish allowlist 或正式
  Release 上传资产。
- 后续若要改为 `approved`，必须由独立发布审查确认许可证材料、专利授权适用范围、构建
  可复现性和分发义务；自动化通过不能改变 review 状态。

## 3. 包与依赖边界

新增两个有明确职责的公共包：

```text
@mx-player-max/types
          ↑
@mx-player-max/decoder-worker
       ↑                 ↑
decoder-webcodecs   decoder-wasm-vpx
                          ↑
                    decoder-wasm
                          ↑
                         core
```

### 3.1 `@mx-player-max/decoder-worker`

从 `decoder-webcodecs` 抽取现有后端无关的以下实现，不复制或分叉：

- `VideoDecoderAdapterLike` 与 callbacks 契约；
- Decoder Worker request/response、session/request identity 和 transferable frame 协议；
- `WorkerVideoDecoderAdapter`；
- `VideoDecoderWorkerController` 的 epoch、pending frame、reset、flush、close 和错误清洗逻辑。

`decoder-webcodecs` 改为依赖并兼容重导出这些公共入口。它的 WebCodecs decode 实现、
encoded chunk 和 config 逻辑仍留在原包。`decoder-worker` 只依赖 `types`，不知道 WebCodecs、
WASM、容器或 Renderer。

### 3.2 `@mx-player-max/decoder-wasm-vpx`

新包只实现 libvpx VP8 插件、MXWF ABI adapter、WASM Worker entry 和受限 manifest。它通过
公共入口依赖 `decoder-wasm`、`decoder-worker` 和 `types`，不依赖 Core、Demux、Renderer、
Browser 或 Demo。

包内保留构建输入、脚本、完整第三方许可证、专利文本、来源清单和三种 WASM 变体。正式包
发布 allowlist 不包含该包，Browser release manifest 也不引用其资源。

### 3.3 Core

Core 只组合 Manager、插件、Worker adapter 和 Custom Pipeline，不包含 libvpx 导出名、
VP8 bitstream 解析、浏览器名称分支或像素转换代码。Custom Pipeline 继续只依赖统一的
`VideoDecoderAdapterLike`。

## 4. MXWF Frame ABI v1

### 4.1 总体规则

WASM 模块导出稳定的 `MXWF` C ABI。所有整数使用 WebAssembly little-endian 线性内存表示；
指针、长度、stride、尺寸和枚举均为无符号 32-bit。时间戳与时长使用 `lo`/`hi` 两个 32-bit
字段组成无符号 64-bit 微秒值，避免 JS/WASM `i64` BigInt 调用差异。

每次 `decode` 或 `flush` 后，JS 重复调用 `mxwf_decoder_receive_frame()`，直到返回 `0`。
返回值指向只读 160-byte descriptor。descriptor 与其 plane 数据由 decoder 持有，调用方必须
对 `frameToken` 恰好调用一次 `mxwf_frame_release()`。

### 4.2 Descriptor 布局

```text
offset  bytes  field
0       4      magic = 0x4d585746 ("MXWF")
4       4      abiVersion = 1
8       4      descriptorBytes = 160
12      4      frameToken, non-zero
16      4      pixelFormat: 1 = I420
20      4      flags: bit0 durationPresent, bit1 keyFrame
24      4      codedWidth
28      4      codedHeight
32      4      visibleX
36      4      visibleY
40      4      visibleWidth
44      4      visibleHeight
48      4      displayWidth
52      4      displayHeight
56      4      timestampLo
60      4      timestampHi
64      4      durationLo
68      4      durationHi
72      4      colorPrimaries
76      4      colorTransfer
80      4      colorMatrix
84      4      colorRange
88      4      planeCount = 3
92      4      reserved = 0
96      20     plane[0]: offset, stride, rows, rowBytes, byteLength
116     20     plane[1]: offset, stride, rows, rowBytes, byteLength
136     20     plane[2]: offset, stride, rows, rowBytes, byteLength
156     4      reserved = 0
```

v1 只接受 `pixelFormat=I420`、三个不重叠 plane、正 stride、`rowBytes <= stride`、
`byteLength >= stride * rows`，并对所有加法和乘法做 32-bit 边界检查。任一 pointer/length、
尺寸、可见区域、plane 或枚举越界都以稳定 `WASM_FRAME_ABI_INVALID` 失败，不构造
`VideoFrame`。

### 4.3 Pixel、stride 与可见区域

- `codedWidth`/`codedHeight` 是 plane allocation 对应尺寸，可包含 libvpx 的对齐 padding。
- `visible*` 是真实图像裁剪区域，必须落在 coded rectangle 内。
- `displayWidth`/`displayHeight` 来自 TrackInfo 的 display metadata；没有显式值时等于可见尺寸。
- I420 的 U/V `rowBytes` 和 `rows` 使用向上取整的二分尺寸，因此奇数宽高和非 16 对齐尺寸
  不会截断 chroma。
- JS 将三个 plane 的最小起始 offset 到最大结束 offset 作为 `VideoFrame` 输入 view，layout
  offset 转为相对该 view 的位置，保留 ABI stride，不假设 plane 紧密排列。

### 4.4 颜色枚举与来源

颜色字段使用稳定枚举，`0` 表示 unspecified。adapter 只映射 WebCodecs 标准可表达的值：

```text
primaries: 1=bt709, 2=bt470bg, 3=smpte170m, 4=bt2020
transfer:  1=bt709, 2=smpte170m, 3=iec61966-2-1, 4=pq, 5=hlg
matrix:    1=rgb, 2=bt709, 3=bt470bg, 4=smpte170m, 5=bt2020-ncl
range:     0=unspecified, 1=limited, 2=full
```

来源优先级固定为：

1. 已校验的 container/TrackInfo 颜色 metadata；
2. libvpx `vpx_image_t` 明确给出的 color space/range；
3. VP8 规范默认的 BT.601/SMPTE 170M limited range；
4. 无法证明时保持 unspecified，不根据浏览器、文件名或分辨率猜测 HDR/色域。

### 4.5 所有权与拷贝边界

packet 输入由 JS 调用 `mxwf_alloc()` 分配并复制到 WASM，`decode` 返回后在 `finally` 中调用
`mxwf_free()`。libvpx 输出由 wrapper 复制到一个 decoder-owned、连续但保留独立 plane stride
的 frame allocation。

浏览器没有从任意 WASM 线性内存创建外部 `VideoFrame` 的标准零拷贝 API。adapter 在 Worker
中同步调用 `new VideoFrame(wasmView, init)`；构造完成表示浏览器媒体资源已经取得像素快照，
随后立即 `mxwf_frame_release(frameToken)`。这是 WASM 所有权移交点。若构造失败，也必须释放
token。WASM 到 `VideoFrame` 的必要拷贝由浏览器构造语义完成；不增加 JS plane repack。

Worker 之后通过 transferable `VideoFrame` 把所有权转给主线程，不复制像素。旧 epoch、未知
request、queue drop、Renderer 完成和 close 继续使用现有 exactly-once close 规则。事件只携带
计数、状态和稳定错误，不携带 Frame、像素、texture、URL 或平台原始错误。

## 5. WebAssembly Runtime 与导出

`WasmDecoderRuntime` 扩展为真实的两阶段运行时：

```ts
interface WasmDecoderRuntime {
  compile(bytes: Uint8Array): Promise<WebAssembly.Module>
  instantiate(
    module: WebAssembly.Module,
    imports?: WebAssembly.Imports,
  ): Promise<WebAssembly.Instance>
}
```

默认 `BrowserWasmDecoderRuntime` 对输入 bytes 做独立 copy，调用 `WebAssembly.compile`，并调用
`WebAssembly.instantiate(module, imports ?? {})`。Manager 把同一个 runtime 放入
`WasmDecoderCreateContext`，插件不得绕过 runtime 自行 fetch 或 compile。

WASM 模块不依赖 Emscripten JS glue，导出未压缩的稳定名称：

```text
memory
mxwf_abi_version
mxwf_alloc
mxwf_free
mxwf_decoder_create
mxwf_decoder_decode
mxwf_decoder_flush
mxwf_decoder_reset
mxwf_decoder_receive_frame
mxwf_frame_release
mxwf_decoder_destroy
mxwf_debug_live_frames
mxwf_debug_live_bytes
```

adapter 在实例化后逐项验证 export kind、ABI version、memory 和必要函数。缺失、类型错误或
版本不匹配均以 `WASM_INSTANTIATE_FAILED` 或 `WASM_FRAME_ABI_INVALID` 失败，并允许 Manager
尝试下一个变体。

## 6. libvpx 构建矩阵

三种变体都从固定 libvpx commit 和同一个仓库 wrapper 构建：

| Variant | Emscripten | Required runtime capability | Purpose |
| --- | --- | --- | --- |
| `single` | no pthreads, no `-msimd128` | WebAssembly | 非隔离和最低能力基线 |
| `simd` | no pthreads, `-msimd128` | `wasmSimd` | 非隔离 SIMD 优化 |
| `threaded` | `-pthread`, fixed bounded pool, no SIMD dependency | isolation + SAB + threads | 隔离页面多线程优先 |

libvpx 仅启用 VP8 decoder，禁用 VP8/VP9 encoder、VP9 decoder、examples、tools、docs、tests
和 shared library。wrapper 使用 `-O3`、`--no-entry`、稳定 exports、无 filesystem、无网络、
有界初始/最大内存。构建脚本固定 emsdk image/toolchain digest，并输出 wasm-opt 前后哈希、模块
imports/exports、字节数和完整命令。

变体顺序继续由现有 `selectWasmVariants()` 决定：

```text
non-isolated + no SIMD  -> single
non-isolated + SIMD     -> simd, single
isolated + no SIMD      -> threaded, single
isolated + SIMD         -> threaded, simd, single
```

非隔离页面的选择结果中绝不出现 threaded，因此不会请求 threaded URL。threaded fetch、compile、
instantiate 或 plugin create 失败后，Manager 完整关闭半初始化实例并顺序尝试 simd/single。

## 7. Plugin 与 Worker 生命周期

### 7.1 Manager 契约扩展

`WasmDecoderCreateContext` 增加 runtime 和输出 callbacks。`WasmDecoderInstance` 增加
`decodeQueueSize` 与 `reset()`，保持 `decode(packet, timestamp, key)`、`flush()` 和 `close()`。
Manager 的 managed instance 继续负责幂等 close、session failure ledger 和变体原子回退。

插件 `supports()` 仅接受：

- `track.kind === 'video'`；
- 规范化 codec 为 `vp8` 或合法 VP8 codec alias；
- 8-bit 4:2:0 范围；
- 有效正整数 coded dimensions，且不超过已配置资源上限。

### 7.2 Worker 复用

WASM adapter 使用抽取后的同一 `WorkerVideoDecoderAdapter`、协议和
`VideoDecoderWorkerController`。WASM Worker 的 configure extension 只在内部消息中传递已经
校验的 codec/track/capability snapshot 和 `wasmBaseUrl`；controller 负责 session/request
identity、epoch、pending frame matching、stale close、reset、flush 和 error sanitation。

Worker 内的执行顺序：

1. 收到 WASM configure 后创建 restricted Manager 并注册 VP8 plugin。
2. 此时才读取 snapshot 中 isolation/SAB/threads/SIMD 并选择变体。
3. Manager 校验 URL、size、SHA-256，compile 后交给 plugin instantiate。
4. plugin 验证 ABI exports，创建 libvpx context，并报告 configured。
5. decode 接收 Phase 2 的原始 `DemuxPacket.data`，不重新 demux 或复制 packet 协议。
6. 每个输出 frame 通过既有 request timestamp matching 和 transferable response 返回。
7. reset 提升 epoch、清空 pending request、销毁并重建 libvpx context；旧 frame 立即 close。
8. EOS 先 drain `receive_frame`，再 `flush`，最后沿用 Custom Pipeline 的 decoder/audio drain 条件。
9. close 释放 input allocation、未领取 frame、libvpx context、instance 和 Manager，且幂等。

decode queue、decoded FrameQueue、buffered duration 和 low-water backpressure 继续由既有
Worker adapter 与 Custom Pipeline 的三重门禁控制，不增加第二套队列或 push API。

## 8. Core 与 Strategy 接入

Core 在完成 container/capability probe 后按以下方式建立上下文：

```text
wasmBaseUrl absent
  -> no Manager, no plugin declaration, no WASM candidate, no WASM request

wasmBaseUrl present
  -> validate base URL
  -> create restricted VP8 plugin declaration
  -> createCapabilityContext(snapshot, report, declarations)
  -> Strategy may rank a wasm candidate
```

由于 10.4 不在范围内，含音频轨的媒体不会形成完整 WASM candidate：现有 Strategy 要求视频
和音频查询都具有对应声明。10.2 的真实 end-to-end fixture 因此使用 video-only VP8 WebM。

`createCandidateScope()` 对 `webcodecs` 和 `wasm` 都构造同一个 `CustomMediaPipeline`；差异只在
注入的 decoder adapter。两者复用 Renderer、Audio controller、FrameQueue、pull reader、
seek、EOS 和 candidate cleanup。WASM candidate 初始化不再返回“no Core adapter”。

现有 `runCandidateAttempts()` 保持唯一的候选控制器：

- WebCodecs configure/init 失败，先关闭该 candidate scope，再尝试 WASM。
- WASM threaded 失败由 Manager 内部回退；Manager 全部变体失败才把错误交回候选控制器。
- 失败 candidate 的 canvas、renderer、decoder Worker、Manager、preview 和事件缓冲全部清理后
  才初始化下一候选。
- session epoch 与 candidate attempt token 双重门禁继续拒绝旧 WebCodecs/WASM frame。
- URL、Range、container、target、显式取消、epoch supersede 和 engine close 不进入下一候选。

## 9. 样本与供应链资料

真实样本从仓库已有 MDN interactive-examples `flower.webm` 生成。原文件为 CC0，已记录：

```text
source: https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm
source sha256: C6F8A348953395598A9A73B9BAB1676436410797BCE9F398F4BE1531D6E76DDA
```

构建测试 fixture 时使用固定容器镜像和 ffmpeg 命令，从该 CC0 源确定性转码为 video-only VP8、
非 16 对齐尺寸。文件按以下规则命名：

```text
webm-vp8-p0-8bit-642x358.webm
```

同目录 provenance 记录源 URL、源/输出 SHA-256、CC0、转码命令、ffmpeg 版本、尺寸、profile、
bit depth 和无音频事实。不得引入版权不明媒体或上游 libvpx conformance vectors。

每个 WASM 变体记录：asset path、bytes、SHA-256、libvpx tag/commit、wrapper commit、emsdk
版本/image digest、configure flags、emcc/link flags、imports/exports、license、PATENTS 和
`review: restricted`。许可证全文与 PATENTS 原文随开发资源保存。

## 10. 错误与安全

新增稳定错误码只覆盖新的公共边界：

```text
WASM_RUNTIME_UNAVAILABLE
WASM_EXPORT_INVALID
WASM_FRAME_ABI_INVALID
WASM_DECODE_FAILED
WASM_RESET_FAILED
WASM_WORKER_FAILED
```

公开事件和 Worker error response 只保留 `code`、安全 message 和 recoverable。不得携带
WASM URL、packet、codec private data、plane pointer、像素、Frame、原始 `WebAssembly.Exception`、
stack 或平台错误对象。

所有 descriptor pointer、plane range、timestamp、duration、dimensions 和 enum 在 JS 读取前
验证。WASM base URL 继续使用 Manager 的同源 base-path 约束、拒绝 credentials/hash/redirect，
资源继续校验 size 与 SHA-256。

## 11. 测试设计

### 11.1 Runtime、Manifest 与 ABI

- 三个真实 `.wasm` 均通过 `WebAssembly.compile`；支持的环境完成 instantiate 和 export 验证。
- 使用真实 VP8 fixture 的 demux packet 解码，不使用 fake packet 作为真实 decode 结论。
- 第一帧为 I420，三个 plane offset/stride/rows/rowBytes/byteLength 正确且不重叠。
- `642x358` 非 16 对齐样本保持真实 coded/visible/display 尺寸与 chroma 向上取整。
- TrackInfo 颜色优先、decoder fallback、VP8 default 和 unspecified 映射分别验证。
- 损坏 magic/version/descriptor/plane range/enum 被拒绝且 frame token 仍释放。

### 11.2 变体与回退

- 非隔离/隔离、有/无 SIMD 四种组合得到固定顺序。
- 非隔离测试断言 fetch log 中从未出现 threaded URL。
- threaded instantiate 或 plugin init 失败后只顺序请求 simd/single，最终真实 single 解码继续。
- 未选中的 Codec 和未选中的后续变体不下载。
- hash/size 错误进入 failure ledger，不重复初始化同一坏资产。

### 11.3 Worker、Core 与所有权

- WASM Worker 复用协议完成 configure/decode/reset/flush/close。
- 连续 seek 提升 epoch，旧 Worker frame 在进入 FrameQueue 前 close，Renderer 不收到旧 epoch。
- WebCodecs candidate 初始化失败后完整清理，原子提交 WASM candidate，decision trace 顺序正确。
- max decode queue、max decoded frames、max buffered duration 和 low-water mark 全部生效。
- EOS drain 后 `readVideoFrame()` 返回 `null`，不丢最后一个延迟 frame。
- 每个 frame token release 恰好一次；decoder close 后 debug live frames/bytes 为零。
- 每个 `VideoFrame` 在 stale/drop/render/caller 路径恰好 close 一次，插件不关闭已转移 frame。

### 11.4 浏览器与画面

- Chromium 与 Firefox 在非隔离测试服务使用 single/SIMD 解码并渲染非空 Canvas 像素。
- 隔离测试服务验证 threaded 优先与可控失败回退。
- Playwright WebKit 只记录 WebAssembly/Worker/VideoFrame 能力结果；物理 macOS Safari 最新两个
  稳定大版本的真实播放证据若本机不可用，必须保持 pending，不能用 Playwright WebKit 代替。
- canvas pixel check 证明不是全透明或单一清屏色；截图只作为辅助，不替代像素断言。

## 12. 文档与状态更新

完成实现后更新：

- `docs/development/phase-10-acceptance.md`：精确源码/测试行数、test count、fixture 与三变体
  SHA-256、来源、许可证、专利结论、编译选项和真实执行结果；10.3-10.5 保持 pending。
- `docs/development/execution-plan.md` 与 `docs/development/roadmap.md`：Phase 10.2 完成，Phase 10
  总体仍未完成且不可发布。
- `CHANGELOG.md`：真实 VP8 restricted slice、Core 回退和已知边界。
- 根 `README.md` 与相关包 README：显式 `wasmBaseUrl` opt-in、video-only VP8、默认不注册、
  不可发布、浏览器与隔离边界。
- 供应链 provenance、许可证全文、PATENTS 和构建说明。

## 13. 验收门禁

实现完成后必须全部运行并如实记录：

```text
pnpm typecheck
pnpm test
pnpm build
pnpm test:browser
git diff --check
```

此外必须执行真实模块 imports/exports audit、三个资产 SHA-256 校验、fixture provenance 校验、
Browser release manifest 排除断言、非空 canvas pixel check 和未选中资产网络请求审计。

只有以下条件同时满足才标记 Phase 10.2 完成：

- video-only VP8 fixture 经真实 WASM 在 Custom Pipeline 逐帧输出并渲染非空画面；
- 连续 seek 无旧 epoch 画面且队列/内存有界；
- 非隔离环境可使用 single 或 SIMD；
- threaded 初始化失败自动回退且播放不中断；
- libvpx 许可证、PATENTS、构建和哈希资料齐全；
- review 仍为 `restricted`，Browser release manifest 不含该二进制；
- 10.3、10.4、10.5 和物理 Safari 未执行项保持 pending。

## 14. 明确非目标

- 不实现 VP9、AV1 或其他视频 Codec 插件。
- 不实现 WASM 音频或 PCM ABI；本设计的 frame descriptor 只冻结视频部分，未来音频使用独立
  MXWA PCM ABI，不把音频字段塞入 MXWF。
- 不实现 FFmpeg 兜底或改变其许可门禁。
- 不修改 Renderer、AI、字幕或 UI 行为。
- 不把 restricted 资产加入正式分发，不因测试通过宣称 VP8 已可发布。
