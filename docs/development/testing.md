# 测试与验收方案

## 1. 证据层级

| 层级 | 环境 | 可证明 | 不可冒充 |
|---|---|---|---|
| 单元/契约 | Node + Vitest | 纯逻辑、包 API、epoch、资源预算 | DOM 布局或浏览器媒体行为 |
| 模拟 DOM | happy-dom/fake video/canvas/clock | UI 事件、ARIA、焦点、cleanup、SDK 映射 | 真实 CSS engine、Codec、PiP/fullscreen |
| 浏览器自动化 | Playwright Chromium/Firefox/WebKit | 真实浏览器进程中的 DOM/CSS/交互与截图 | latest-two-stable Chrome/Firefox 或 macOS Safari 设备验证 |
| 真实浏览器 | 指定版本和设备的 Chrome/Firefox/macOS Safari | 实际媒体、Codec、GPU、PiP/fullscreen、字体/DPR | 其他未运行平台 |

Playwright WebKit 不是 macOS Safari 的等价证据。fake SDK fixture 的截图也不能证明真实解码后端通过。

## 2. 发布门禁

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm test:browser
pnpm quality:media
pnpm quality:performance
pnpm quality:audit
pnpm quality:browsers
pnpm quality:acceptance-drift
pnpm test:quality
pnpm test:release
pnpm verify:packages
git diff --check
```

任何代码或文档修正后都要重新运行受影响命令。当前 test count 只读取
`docs/development/evidence/current-test-counts.json`；`pnpm test` 自动比较，数量变化使用
`pnpm test:update-counts` 显式更新。最终验收记录构建结果、样本/SDK hash、环境元数据和 pending 项。

## 3. Phase 9 UI 覆盖

- Native/Custom playback snapshot 一致性、状态、played/buffered、未知 duration、音量/静音/倍速。
- pointer/keyboard/连续 seek、seeking feedback、preview delay/abort/budget/epoch/null fallback。
- overlay 互斥、Escape、外部点击、focus entry/contain/restore、auto-hide locks。
- 字幕关闭/选择、全部 Phase 8 样式、拖拽安全区、限频、持久化集成。
- 重复 attach、重新挂载、换源、destroy、迟到 promise/event 和资源清理。
- PiP/fullscreen/preview capability degradation、next callback、safe error summary。
- ARIA、tooltip、focus-visible、shortcuts suppression、reduced motion 和 760/420 responsive rules。
- React/Vue mount/update/reload/expose/unmount 与 SSR-safe import。

## 4. Playwright 截图

UI 配置包含 Chromium 1440x900、Chromium mobile 390x844、Firefox 和 WebKit。媒体工程另含
`media-chromium`、`media-firefox`、`media-webkit-automation`，性能工程含 Chromium/Firefox；
WebKit 媒体结果始终标记 automation-only。Chromium desktop/mobile 提交稳定 UI baseline。

默认 `pnpm test:browser` 先并发运行 UI 与媒体项目，再依次运行 `performance-chromium` 和
`performance-firefox`。性能项目通过 Playwright project dependencies 隔离，避免同时启动的浏览器、
媒体解码和计时器负载污染首帧、首字幕与 seek 指标。`fullyParallel: false` 只约束项目内测试，不能
替代这层跨项目调度；不得通过放宽性能阈值或添加 retry 掩盖资源竞争。

截图验收必须用视觉检查确认：

- media/poster 像素非空；
- 控件 bounding boxes 不重叠；
- tooltip/preview 不越界；
- 文本不溢出；
- mobile 隐藏音量 slider 与 theater；
- focus 与 reduced-motion 状态可见且稳定。

更新 snapshot 不能用于掩盖布局回归，必须先修源 CSS/DOM。

## 5. 真实浏览器回归

桌面 Chrome/Chromium、Firefox、macOS Safari 最新两个稳定大版本分别执行：

- Native MP4/WebM 与实际 Custom 支持样本；
- 本地 File 和 HTTPS CORS/Range URL；
- video/canvas surface、非空媒体画面和 resize/DPR；
- play/pause/seek/buffer/ended/error/换源；
- PiP/fullscreen 能力变化与降级；
- SRT/ASS 轨道、字体 fallback、位置拖拽与持久化；
- preview CORS 成功/失败与 seek 独立性；
- keyboard/focus/auto-hide/responsive；
- close 后 listener、Object URL、media/canvas 资源清理。

记录浏览器完整版本、OS、GPU、页面是否 cross-origin isolated、媒体样本 SHA-256 和结果。未实际运行的行保持 pending。
结构化记录位于 `tests/browser/evidence/real-browser-matrix.json`，`pnpm quality:browsers` 禁止 pending
行填入模拟版本，也禁止把 Playwright/Headless/Simulated 名称写成实机版本。

## 6. 性能与媒体样本

样本 source of truth 为 `tests/media/manifest.json`；小样本提交，30 分钟样本从已提交 seed 确定性
生成，不依赖 Git LFS 或网络。`pnpm quality:media` 验证许可证、SHA-256 和 FFprobe 元数据。

性能 JSON schema、阈值和记录位于 `tests/performance/`。必须记录首帧、首音、首字幕、seek latency、
bufferedAhead、dropped frames、音画漂移、CPU、内存和功耗代理；浏览器 API 不提供的指标使用
`null + reason`，不得推断。隔离与非隔离是独立记录。短 smoke 只验证 collector；只有
`runDurationMs >= 1800000` 且必需指标为实测数值的完整记录可关闭 30 分钟漂移/内存门禁。
先按 manifest 生成 ignored 长片，再执行
`pnpm quality:performance:collect -- --scenario=long-run-30m`；collector 必须从生成文件计算 SHA-256，
不得沿用 seed hash。`pnpm test:quality` 用负例验证缺字段和 seed-hash 长跑证据会被拒绝。

## 7. 安全与分发证据

- `pnpm quality:audit` 校验 AI source/MXAI/WASM bytes、SHA-256、许可证和 review status；Phase 10
  WASM 必须保持 restricted 并从 Browser release manifest 排除。
- 字幕 Overlay 只用 `textContent`，远程 URL 限 HTTP(S)，媒体响应不能作为 HTML/JS/SVG 执行；
  公共事件不得包含 URL query、本地路径或原始 platform cause。
- Docker 80 端口是 COOP/COEP 隔离模式，8080 是非隔离模式；两者都要求 CSP、CORP、nosniff、
  MIME、Range 和 404。静态测试不能代替 `docker compose build` 与 `docker-smoke.ps1` runtime 证据。
