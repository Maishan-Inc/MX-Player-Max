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
git diff --check
```

任何代码或文档修正后都要重新运行受影响命令。最终验收记录精确 test count、构建结果、SDK hash/bytes、UI pack 文件和真实浏览器 pending 项。

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

配置包含 Chromium 1440x900、Chromium mobile 390x844、Firefox 和 WebKit。Chromium desktop/mobile 提交稳定 baseline；所有 project 运行行为与布局断言。

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

## 6. 性能与媒体样本

继续记录首帧、首音、首字幕、seek latency、bufferedAhead、dropped frames、音画漂移、CPU、内存和功耗代理指标。样本按 container/codec/profile/bit-depth/audio/subtitle 命名并保存来源/许可；禁止提交版权不明媒体。
