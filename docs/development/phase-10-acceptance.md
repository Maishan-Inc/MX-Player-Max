# Phase 10 验收记录

日期：2026-08-10

## 实现状态

Phase 10 当前交付 `@mx-player-max/decoder-wasm` 的可测试 Manager 和 Codec 插件边界：

- `WasmDecoderManifest` 校验构建来源、版本、变体 URL、SHA-256、体积、Codec 能力、
  profile/level、输出像素格式、位深、许可证、编译器、flags、专利风险和 review 状态。
- Manifest 拒绝未知字段并返回深度冻结的规范化数据。Registry 在调用插件匹配函数前
  强制核对 manifest Codec 与视频/音频轨道能力，再按优先级和 ID 稳定排序。
- Manager 默认只向策略层输出 review 已批准插件的 `WasmDecoderDeclaration`，不会让
  策略选择随后必然被发布门禁拒绝的资产。
- Manager 只在 WASM 已被策略选中后运行，按 `threaded → simd → single` 选择变体，
  非隔离页面不会请求 threaded。
- Loader 支持 HTTP(S) base path、内存/Cache Storage、SHA-256、失败记忆、并发去重和
  `AbortSignal`；拒绝 URL 凭据和重定向，哈希、编译、插件初始化失败逐候选原子回退。
- Manager 管理已创建实例，`close()` 和实例 `close()` 均幂等，并在关闭后拒绝新的注册/加载。
- 全体已批准插件没有兼容构建时返回 `WASM_VARIANT_UNAVAILABLE`；实际尝试的候选全部
  失败时才返回带安全 attempt 摘要的 `WASM_ALL_VARIANTS_FAILED`。

本阶段不包含真实 OpenH264、dav1d、libvpx、libde265、VVdeC 或 FFmpeg 二进制，不接入
Core Custom Pipeline，也不宣称任何真实 Codec 已在浏览器中可播放。二进制发布仍必须
完成许可证、专利和供应链审查。

## 自动化验证

| 命令 | 结果 |
|---|---|
| `pnpm --filter @mx-player-max/decoder-wasm typecheck` | passed |
| `pnpm --filter @mx-player-max/decoder-wasm test` | passed；32 tests |
| `pnpm --filter @mx-player-max/types test` | passed；21 tests |
| `pnpm typecheck` | passed；17 个工作区项目完成 build + strict typecheck |
| `pnpm test` | passed；428 tests |
| `pnpm build` | passed；17 个工作区项目及 Demo production build |
| `pnpm test:browser` | passed；12 tests，Chromium desktop/mobile、Firefox、WebKit |
| `git diff --check` | passed |

Manager 测试使用 fake fetcher/cache/runtime/plugin，覆盖 manifest 失败、Registry 重复
ID和优先级、隔离与非隔离变体选择、非隔离不下载 threaded、Cache/URL/SHA-256、坏资源
失败记忆、in-flight 去重、编译/插件初始化回退、review gate、策略声明过滤、无兼容变体、
Abort、重定向拒绝、注册时不可变元数据快照、跨 Manager 失败隔离、无效实例清理以及
实例关闭。32 项 decoder-wasm 测试包含 Memory 与 Cache Storage 两种缓存适配器。

全仓 428 项测试分布为：types 21、audio 32、capabilities 17、decoder-wasm 32、
decoder-webcodecs 57、demux 44、platform 3、postprocess 16、renderers 16、strategy 11、
subtitles 46、core 109、sdk 4、ui 18、react 1、vue 1。

## 边界审计

- `@mx-player-max/decoder-wasm` 的唯一生产依赖为 `@mx-player-max/types`；源码没有跨包内部引用。
- 仓库中的 `.wasm` 文件计数为 0，本阶段没有新增或伪装任何 Codec 二进制。
- 公共入口构建出 `dist/index.js` 与 `dist/index.d.ts`；全仓 Bundler 构建通过。
- Core、SDK、Worker、AudioWorklet 和 Demo 未接入 Manager，不宣称真实播放能力。

## 后续门禁

- 真实 Codec 二进制、Worker/像素输出适配、Core fallback 和 Chrome/Firefox/Safari 实际
  解码矩阵留到后续子阶段。
- 本次 Playwright 结果是 Windows 上的 Chromium/Firefox/WebKit UI 回归，不替代最新两个
  稳定大版本和物理 macOS Safari 的真实 WASM Codec、跨源隔离/非隔离播放验收。
- 任何 WASM 发布前必须补齐每个二进制的来源 URL、上游 commit、编译器/flags、NOTICE、
  许可证结论、专利风险说明、真实大小和 SHA-256。
