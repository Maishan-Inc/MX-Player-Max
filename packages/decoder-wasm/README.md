# @mx-player-max/decoder-wasm

Phase 10 交付 WASM Decoder Manager 和 Codec 插件注册边界。Manager 只在策略已经选中
WASM 后运行，按能力快照选择 `threaded`、`simd` 或 `single`，并按需获取、缓存和验证
对应资源。

## 公共入口

```ts
import {
  createWasmDecoderManager,
  createWasmDecoderRegistry,
  type WasmDecoderPlugin,
} from '@mx-player-max/decoder-wasm'
```

插件必须提供经过审查的 manifest、Codec/Track 匹配函数和实例工厂。Manager 默认拒绝
没有 `review.status === 'approved'` 的资产：

```ts
const registry = createWasmDecoderRegistry([plugin])
const manager = createWasmDecoderManager({
  baseUrl: 'https://cdn.example.test/mx-wasm/',
  registry,
})
const decoder = await manager.load(codec, track, capabilities)
```

`manager.declarations()` 只向策略层公布当前 review gate 允许加载的插件；默认不会把
`pending` 或 `restricted` 资产声明成可用 Decoder。仅内部测试可以通过
`requireApprovedReview: false` 同时关闭声明过滤和加载门禁。Manifest 校验结果会深度
冻结，插件注册后不能通过修改嵌套 URL、哈希或 review 元数据改变已校验的加载上下文。

`threaded` 只有在 `crossOriginIsolated`、`SharedArrayBuffer` 和 `wasmThreads` 都可用时
才会请求；否则按 `simd`、`single` 回退。哈希、编译或插件初始化失败只影响当前变体，
不会携带旧状态进入下一候选。相同 manifest/URL/hash 的并发资产加载共享一个请求，
不同变体不并行下载。

Manager 不负责 Demux、packet 队列、媒体 epoch、Renderer、AudioWorklet 或具体像素/PCM
ABI。插件实例的输出适配和 Core Custom Pipeline 接入属于后续阶段。

## 资源和发布边界

相对资源必须留在配置的 HTTP(S) `baseUrl` 下；`data:`、`blob:`、未验证的跨域跳转和
带用户名/密码的 URL、未批准 review 的 manifest 都会被拒绝。请求使用
`redirect: 'error'`，注入的 fetcher 即使跟随跳转，Loader 也会检查 `response.redirected`。
Cache Storage 不可用时可以使用内存缓存。

## 稳定错误

- 注册与输入：`WASM_MANIFEST_INVALID`、`WASM_PLUGIN_DUPLICATE`、
  `WASM_PLUGIN_NOT_FOUND`、`WASM_REVIEW_REQUIRED`。
- 资源与运行时：`WASM_VARIANT_UNAVAILABLE`、`WASM_URL_INVALID`、
  `WASM_FETCH_FAILED`、`WASM_HASH_MISMATCH`、`WASM_CACHE_FAILED`、
  `WASM_INSTANTIATE_FAILED`、`WASM_PLUGIN_INIT_FAILED`。
- 生命周期与聚合：`WASM_ABORTED`、`WASM_CLOSED`、`WASM_ALL_VARIANTS_FAILED`。

没有能力兼容的构建产物返回 `WASM_VARIANT_UNAVAILABLE`；只有实际尝试过兼容变体并全部
失败时才返回 `WASM_ALL_VARIANTS_FAILED`。聚合错误的 `attempts` 只包含插件 ID、变体、
稳定错误码和安全摘要，不包含响应正文。

当前仓库不包含 OpenH264、dav1d、libvpx、libde265、VVdeC 或 FFmpeg 的 WASM 二进制。
每个正式二进制仍必须记录上游 commit、编译器、flags、许可证、专利风险、真实体积和
SHA-256，并在发布前完成供应链审查。
