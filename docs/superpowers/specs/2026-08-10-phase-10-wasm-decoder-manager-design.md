# Phase 10: WASM Decoder Manager Design

状态：已批准；Manager + Plugin Factory 实现完成，真实 Codec 与 Core 接入不在本设计范围。

## 1. 目标与范围

Phase 10 的第一步交付一个可测试的 `@mx-player-max/decoder-wasm` Manager 和
Codec 插件契约。它负责在策略已经选择 WASM 后，注册插件、校验 manifest、选择
single/SIMD/threaded 变体、按需加载和缓存二进制、校验 SHA-256、实例化模块，并在
变体或插件初始化失败时原子回退。

本阶段不提交真实 WASM 二进制，不接入 OpenH264、dav1d、libvpx、libde265、VVdeC
或 FFmpeg 的生产构建，不改造 Core Custom Pipeline 的 WebCodecs/WASM 切换，也不
宣称任何真实 Codec 已可播放。所有测试使用 fake fetcher、runtime、cache 和 plugin。

## 2. 架构边界

```text
WasmDecoderManager
  ├─ DecoderRegistry        codec/track → plugin candidates
  ├─ VariantSelector        CapabilitySnapshot → ordered variants
  ├─ VerifiedAssetLoader    URL → verified bytes/module
  ├─ FailureLedger          session-level failed variants
  └─ PluginFactory          verified module → decoder instance
```

数据流固定为：

```text
selected wasm BackendCandidate
  → Manager.load(codec, track, capabilities)
  → Registry resolves matching plugins
  → VariantSelector creates an ordered list
  → fetch/cache → SHA-256 verification → WebAssembly.compile
  → plugin.create(context) (plugin-owned instance construction)
  → instance, or atomic fallback to the next candidate
```

`decoder-wasm` 只依赖 `@mx-player-max/types`。它不依赖 Core、Demux、Renderer、
Audio、Subtitles、UI 或演示站，不判断浏览器名称，也不重新选择 HTMLVideo/WebCodecs。
策略层仍负责选择 `BackendCandidate.kind === 'wasm'`；Manager 只有在这个边界之后才
读取能力快照中的 `crossOriginIsolated`、`SharedArrayBuffer`、`wasmThreads` 和
`wasmSimd`。

## 3. Manifest 契约

保留现有 `variants` 和 `sha256` 映射，补齐构建和能力元数据：

```ts
type WasmVariant = 'threaded' | 'simd' | 'single'

interface WasmDecoderManifest {
  codec: string
  version: string
  variants: Partial<Record<WasmVariant, string>>
  sha256: Partial<Record<WasmVariant, string>>
  sizeBytes?: Partial<Record<WasmVariant, number>>
  supportsVideo: boolean
  supportsAudio: boolean
  profiles?: readonly string[]
  levels?: readonly string[]
  pixelFormats?: readonly string[]
  bitDepths?: readonly (8 | 10 | 12)[]
  license: string
  upstream: string
  compiler: string
  buildFlags: string
  patentRisk: string
  review?: {
    status: 'approved' | 'restricted' | 'pending'
    notes?: string
  }
}
```

校验规则：

- 所有供应链字符串必须是有界非空字符串；manifest 至少声明一个变体。
- 每个变体必须同时存在合法 64 位 SHA-256；`sizeBytes` 若存在必须为正整数。
- 拒绝未知变体、非法能力值和 `supportsVideo === false && supportsAudio === false`。
- 默认只加载 `review.status === 'approved'` 的插件。显式的内部测试选项可以关闭
  review gate，但生产默认不能绕过它。
- `codec` 采用规范化字符串作为 Registry 键；完整 profile/level 匹配由插件的
  `supports()` 负责，Manager 不猜测 Codec 私有数据。

## 4. Plugin 与 Manager 公共契约

```ts
interface WasmDecoderPlugin {
  readonly id: string
  readonly priority: number
  readonly manifest: WasmDecoderManifest
  supports(codec: string, track: TrackInfo): boolean
  create(context: WasmDecoderCreateContext): Promise<WasmDecoderInstance>
}

interface WasmDecoderCreateContext {
  readonly variant: WasmVariant
  readonly module: WebAssembly.Module
  readonly manifest: WasmDecoderManifest
  readonly track: TrackInfo
  readonly capabilities: CapabilitySnapshot
  readonly signal: AbortSignal
}

interface WasmDecoderPluginDescriptor {
  readonly id: string
  readonly priority: number
  readonly codec: string
  readonly version: string
  readonly supportsVideo: boolean
  readonly supportsAudio: boolean
  readonly variants: readonly WasmVariant[]
}

interface WasmDecoderAssetCache {
  get(key: string): Promise<Uint8Array | null>
  set(key: string, bytes: Uint8Array): Promise<void>
  markFailure(key: string): void
  hasFailed(key: string): boolean
}

interface WasmDecoderRuntime {
  compile(bytes: Uint8Array): Promise<WebAssembly.Module>
}

interface WasmDecoderManager {
  register(plugin: WasmDecoderPlugin): void
  unregister(id: string): boolean
  list(): readonly WasmDecoderPluginDescriptor[]
  load(
    codec: string,
    track: TrackInfo,
    capabilities: CapabilitySnapshot,
    options?: { signal?: AbortSignal },
  ): Promise<WasmDecoderInstance>
}
```

Manager factory options inject `baseUrl`, `fetcher`, `cache`, `runtime` and an optional
`requireApprovedReview` flag. The default browser adapters use `fetch`, Cache Storage and
`WebAssembly.compile`; tests replace each adapter. An omitted load signal is represented by
an internal non-aborted signal, so plugin factories always receive a signal.

`WasmDecoderInstance` 保留当前骨架中的 `decode(packet, timestamp, key)`、`flush()`
和 `close()` 生命周期，并带上 `pluginId`、manifest 和实际 `variant`。Manager 不
拥有容器 packet 排队、媒体 epoch、视频像素格式或音频 PCM ABI；这些职责属于未来的
具体 Codec adapter 和 Core pipeline。任何具体插件仍必须遵守统一帧/音频输出边界。

Registry 允许同一个 Codec 有多个插件。候选按 `priority` 降序、`id` 升序稳定排序，
因此专用 Codec 插件可以排在低优先级 FFmpeg 兜底之前。注册时校验 manifest、拒绝重复
插件 ID，并保留 `WasmDecoderDeclaration` 的显式能力声明，避免策略层从 URL 或浏览器
能力猜测解码器存在。

## 5. 变体选择与加载流程

VariantSelector 只返回实际存在的变体，并遵守以下顺序：

1. `threaded` 仅在 `crossOriginIsolated && sharedArrayBuffer && wasmThreads` 全部为
   `true` 且 manifest 提供该变体时加入。
2. `simd` 仅在 `wasmSimd === true` 且 manifest 提供该变体时加入。
3. `single` 在 manifest 提供时作为最终兜底。

非隔离环境不会请求或下载 `threaded`。缺失 SIMD 时可以从 threaded 直接回退 single；
没有任何可用变体时立即返回稳定错误。选择不调用浏览器名称或 User-Agent 分支。

每个插件的加载按顺序执行：

1. 由 `manifest/version/variant/sha256/resolvedUrl` 生成缓存键。
2. 查询注入的内存或 Cache Storage 实现；缓存命中仍重新计算 SHA-256。
3. 缓存未命中时使用注入的 `fetcher` 获取完整字节，要求成功 HTTP 响应。
4. 使用 `crypto.subtle.digest('SHA-256', bytes)` 校验内容；校验失败标记当前变体。
5. 使用注入的 `WebAssemblyRuntime` 编译 module，成功后调用插件 `create()`；具体
   `WebAssembly.Instance` 和 Codec ABI 由插件拥有。
6. 返回实例；任一哈希、实例化或插件初始化失败都只影响当前候选并原子尝试下一项。

同一缓存键的并发加载共享一个 in-flight Promise；不同变体不能并行下载。成功加载
的 asset 可以复用于多个实例，但每次 `load()` 都由插件创建独立 decoder instance。

## 6. URL、缓存和失败语义

- `baseUrl` 和 variant URL 只允许 HTTP(S)；相对路径必须留在配置的 base origin/path
  下，禁止 `data:`、`blob:` 和未验证的隐式跨域跳转。
- Cache Storage 的 key 不使用远程响应正文；至少包含插件 ID、Codec、版本、变体、
  SHA-256 和解析后的 URL，避免不同 manifest 互相污染。
- 缓存命中但哈希错误时标记该 key 为失败并回退，不把损坏内容交给 WebAssembly。
- Failure Ledger 在 Manager 会话内记忆坏变体，防止同一坏资源被反复初始化。
- `AbortSignal` 触发返回 `WASM_ABORTED`，取消不进入普通回退链；Manager `close()`
  取消未完成加载并使后续加载返回 `WASM_CLOSED`。
- Decoder instance 的资源由 Manager 管理并在 Manager 关闭时幂等释放；instance 自身
  的 `close()` 也必须幂等。

以下稳定错误码必须加入公共 `ErrorCodes`，并由 `decoder-wasm` 只使用这些值：

```text
WASM_MANIFEST_INVALID
WASM_PLUGIN_DUPLICATE
WASM_PLUGIN_NOT_FOUND
WASM_VARIANT_UNAVAILABLE
WASM_URL_INVALID
WASM_FETCH_FAILED
WASM_HASH_MISMATCH
WASM_CACHE_FAILED
WASM_INSTANTIATE_FAILED
WASM_PLUGIN_INIT_FAILED
WASM_REVIEW_REQUIRED
WASM_ABORTED
WASM_CLOSED
WASM_ALL_VARIANTS_FAILED
```

聚合错误保留按插件/变体排序的失败摘要和稳定原因，不包含响应正文、完整远程媒体或
其他敏感数据。

## 7. 测试与阶段验收

测试新增到 `packages/decoder-wasm/tests`，不提交真实二进制：

- Manifest 合法样本、缺字段、未知变体、非法哈希/大小、空能力和 review gate。
- Registry 重复 ID、优先级排序、Codec/Track 匹配和声明转换。
- Selector 的隔离/非隔离、SIMD/Threads 缺失、部分变体组合，并断言非隔离不请求
  threaded。
- Loader 的 URL 边界、HTTP 错误、正确/错误哈希、损坏缓存、Cache Storage、Abort
  和 in-flight 去重。
- Manager 的 threaded → simd → single 回退、插件初始化失败后的下一个插件、所有
  变体失败的聚合错误、关闭和重复关闭。
- 资源纪律：失败实例不泄漏、每次只有一个变体下载/实例化、实例与 Manager 的 close
  都是幂等的。

阶段命令为 `pnpm typecheck`、`pnpm test`、`pnpm build` 和 `git diff --check`。文档
交付包括 `packages/decoder-wasm/README.md`、WASM/Codec 架构文档更新、
`docs/development/phase-10-acceptance.md`、`docs/README.md` 和 `CHANGELOG.md`。
另提供只使用 fake plugin 的诊断/测试入口，证明 Registry、选择顺序和回退链；它不
接管 Core 播放流程。

退出条件是：严格类型检查、全仓测试和构建通过；Manager 在变体能力组合下行为确定；
未选中的 Codec 不发起 fetch；哈希/实例化/插件初始化失败可原子回退或返回稳定聚合
错误；真实 WASM 二进制和真实浏览器 Codec 矩阵保持明确的后续发布门禁。
