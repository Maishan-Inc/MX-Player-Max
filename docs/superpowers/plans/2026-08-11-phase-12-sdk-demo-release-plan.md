# Phase 12 SDK、演示站与发布实施计划

日期：2026-08-11

状态：已完成（自动化门禁通过；Docker CLI、真实物理浏览器矩阵和真实发布动作保持 pending/未执行）

依据：

- `docs/superpowers/specs/2026-08-11-phase-12-sdk-demo-release-design.md`
- `docs/development/execution-plan.md` 的 Phase 12
- `AGENTS.md`

本计划完成发布就绪产物和验证，不执行真实 npm publish、GitHub Release 或 CDN 发布。

## 执行原则

- 先闭合并提交现有 Phase 11 工作区，再修改 Phase 12 文件。
- 每个行为变更先增加能稳定失败的测试，再做最小实现。
- 公共契约先于 Core、Browser、Demo 和工作流修改。
- 候选失败必须清理 candidate scope 后再尝试下一项；禁止在已有半初始化资源上切换。
- Demo、脚本和 workflow 只能消费公开包入口或打包产物。
- 不把未审查 WASM/Codec 二进制加入 publishable manifest。
- 每个任务完成后运行聚焦验证并独立提交；最后运行全仓门禁。

## Task 0：闭合 Phase 11 门禁

### 文件

仅处理当前工作区中已存在的 Phase 11 文件，包括：

- `packages/platform/**`
- `docs/decisions/ADR-0005-platform-policy-and-issue-rules.md`
- `docs/development/phase-11-acceptance.md`
- `docs/superpowers/plans/2026-08-11-phase-11-browser-platform-optimization-plan.md`
- `docs/superpowers/specs/2026-08-11-phase-11-browser-platform-optimization-design.md`
- Phase 11 已修改的 README、架构、路线图和变更记录

### 步骤

1. 用 `git status --short` 和 `git diff --name-only` 确认所有脏文件都属于 Phase 11，禁止夹带 Phase 12 或用户无关改动。
2. 运行：

   ```text
   pnpm --filter @mx-player-max/platform typecheck
   pnpm --filter @mx-player-max/platform test
   pnpm typecheck
   pnpm test
   pnpm build
   pnpm test:browser
   git diff --check
   ```

3. 若结果与 `phase-11-acceptance.md` 不一致，先按系统化调试流程修正记录或实现。
4. 只暂存 Phase 11 文件并提交：

   ```text
   feat(browser): implement phase 11 platform optimization
   ```

### 完成条件

- Phase 11 工作区干净。
- Phase 12 设计提交保持独立。
- 不宣称未执行的真实浏览器/设备矩阵。

## Task 1：定义播放决策与回退公共契约

### 文件

- `packages/types/src/index.ts`
- `packages/types/tests/public-api.test.ts`
- `packages/types/tests/playback-ui-public-api.test.ts`
- `packages/strategy/src/index.ts`
- `packages/strategy/tests/strategy.test.ts`
- `packages/strategy/README.md`

### 测试先行

1. 为以下类型增加 compile-time/public API 测试：
   - `PlaybackDecisionCandidateTrace`
   - `PlaybackDecisionAttempt`
   - `PlaybackDecisionTrace`
   - `PlaybackDecisionStatus`
   - `StrategyEvaluation`
2. 为 `EngineEventMap.decisionchange`、`MediaEngine.decisionTrace` 和候选用尽稳定错误码增加契约测试。
3. 为 Strategy 增加失败测试，要求一次 evaluation 同时返回：
   - 原始候选；
   - 平台 adjustments；
   - 调整后的稳定排序；
   - 基于第一候选生成的 selection。
4. 验证 `rank()`、`select()` 现有调用保持兼容，并且 policy 每次 evaluation 只执行一次。

### 实现

1. 类型全部使用只读字段、稳定字符串 union 和去敏错误摘要，不包含 `unknown` 原始异常对象。
2. 扩展 `StrategyEngine.evaluate()`；`rank()` 和 `select()` 复用同一纯函数路径。
3. evaluation 保留候选调整前分数与 adjustment 明细；不得创建新候选或改变输入对象。
4. 增加 `STRATEGY_ALL_CANDIDATES_FAILED`，错误 payload 只允许候选 ID、kind 和稳定错误码。

### 验证

```text
pnpm --filter @mx-player-max/types typecheck
pnpm --filter @mx-player-max/types test
pnpm --filter @mx-player-max/strategy typecheck
pnpm --filter @mx-player-max/strategy test
```

### 提交

```text
feat(strategy): expose playback decision evaluation
```

## Task 2：实现纯候选初始化控制器

### 文件

- `packages/core/src/playback/candidate-controller.ts`
- `packages/core/src/playback/decision-trace.ts`
- `packages/core/tests/candidate-controller.test.ts`
- `packages/core/tests/decision-trace.test.ts`
- `packages/core/src/index.ts`

### 测试先行

增加不依赖 DOM/Decoder 的 fake candidate 测试：

1. 第一候选失败、scope 完整清理后第二候选成功。
2. 成功前不提交 selection，不发出成功 `backendchange`。
3. 每个 candidate 使用不同 attempt token。
4. 不可回退错误立即停止。
5. session epoch 改变、AbortSignal 或 engine close 立即停止，不尝试下一候选。
6. 候选全部失败时返回去敏聚合错误。
7. 旧 attempt 的延迟事件被拒绝。
8. cleanup 抛错不会阻止其余清理或掩盖原始候选错误。
9. trace 快照不可变、有界并按 attempt 顺序更新。

先运行测试确认因文件/实现缺失而失败，再实现最小控制器。

### 实现

1. 定义 Core 内部 `CandidateScope<T>`：
   - `commit()` 返回可提交资源；
   - `dispose()` 幂等清理；
   - `isActive()` 同时校验 session epoch 与 attempt token。
2. `runCandidateAttempts()` 只负责顺序、分类、清理、聚合和 trace，不包含 Native/WebCodecs 分支。
3. `decision-trace.ts` 负责从 Strategy evaluation 和 attempt 事件生成深度只读快照。
4. trace 更新回调只发送已去敏数据。

### 验证

```text
pnpm --filter @mx-player-max/core test -- candidate-controller decision-trace
pnpm --filter @mx-player-max/core typecheck
```

### 提交

```text
feat(core): add atomic candidate controller
```

## Task 3：接入 Native/WebCodecs 原子初始化

### 文件

- `packages/core/src/index.ts`
- `packages/core/src/playback/candidate-controller.ts`
- `packages/core/src/playback/decision-trace.ts`
- `packages/core/tests/backend-fallback.test.ts`
- `packages/core/tests/native-engine.test.ts`
- `packages/core/tests/custom-engine.test.ts`
- `packages/core/tests/custom-close.test.ts`
- `packages/core/README.md`

### 测试先行

1. 构造同时存在 Native 和 WebCodecs 候选的 media/capability fixture。
2. 让 Native 初始化稳定失败，断言：
   - Native listener/source/preview/subtitle 资源已清理；
   - WebCodecs 使用新 scope 初始化成功；
   - 最终 `selection` 只指向 WebCodecs；
   - `backendchange` 只对成功提交的后端发出；
   - trace 记录 Native error code 和 WebCodecs selected。
3. 让新 `load()` 在第一 attempt pending 时开始，断言旧 attempt 和后续候选均停止。
4. 让 source、Range、container 或 target 失败，断言不会进入候选循环。
5. 让 autoplay 被阻止，断言后端仍 ready 且不回退。
6. 让所有当前可实现候选失败，断言无 video source、canvas、renderer、pipeline、overlay 或订阅残留。
7. 对未接入 Core 的 WASM candidate 断言不下载资源，并记录稳定 unavailable attempt。

### 实现

1. 把 probe/capability/strategy evaluation 保留在候选循环外，只执行一次。
2. 将现有 Native 和 Custom 初始化拆成候选 scope 工厂；每个工厂只创建本候选资源。
3. 在 candidate 成功前，不写入：
   - `currentSelection`；
   - `activePipeline`；
   - `activeRenderer`；
   - `previewManager`；
   - `subtitleController`；
   - committed playback ready 状态。
4. 成功时一次性提交 scope；失败时从 scope 内逆序、幂等清理。
5. 统一 candidate error 分类：source/probe/target/cancel/epoch 不可回退，其余后端初始化错误按 `recoverable` 和错误码表决定。
6. `currentMedia` 可在 probe 完成后发布，但 trace 和 selection 必须遵循当前 epoch。
7. 保留 Native autoplay 和 Custom AI passthrough 的既有语义。

### 验证

```text
pnpm --filter @mx-player-max/core typecheck
pnpm --filter @mx-player-max/core test
pnpm --filter @mx-player-max/sdk test
```

### 提交

```text
fix(core): initialize playback candidates atomically
```

## Task 4：通过 SDK 公开安全 Decision Trace

### 文件

- `packages/sdk/src/index.ts`
- `packages/sdk/tests/playback-sdk.test.ts`
- `packages/sdk/README.md`
- `docs/api/player-ui.md`
- `docs/architecture/playback-decision-flow.md`
- `docs/architecture/codec-strategy.md`

### 测试先行

1. SDK `decisionTrace` 在 load 前为 `null`。
2. `decisionchange` 按 epoch 发布不可变快照。
3. load、fallback、失败、第二次 load 和 destroy 后状态正确。
4. 对 URL、headers、原始 error、Codec private data 和 subtitle text 做负向泄漏断言。

### 实现

- SDK getter 直接转发 MediaEngine 公共契约，不读取 Core 私有字段。
- 文档解释 trace 是诊断信息，不是应用自行重放 Strategy 的输入。
- 更新架构文档中“已有原子回退”的实现状态与错误分类。

### 验证

```text
pnpm --filter @mx-player-max/sdk typecheck
pnpm --filter @mx-player-max/sdk test
```

### 提交

```text
feat(sdk): expose playback decision trace
```

## Task 5：建立 Browser 聚合包生命周期

### 文件

- `packages/browser/package.json`
- `packages/browser/tsconfig.json`
- `packages/browser/README.md`
- `packages/browser/src/index.ts`
- `packages/browser/tests/browser.test.ts`
- `packages/browser/scripts/copy-style.mjs`
- `pnpm-lock.yaml`

### 测试先行

1. `create()` 创建 SDK 后在同一 host 挂载 UI。
2. `load()` 更新 `ready` 并复用 UI controller。
3. `destroy()` 按 UI -> SDK 顺序执行且幂等。
4. UI 挂载失败时销毁 SDK。
5. SDK load 失败时保留稳定媒体错误，同时不泄漏 UI 订阅。
6. 无效 target/options 返回 Browser 稳定错误码。

### 实现

- Browser 包仅通过 SDK/UI/types 公共入口组合。
- `BrowserPlayerHandle` 暴露 `player`、`ui`、`ready`、`load()`、`destroy()`。
- CSS 从 UI 构建产物复制，禁止复制样式源码或维护分叉。
- 每个包规范文件和测试目录齐全。

### 验证

```text
pnpm --filter @mx-player-max/browser typecheck
pnpm --filter @mx-player-max/browser test
pnpm --filter @mx-player-max/browser build
```

### 提交

```text
feat(distribution): add browser player package
```

## Task 6：生成 ESM/IIFE 分发产物

### 文件

- `packages/browser/esbuild.config.mjs`
- `packages/browser/package.json`
- `packages/browser/tests/bundle.test.ts`
- `package.json`
- `pnpm-lock.yaml`

### 测试先行

1. 构建后存在 ESM、声明、IIFE、minified IIFE 和 CSS。
2. 在隔离 DOM 环境加载 IIFE，只有 `globalThis.MXPlayerMax` 被创建。
3. 全局对象包含 `create`、`MXPlayer`、`attachPlayerUi`。
4. source map 不内联源码；production bundle 不含测试路径或绝对工作区路径。
5. Worker、AudioWorklet、WASM/模型内容未被错误内联。

### 实现

- 增加固定 esbuild 配置，global name 为 `MXPlayerMax`。
- ESM 继续由 TypeScript 输出；IIFE 由 esbuild 从 browser 公共入口打包。
- 固定 target、sourcemap、legal comments 和 deterministic 文件名。
- 根构建命令自然包含 browser 包，不依赖 Demo Vite。

### 验证

```text
pnpm --filter @mx-player-max/browser build
pnpm --filter @mx-player-max/browser test
```

### 提交

```text
feat(distribution): build esm and iife bundles
```

## Task 7：统一发布元数据与 tarball 内容

### 文件

- `packages/*/package.json`
- `packages/*/README.md` 中确有缺失的发布说明
- `LICENSE` 或现有许可证文件
- `scripts/release/verify-packages.mjs`
- `package.json`
- `pnpm-lock.yaml`

### 测试先行

编写验证脚本，先让它对当前包失败，并逐项检查：

- description/license/repository/homepage/bugs；
- main/module/types/exports/files/publishConfig；
- `sideEffects` 与 CSS 例外；
- package README、入口和声明存在；
- exports 目标位于 files allowlist；
- pack 后依赖中没有 `workspace:*`；
- tarball 不包含 `src`、`tests`、snapshot、tsbuildinfo、临时文件或未审查二进制。

### 实现

- 为所有公开包统一元数据，不改变包名或 `0.1.0` 版本。
- browser 包增加 `unpkg`、`jsdelivr` 和 IIFE/CSS 子路径。
- UI/browser 仅把 CSS 标为 side effect，其余包使用 `false`。
- 增加根命令 `verify:packages`。

### 验证

```text
pnpm build
pnpm verify:packages
```

### 提交

```text
build(distribution): validate publishable packages
```

## Task 8：生成资源 Manifest、哈希与 SRI

### 文件

- `scripts/release/generate-manifest.mjs`
- `scripts/release/manifest-schema.mjs`
- `scripts/release/tests/manifest.test.mjs`
- `packages/browser/package.json`
- `package.json`
- `.gitignore`
- `docs/architecture/wasm-and-distribution.md`

### 测试先行

1. 固定 fixture 生成稳定 SHA-256、SHA-384 和 SRI。
2. 路径排序和 JSON 输出确定性。
3. MIME、size、版本和资源类型正确。
4. 未审查 WASM/模型条目不能进入 publishable 列表。
5. 文件缺失、哈希变化、路径逃逸或重复资源稳定失败。

### 实现

- manifest 只扫描明确 allowlist，不递归信任整个 dist。
- 输出到构建产物目录，默认不提交生成文件。
- 增加 `release:manifest` 和 `test:release` 根命令。
- 记录自托管 `assetBaseUrl`、`wasmBaseUrl`、`aiModelBaseUrl` 解析规则。

### 验证

```text
pnpm build
pnpm test:release
pnpm release:manifest
```

### 提交

```text
build(release): generate asset manifest and sri
```

## Task 9：实现 pack 与临时消费者 Smoke

### 文件

- `scripts/release/pack-workspace.mjs`
- `scripts/release/consumer-smoke.mjs`
- `scripts/release/tests/consumer-fixture/**`
- `package.json`
- `.gitignore`

### 测试先行

验证 smoke 能捕获：

- 缺失 export；
- tarball 中残留 workspace protocol；
- CSS 子路径不可解析；
- IIFE 全局名错误；
- React/Vue peer dependency 被错误打入 dependencies；
- 安装后的声明文件不可解析。

### 实现

1. 在仓库内创建明确的临时根目录并校验绝对路径，使用 pnpm pack 生成所有公开包 tarball。
2. 临时消费者只安装本次 tarball，不从 workspace 直接解析源码。
3. 分别执行：Node ESM import、TypeScript build、browser IIFE smoke、React/Vue type smoke 和 CSS export 检查。
4. 清理仅限已验证的临时目录；失败时保留日志但不泄漏环境变量或 token。
5. 增加 `release:pack` 与 `release:smoke`。

### 验证

```text
pnpm release:pack
pnpm release:smoke
```

### 提交

```text
test(release): verify packed consumer installs
```

## Task 10：升级 Demo 为公开 API 诊断工作台

### 前置技能

实现前读取并遵循 `gsap-core`；如使用 timeline，再读取 `gsap-timeline`。不新增 ScrollTrigger 或其他未需要插件。

### 文件

- `apps/demo/src/App.tsx`
- `apps/demo/src/styles.css`
- `apps/demo/src/diagnostics.ts`
- `apps/demo/src/components/DiagnosticsPanel.tsx`
- `apps/demo/src/components/ProbePanel.tsx`
- `apps/demo/src/components/DecisionPanel.tsx`
- `apps/demo/src/components/RuntimePanel.tsx`
- `apps/demo/src/components/SubtitlePanel.tsx`
- `apps/demo/README.md`
- `packages/ui/tests/playwright/ui.spec.ts`
- 必要的 Playwright snapshot

### 测试先行

1. 面板只通过 React component handle 暴露的 SDK 公共 getter/event 更新。
2. Probe、Decision、Runtime、Subtitles 有稳定空态、loading、ready、failed 状态。
3. `unknown` 和 `pending verification` 不显示为 supported。
4. 切换 source/intent 后旧 epoch 数据清空。
5. reduced motion 下不执行位移/stagger 动画。
6. GSAP 初始化异常不影响播放器创建与 ready。
7. Native/Custom 和加载失败状态的 Playwright 回归。

### 实现

- 将诊断数据归一化放入 `diagnostics.ts`，组件不拼装私有状态。
- React effect 订阅 SDK 事件并在 unmount/换实例时清理。
- GSAP 只驱动 reveal、tab/panel transition 和数值状态变化。
- 保持现有播放器先初始化；动画不进入 ready Promise。
- 桌面保持高端 workbench，窄屏折叠为单列，不宣称移动端播放支持。

### 验证

```text
pnpm --filter @mx-player-max/demo typecheck
pnpm --filter @mx-player-max/demo build
pnpm test:browser
```

### 提交

```text
feat(demo): add playback diagnostics workbench
```

## Task 11：验证 Docker 隔离、静态资源与 Range

### 文件

- `apps/demo/Dockerfile`
- `apps/demo/nginx.conf`
- `docker-compose.yml`
- `scripts/release/docker-smoke.ps1`
- `docs/development/release.md`

### 测试先行

Smoke 脚本检查：

- HTML 有 COOP/COEP/nosniff，且不使用 immutable；
- 版本化 JS/CSS/wasm 使用正确 MIME 与长期缓存；
- 媒体 GET Range 返回 206、Accept-Ranges、Content-Range 和 Content-Length；
- 不存在资源稳定 404；
- 页面运行时 `crossOriginIsolated === true`。

### 实现

- 调整 Nginx location，避免嵌套 location 丢失安全 header。
- 为媒体样本提供明确 Range 行为，不通过代理外部媒体。
- Docker build 使用冻结 lockfile。
- 脚本只停止和移除本任务创建且名字固定、已验证的容器；不执行广泛 Docker 清理。

### 验证

```text
docker compose build
powershell -File scripts/release/docker-smoke.ps1
```

### 提交

```text
build(demo): verify isolated docker distribution
```

## Task 12：重构 CI 与 Release Workflow

### 文件

- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `docs/development/release.md`
- `package.json`

### 验证先行

- 使用静态 workflow 检查或本地脚本验证 YAML 关键字段。
- 断言默认/普通 PR 路径不存在 publish step。
- 断言 publish job 依赖 validate、package、consumer smoke 和 artifact。
- 断言 publish 需要显式 input、tag、受保护 environment 和 npm token。

### 实现

1. CI 增加 browser tests、package metadata 和 release script tests。
2. Release workflow 拆分：validate -> package -> consumer-smoke -> artifact -> publish。
3. artifact 上传 tarball、manifest、hash/SRI 和 bundle report。
4. Publish 仅显式生产触发；本次不运行 workflow，不使用 token。
5. `pnpm publish -r` 保留 pnpm workspace 版本改写路径，禁止直接 `npm publish`。

### 验证

```text
pnpm verify:packages
pnpm test:release
pnpm release:pack
pnpm release:smoke
```

### 提交

```text
ci(release): gate package publishing workflow
```

## Task 13：完成集成与接入文档

### 文件

- `README.md`
- `CHANGELOG.md`
- `docs/README.md`
- `docs/development/integration.md`
- `docs/development/release.md`
- `docs/architecture/distribution-and-embedding.md`
- `docs/architecture/wasm-and-distribution.md`
- `packages/browser/README.md`
- `packages/sdk/README.md`
- `packages/ui/README.md`
- `packages/react/README.md`
- `packages/vue/README.md`

### 内容

- npm SDK/UI、browser ESM、jsDelivr ESM、IIFE 全局和自托管资源示例。
- 固定版本 URL 与 SRI 示例；不使用虚构的已发布版本，把示例标为 release-time 替换模板。
- React/Vue peer dependency 和 CSS 导入说明。
- Decision Trace 的隐私边界与诊断用途。
- COOP/COEP、CORS/Range、CSP、Worker/AudioWorklet/WASM MIME 说明。
- 未审查 WASM Codec、真实 Safari/硬解/HDR 验证边界。
- 本次没有实际发布的明确记录。

### 验证

- 运行文档中的本地包示例 smoke。
- `rg` 检查不存在 `latest` 生产建议、虚构 CDN 版本、GitHub Pages 或“所有 Codec 已支持”等错误表述。
- `git diff --check`。

### 提交

```text
docs(distribution): document phase 12 integrations
```

## Task 14：Phase 12 全仓验收与记录

### 文件

- `docs/development/phase-12-acceptance.md`
- `docs/development/execution-plan.md`
- `docs/development/roadmap.md`
- `CHANGELOG.md`
- 本计划状态

### 验证顺序

```text
pnpm --filter @mx-player-max/types test
pnpm --filter @mx-player-max/strategy test
pnpm --filter @mx-player-max/core test
pnpm --filter @mx-player-max/sdk test
pnpm --filter @mx-player-max/browser test
pnpm typecheck
pnpm test
pnpm build
pnpm test:browser
pnpm test:release
pnpm verify:packages
pnpm release:pack
pnpm release:smoke
pnpm release:manifest
docker compose build
powershell -File scripts/release/docker-smoke.ps1
git diff --check
```

### 验收记录

- 记录每条命令的实际结果和测试数量。
- 记录 bundle 大小、tarball 文件清单、manifest/SRI 路径和 Docker header 结果。
- 区分 Playwright 引擎结果与 latest-two-stable/物理 Safari 证据。
- 明确未运行 npm publish、GitHub Release 或 CDN 发布。
- 若任何命令未执行或环境不可用，标为 pending，不写 passed。

### 最终提交

```text
feat(distribution): complete phase 12 release readiness
```

## Review Checkpoints

1. Task 0 完成后：确认 Phase 11 已独立闭合。
2. Task 3 完成后：重点审查原子回退、资源所有权和 epoch 隔离。
3. Task 6 完成后：审查 Browser API、IIFE 全局形状和 bundle 内容。
4. Task 10 完成后：审查 Demo 数据是否全部来自公共 API，GSAP 是否不阻塞播放器。
5. Task 12 完成后：审查发布 workflow 不会被普通 push/PR 意外触发。
6. Task 14 完成后：核对验收证据与所有 pending 边界。
