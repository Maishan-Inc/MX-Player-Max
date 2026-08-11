# Phase 12 SDK、演示站与发布设计

日期：2026-08-11

状态：已确认，待实施计划

## 1. 目标

Phase 12 把现有媒体引擎、官方 UI 和框架适配器整理为可验证、可分发、可由第三方直接接入的产品形态。本阶段完成发布就绪产物、演示站诊断体验和自动化发布流程，但本次开发不执行 npm publish、GitHub Release 或任何外部版本发布。

退出结果必须同时支持：

- npm ESM 接入；
- jsDelivr 固定版本 ESM 接入；
- 无构建工具页面通过 IIFE 全局入口接入；
- 自托管 Worker、AudioWorklet 和未来 WASM 资源；
- Docker 演示站展示真实能力探测、后端决策和运行状态。

## 2. 范围与非目标

### 2.1 本阶段范围

- 稳定现有 `@mx-player-max/sdk`、`@mx-player-max/ui`、`@mx-player-max/react` 和 `@mx-player-max/vue` 公共入口。
- 新增 `@mx-player-max/browser` 聚合包。
- 产出 ESM、IIFE、压缩 IIFE、声明文件和独立 UI CSS。
- 统一公开包的发布元数据、条件导出和 tarball 内容。
- 增加安全、有界、可序列化的播放决策 trace。
- 补齐 Core 候选初始化控制器和 epoch 安全的原子回退。
- 将 Demo 扩展为真实播放与诊断工作台。
- 生成版本化资源 manifest、SHA-256/SHA-384 摘要和 SRI 数据。
- 增加 pack、临时消费者、Docker 和浏览器自动化验证。
- 将 release workflow 拆分为验证、打包、产物上传和显式发布阶段。

### 2.2 非目标

- 不执行真实 npm、GitHub Release 或 CDN 发布。
- 不接入真实 WASM Codec 二进制，不解除 Phase 10 的许可证与专利门禁。
- 不新增 HLS、DASH、MSE、直播、DRM 或移动端播放实现。
- 不重复实现 Phase 9 已完成的控制条、字幕菜单或 React/Vue 控制逻辑。
- 不把 UI 合入 SDK，也不让 Core、SDK 或 UI 反向依赖 Demo 或 browser 聚合包。
- 不以 Playwright WebKit 结果代替物理 macOS Safari 验证。
- 不借原子回退名义实现尚不存在的 MSE、真实 WASM Codec 或新播放后端；控制器只初始化
  当前 Core 已具备的后端适配器。

## 3. 包与依赖架构

新增 `packages/browser`：

```text
@mx-player-max/types
        ↑
@mx-player-max/sdk ← @mx-player-max/ui
        ↑                 ↑
        └── @mx-player-max/browser
```

`@mx-player-max/browser` 只通过公开入口依赖 SDK、UI 和 types。它负责组合和分发，不负责能力探测、后端评分、解码、渲染或字幕解析。

现有依赖边界保持不变：

- Core 不依赖 UI、React、Vue、browser 或 Demo。
- SDK 不依赖 UI，继续适合无控件或自定义控件的集成。
- UI 继续消费 SDK 的稳定公共 API。
- React/Vue 继续直接组合 SDK 与 UI，不经由 browser 聚合包。
- Demo 只消费公开包入口，不跨包读取内部文件。

## 4. Browser 聚合包

### 4.1 产物

`@mx-player-max/browser` 发布以下文件：

```text
dist/index.js
dist/index.d.ts
dist/mx-player-max.iife.js
dist/mx-player-max.iife.min.js
dist/style.css
```

- `index.js` 是标准 ESM 入口。
- 两个 IIFE 文件暴露唯一全局名 `MXPlayerMax`。
- `style.css` 复用 `@mx-player-max/ui/style.css` 的构建产物，不维护第二套样式源。
- Worker、AudioWorklet、模型和未来 WASM 资源不内联进 IIFE，继续通过资源基址与版本 manifest 按需解析。

### 4.2 公共入口

Browser 包导出：

- `create(options): BrowserPlayerHandle`；
- `MXPlayer`；
- `attachPlayerUi`；
- Browser 组合层相关类型。

`create()` 接受 SDK 播放参数、UI 参数和可选 CSS/资源配置。它创建 SDK，随后把 UI 挂到同一宿主节点。返回的 `BrowserPlayerHandle` 至少包含：

- `player`：底层 SDK 实例；
- `ui`：UI controller；
- `ready`：当前加载会话的 Promise；
- `load()`：复用宿主和 UI 的换源入口；
- `destroy()`：先清理 UI、再清理 SDK 的幂等销毁方法。

如果 UI 挂载失败，组合层必须销毁已经创建的 SDK。SDK 加载失败时保留现有可恢复错误语义，但不得留下半挂载 UI 或事件订阅。

### 4.3 全局入口

无构建工具页面使用固定版本资源：

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@mx-player-max/browser@VERSION/dist/style.css">
<script src="https://cdn.jsdelivr.net/npm/@mx-player-max/browser@VERSION/dist/mx-player-max.iife.min.js"></script>
```

随后通过 `MXPlayerMax.create(...)` 创建带官方控件的播放器。文档必须同时给出带 SRI 的示例，并明确固定版本 URL，不推荐生产环境使用 `latest`。

## 5. 公共播放决策 Trace

Demo 的 Backend Decision 面板不能读取 Strategy 或 Core 私有状态，因此在 types、Core 和 SDK 增加稳定的只读诊断契约 `PlaybackDecisionTrace`。

Trace 包含：

- 当前 `sessionEpoch` 和生成时间；
- 输入媒体的去敏摘要；
- 候选后端的稳定 ID、类型、renderer、初始分数和原因；
- 平台评分 adjustment 和 Issue 规则的公开原因；
- 能力或媒体级验证导致的拒绝原因；
- 按顺序记录的初始化尝试、失败错误码和最终选择；
- 最终状态：selected、failed 或 closed。

Trace 不包含：

- 本地文件对象、远程 URL、请求 header 或响应内容；
- Codec 私有数据、像素、帧、PCM 或字幕正文；
- 原始异常堆栈、GPU 标识细节或未经归一化的浏览器私有对象。

Core 保存当前会话的不可变 trace，`MediaEngine` 和 SDK 暴露 `decisionTrace` getter，并通过 `decisionchange` 事件发布新快照。所有异步写入必须检查 epoch，旧会话不得覆盖当前 trace。

## 6. 候选初始化与原子回退

现有 Strategy 已能按分数返回完整候选列表，但 Core 只调用 `select()` 初始化第一项。Phase 12
在 Core 组合层增加候选初始化控制器，Strategy 仍只负责生成、验证和排序，不创建后端实例。

初始化流程为：

1. Strategy 返回不可变的完整排序与评分信息。
2. Core 按顺序为每个候选创建全新的 candidate scope。
3. candidate scope 独占该次尝试创建的 pipeline、renderer、canvas、preview、subtitle 绑定和事件清理函数。
4. 只有候选完成必需初始化后，Core 才原子提交 `currentSelection`、活动资源和
   `backendchange`。
5. 可回退错误先完整销毁 candidate scope，再记录稳定错误码并尝试下一候选。
6. 候选用尽时返回聚合错误；聚合数据只含候选 ID、后端类型和稳定错误码。

以下错误不进入下一候选：源校验失败、Range/CORS/容器探测失败、无效 target、显式取消、
epoch 失效和 engine close。Autoplay 用户手势限制发生在后端已成功初始化之后，保留现有 ready
加可恢复错误语义，也不触发解码后端回退。

每次失败清理必须撤销 HTMLVideo source/listener、Custom canvas 替换、renderer/device、
decoder、AudioWorklet、preview、subtitle overlay 和候选事件订阅。旧候选的异步事件必须由
candidate attempt token 与 session epoch 双重拒绝，不能污染下一个候选或新 load。

当前阶段只允许回退到 Core 已真实实现的 Native 和 WebCodecs Custom 后端。WASM candidate
若没有对应 Core adapter，必须在初始化前以稳定的 `CUSTOM_BACKEND_UNAVAILABLE` 记录为失败，
不得下载二进制或伪装为可播放。该控制器为后续真实 WASM adapter 保留同一接口。

## 7. Demo 运行与界面

Demo 保留 Phase 9 已有播放器和来源控制，在其上增加四个只读诊断面板：

1. Probe：容器、轨道、媒体属性、能力快照和隔离状态。
2. Decision：候选排序、平台调整、拒绝原因、初始化尝试和最终后端。
3. Runtime：Decoder 路径、Renderer、音频时钟、缓冲、丢帧和降级状态。
4. Subtitles：轨道、选择状态、当前 cue 数量、样式状态和解析诊断计数。

数据只来自 SDK 的稳定 getter、事件和序列化快照。无法由标准 API 确认的硬件解码、HDR、Codec 或平台状态显示 `unknown` 或 `pending verification`，不得推断为 supported。

GSAP 仅处理页面入场、面板切换和状态数字变化。播放器在 React mount 后立即创建，初始化 Promise 不依赖 GSAP timeline。`prefers-reduced-motion` 下取消位移动画和 stagger，只保留即时状态更新。

诊断面板使用与现有 workbench 相容但职责独立的布局，不复制 MX-Player-Pro 页面结构。窄屏可折叠为单列，但 Phase 12 不扩大移动端播放兼容范围。

## 8. 发布元数据

所有公开包统一检查并补齐：

- `name`、`version`、`description`、`license`、`repository`、`homepage`、`bugs`；
- `type`、`types`、`main`、`module`；
- `exports` 条件导出；
- `files` allowlist；
- `publishConfig.access`；
- 正确的 `sideEffects`；
- package README 与 API/兼容说明。

纯 TypeScript/JavaScript 包使用 `sideEffects: false`。UI 与 browser 包只把 CSS 声明为 side effect。UI 继续导出 `./style.css`；browser 包导出根 ESM、`./style.css`、`./iife` 和 `./iife.min`。

pnpm workspace 依赖在 tarball 中必须被改写为真实版本范围。验证脚本要检查打包后的 `package.json`，禁止发布仍含 `workspace:*` 的依赖描述。

## 9. 资源 Manifest、哈希与 SRI

构建后生成版本化发布 manifest，记录：

- SDK/browser 版本；
- JS、CSS、Worker、AudioWorklet 和允许发布的 WASM/模型资源路径；
- 文件字节数、SHA-256、SHA-384 和 MIME；
- IIFE/CSS 可直接使用的 SRI 字符串；
- WASM/模型的许可证审查状态和 publishable 标志。

未通过许可证门禁的二进制可以作为开发条目存在，但不得进入 publishable 资源列表，也不得被 release workflow 上传为正式发布资产。

资源 URL 解析必须支持显式 `assetBaseUrl`、`wasmBaseUrl` 和 `aiModelBaseUrl`。默认值只能相对于当前 ESM 模块或 IIFE 脚本位置计算，不能依赖 Demo origin。

## 10. Docker 与静态服务

Docker Demo 继续启用：

- `Cross-Origin-Opener-Policy: same-origin`；
- `Cross-Origin-Embedder-Policy: require-corp`；
- `X-Content-Type-Options: nosniff`；
- 明确的静态资源 MIME 和长期版本化缓存。

媒体样本必须支持 GET Range、`206 Partial Content`、`Content-Range` 和稳定 `Content-Length`。HTML 导航文件不得使用 immutable 缓存。Docker 验证必须检查隔离状态、静态资源响应头、Range 响应和不存在资源的稳定 404。

## 11. 错误处理

Browser 组合层增加稳定错误码，用于区分：

- 无效 target 或 options；
- SDK 创建/加载失败；
- UI 挂载失败；
- 资源 manifest 无效或版本不匹配；
- 必需 bundle 资源缺失。

组合层不吞掉 SDK 的媒体错误码，也不自行改变后端候选。候选级可恢复失败由新的 Core 初始化
控制器按排序原子回退；源、容器、取消和 epoch 错误直接终止。诊断面板只显示稳定错误码和
安全消息，不显示原始远程响应或异常堆栈。

所有 `destroy()`、失败清理和重复关闭路径必须幂等。构建或发布验证失败必须阻止产物上传；可选发布阶段失败不得修改已验证的本地产物。

## 12. 构建与 Release Workflow

引入 esbuild 作为 browser bundle 工具；TypeScript 继续负责声明文件与包级 ESM 构建。bundle 配置必须固定全局名、target、sourcemap 和 banner，不依赖 Demo 的 Vite 配置。

Release workflow 分为：

1. Validate：冻结锁文件安装、typecheck、unit、browser 和 build。
2. Package：生成 manifest/SRI，对所有公开包执行 `pnpm pack`。
3. Consumer smoke：在临时项目安装 tarball，验证 Node/浏览器 ESM、CSS export 和 IIFE 全局入口。
4. Artifact：上传 tarball、manifest、哈希和 bundle 报告。
5. Publish：仅在显式生产触发、受保护 environment 和令牌可用时运行 `pnpm publish -r`。

本阶段实现并验证前四段及第五段的门禁配置，但不触发 Publish。

## 13. 测试与验收

### 12.1 单元与包测试

- Browser `create/load/destroy` 生命周期和失败清理。
- IIFE 全局形状、ESM 导出和 CSS 文件存在性。
- Decision trace 的候选顺序、调整、失败、最终选择和 epoch 隔离。
- Trace 去敏和不可变性。
- 第一候选初始化失败后完整清理并成功提交第二候选。
- 不可回退错误、取消、close 和新 load 不会尝试下一候选。
- 失败候选的延迟事件不会修改当前 selection、trace、surface 或 playback snapshot。
- 候选全部失败时返回去敏聚合错误，且没有残留 video source、canvas、renderer 或订阅。
- Manifest schema、哈希、SRI 和 publishable 过滤。
- 每个公开包的 exports、files、sideEffects 和 workspace 版本改写。

### 12.2 Demo 与浏览器测试

- Probe、Decision、Runtime、Subtitles 四面板正常更新。
- Native 与 Custom 路径显示一致的数据结构。
- 加载失败、能力缺失、renderer 降级和字幕错误可解释。
- GSAP 不阻塞初始化，并尊重 reduced motion。
- Chromium、Firefox、Playwright WebKit 的 DOM/交互回归；物理 Safari 继续单独记录证据边界。

### 12.3 发布与 Docker 测试

- 每个 tarball 可被临时消费者安装与构建。
- tarball 不含源码、测试、快照、临时文件或未批准二进制。
- 固定版本 ESM/IIFE 示例可运行。
- SRI 与实际文件一致。
- Docker 镜像构建成功，COOP/COEP 和 Range 验证通过。

### 12.4 全仓门禁

必须运行：

```text
pnpm typecheck
pnpm test
pnpm build
pnpm test:browser
发布 pack/consumer 验证
Docker 构建与 HTTP smoke
git diff --check
```

## 14. 完成标准

Phase 12 完成时：

- SDK、UI、React、Vue 和 browser 包公共 API 有文档与稳定导出；
- 无构建工具页面可以通过固定版本 IIFE 创建带控件播放器；
- Demo 能解释媒体探测、候选评分、后端选择和运行降级；
- Native/WebCodecs 已实现候选遵循排序初始化，候选失败后原子清理并回退；
- npm tarball、jsDelivr 路径、SRI、manifest 和自托管资源都有可复现验证；
- Docker Demo 在隔离和 Range 条件下可运行；
- 发布 workflow 默认不会意外发布，生产发布需要显式授权；
- 没有把未审查 Codec/WASM 二进制标记为可发布；
- 本次开发没有执行任何真实外部发布。
