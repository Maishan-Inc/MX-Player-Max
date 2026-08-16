# Playwright Resource Isolation Design

状态：用户已批准；待实现。

## 1. 目标与范围

使根目录默认命令 `pnpm test:browser` 在同一开发机上可重复通过，同时保留功能测试的并发效率和
现有真实性能门槛。本修复只调整 Playwright 项目调度，更新测试文档与变更记录；不修改播放器、
媒体管线、性能采集逻辑或性能阈值。

## 2. 根因证据

当前 58 个用例由 Playwright 使用 13 个 worker 调度。`fullyParallel: false` 只限制单个项目内的
文件并行，九个项目仍会并发启动浏览器并争用 CPU、媒体解码和计时器调度资源。

默认命令复现到 `performance-firefox` 的非隔离场景失败：`firstSubtitleMs` 为 2602ms，超过
2500ms 门槛。只让 Chromium/Firefox 性能项目使用 4 个 worker 并发重复时仍可复现 2546ms；
Firefox 性能项目使用单 worker 连续运行 10 次则全部通过。因此问题是性能采集受到并发负载污染，
不是阈值不可达或产品性能回归。

## 3. 调度设计

功能项目保持现有并发：

- `chromium-desktop`
- `chromium-mobile`
- `firefox-simulated`
- `webkit-simulated`
- `media-chromium`
- `media-firefox`
- `media-webkit-automation`

`performance-chromium` 依赖以上全部功能项目，确保功能测试完成后才开始性能采集。
`performance-firefox` 依赖 `performance-chromium`，确保两个性能浏览器不会相互污染。

```text
UI and media projects (parallel)
              ↓
 performance-chromium
              ↓
  performance-firefox
```

依赖项目失败时，Playwright 应保持默认行为，不运行下游性能项目。显式选择性能项目时也保留依赖，
保证该运行仍满足性能采集隔离条件。功能项目的选择和并发行为不变。

## 4. 备选方案

全局设置 `workers: 1` 可以消除竞争，但会把所有功能测试串行化，显著增加默认命令耗时。拆分
`package.json` 脚本也能串行运行性能套件，但直接执行 `playwright test` 仍会保留错误调度。
项目依赖链将隔离策略保留在 Playwright 配置内，并只串行化对宿主负载敏感的阶段。

## 5. 测试与文档

实现后保持 `tests/browser/performance/performance.spec.ts` 的 2500ms 字幕门槛不变，并验证：

1. Playwright 能列出依赖后的完整默认项目集合。
2. Firefox 性能项目在隔离调度下重复运行通过。
3. `pnpm test:browser` 连续运行至少三次，无失败或重试后通过。
4. `pnpm typecheck`、受影响测试和 `git diff --check` 通过。

`docs/development/testing.md` 记录性能项目必须在功能项目之后串行运行的原因；`CHANGELOG.md`
记录默认浏览器测试命令的稳定性修复。Playwright 自动化仍不冒充物理 Safari 或 latest-two-stable
真实浏览器证据。
