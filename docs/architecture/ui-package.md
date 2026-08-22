# UI 包架构

## 1. 定位与依赖方向

`@mx-player-max/ui` 是 `@mx-player-max/sdk` 的可选伴生包。它提供播放器控制体验，但不属于媒体引擎：

```text
types <- core <- sdk
  ^             ^
  |             |
  +---------- ui
                 ^
                 |
             react / vue
```

UI 只通过 `@mx-player-max/sdk` 和 `@mx-player-max/types` 公共入口编译。SDK、Core、Capabilities、Strategy、Decoder、Demux、Renderer、Audio 和 Subtitles 均不得依赖 UI。Demo 依赖适配器与 UI，但 UI 不依赖 Demo。

UI 使用原生 DOM + TypeScript。Lucide 以命名图标 import 提供控制图形；React/Vue 不参与 UI 内核。安装 SDK 不会引入 UI、Lucide 或 CSS。

## 2. 宿主与 DOM 所有权

SDK 和 UI 使用同一个宿主容器：

```text
host (.mxp-player-host)
├─ video 或 canvas                    SDK/Core 所有
├─ subtitle overlay                   Subtitles/Core 所有
└─ .mxp-player-ui                     UI 所有
   ├─ status layer
   ├─ lock toggle                     全屏/剧场时出现，锁定后仍在
   ├─ control shell
   │  ├─ progress: played fill + buffered segments
   │  ├─ optional preview
   │  └─ left/right control groups
   ├─ subtitle popup + edit bar + drag guide
   └─ at most one overlay backdrop/panel
```

UI 只追加和删除自己的 root，并为宿主切换 `mxp-player-host` class。它不查找、移动、绘制或控制 video/canvas，不读取 subtitle overlay，也不销毁传入的播放器。

共享容器是全屏一致性的要求：Core 对容器请求 fullscreen，媒体 surface、subtitle overlay 与 UI 因而一起进入。剧场模式不是 Core presentation mode，由宿主提供 `TheaterModeAdapter`。

## 3. 公共状态模型

两条播放路径都投影为一个不可变 `PlaybackSnapshot`：

```text
Native HTMLVideo state ----+
                           +-> Core snapshot -> SDK playbackchange -> UI render
Custom clock/queue state --+
presentation observer -----+
```

快照包含微秒时间、played/buffered 多段范围、音量、倍速、seeking、buffering、presentation、能力和安全错误摘要。UI 不维护与播放器脱离的 paused/muted/fullscreen 影子状态。

进度拖拽位置、pending subtitle selection 与按钮 pending 是短期交互反馈，不是已提交媒体状态。命令完成后仍等待下一份 SDK snapshot/event 确认。

`playbackchange` 可高频发布 time/buffer reason；UI 直接渲染有界范围，统计面板只读取 SDK 已公开的媒体/renderer/audio 统计字段，不读内部对象。

## 4. 生命周期和异步安全

`createPlayerUi()` 与 `attachPlayerUi()` 返回一个 controller。controller 支持重复 attach、跨容器重新挂载、全量 options 更新和幂等 destroy。

UI 同时维护：

- lifecycle epoch：attach/update/destroy 使旧 DOM 工作失效；
- SDK `sessionEpoch`：换源使旧媒体操作失效；
- CleanupScope：集中释放 SDK/document/window listener、timer、object URL、pointer capture 与 subscription；
- latest-wins controller：seek、preview、字幕选择与拖拽只允许当前代际更新。

destroy 后迟到的 promise、event、timer 和 focus task 都必须在写 DOM 前检查 epoch。播放器销毁由宿主或框架适配器负责，顺序是 UI first、SDK second。

## 5. 控制与时间轴

控制条布局固定为两组：左侧播放/下一集/静音/音量，右侧字幕/PiP/剧场/设置/全屏。下一集只调用可选 callback；没有 playlist model。

时间轴：

- duration/currentTime 为 `Micros | null`，未知值显示安全占位；
- played 是跟随播放头的连续填充，buffered 以离散 segment 表示且不合并真实 gap；`played` 快照区间用于诊断而不是进度指示，否则一次 seek 之后填充会停在旧区间里看起来卡死；
- pointer click/drag 和键盘 seek 统一经 coordinator，连续操作 80 ms coalesce，release 最终 flush；
- seeking 状态来自 snapshot，拖拽值只作为本地视觉反馈：填充立刻跟随指针，快照落到目标位置或 1.2 s 无人应答后交回快照；
- EOS 和非有限值在 Core 归一化，UI 仍执行二次边界保护。

## 6. 预览边界

UI 只调用 `MXPlayer.requestPreview()`：

- 默认请求 160x90；fine pointer 悬停 100 ms 后发起；
- movement、leave、换源、重新挂载和 destroy 会 abort；
- object URL 有界保留并在淘汰/销毁时 revoke；
- preview 位置在容器两侧 clamp；失败只隐藏图片，不影响 timestamp 或 seek。

Native preview 位于 Core 的隔离服务，使用独立 muted media element/canvas，绝不 seek 或截取活动 video。Custom 不读取 decoded queue 或 renderer，只有宿主 provider 存在时报告 preview capability。Core 负责尺寸、像素、MIME、Blob、timeout、latest-wins 与 session epoch 校验。

## 7. 字幕所有权

Phase 8 的 subtitles 包仍拥有解析、轨道、时钟、Overlay、样式验证和 `SubtitleStyleStore`。UI 只显示安全轨道摘要，并调用选择/样式公共 API。

字幕界面是贴控制栏的弹窗，分轨道、字体、样式三页，覆盖 off、轨道选择、外挂来源状态和全部已确认样式字段。弹窗与编辑模式共同持有一次播放挂起，两者都关闭后才恢复，且不覆盖用户自己按下的暂停。编辑模式下 guide 的中心拖拽只更新 y，上下句柄按指针到 guide 中心的距离比例更新 fontSize（与 MX-Player-Pro 相同的对称缩放，起始距离小于 1 px 时忽略）；写入按 80 ms 限频并在结束时 flush。x 由样式页的滑块设置并保持 5-95%，y 为 8-92%，fontSize 为 6-256 px。resize、DPR、fullscreen、换源和 destroy 都会取消旧拖拽。

UI 没有 localStorage 代码，不重新实现 origin/local-file scope，也不读取 cue text 或 subtitle DOM。

## 8. 浮层、焦点与自动隐藏

`settings | statistics | about | null` 是唯一主浮层状态。打开新面板会关闭旧面板。字幕弹窗不在该状态机内：它贴着控制栏，可与统计浮层共存，并在指针落到控制栏其他位置时让位。document 级外部 pointer listener 只在面板打开时存在。

打开面板后焦点进入第一个可操作元素并被限制在面板内；Escape/外部点击关闭并恢复 trigger。trigger 已移除时回退到 UI root。menu/drag/pointer/keyboard focus 与 overlay 都持有 visibility lock；点击留下的 focus 不持有，否则鼠标用户点完播放后控制栏永不收起。自动隐藏倒计时只由真实交互重排，高频 `playbackchange` 不会重置它。锁定状态优先于全部可见性规则。

## 9. 样式与无障碍

包发布独立 `dist/style.css`，不会 runtime 注入 `<style>` 或使用 CSS-in-JS。生产类名全部使用 `mxp-`，公开 token 使用 `--mxp-*`。包 manifest 把 `./dist/style.css` 标为 side effect，JS 入口仍可独立 tree-shake。

样式提供 dark/light/system token、36x36 控件基线、20 px 图标、tooltip、ARIA pressed/disabled/live/alert、稳定 DOM 顺序、2 px focus-visible、WCAG AA 目标色和 reduced-motion overrides。视觉语言对齐 MXAnime-CMS 内置的 MX-Player：单色强调（dark 为白、light 为黑）、`--mxp-scrim` 底部遮罩、3 px 全宽细进度轨（hover/focus 5 px、无独立 thumb）、毛玻璃深色浮层、Lucide 图标集（PiP 用 `PictureInPicture2`、剧场用 `RectangleHorizontal`、锁定用 `Lock`/`LockOpen`）。图标按钮不使用圆形底色：悬停提高不透明度，开启态在图标下画一条细线。样式契约允许且仅允许 `--mxp-scrim` 一处渐变，详见 `ADR-0006`。

`<=760px` 隐藏音量 slider 与剧场按钮并缩减间距；`<=420px` 将时间独占一行并重排左右组。预览在移动断点隐藏。所有 runtime geometry 只通过有界 `--mxp-*` 变量设置。

快捷键为 Space、左右 seek、上下音量、F、M、C。input、textarea、select、button、range、contenteditable、menu 和 dialog 内抑制全局处理。

## 10. 框架适配器与产物

React/Vue 组件只：

1. 创建共享 host；
2. 构造 SDK player；
3. attach UI；
4. 配置 identity 改变时调用 `load()`/`update()`；
5. 卸载时按 UI -> player 顺序销毁。

它们不输出内部控制 markup，不复制状态机、快捷键、字幕或 CSS。

当前 UI 发布产物：

```text
packages/ui/dist/
├─ index.js
├─ index.d.ts
└─ style.css
```

UI 包自身提供 ESM、declarations 与 CSS export。Phase 12 的 Browser 组合包额外提供 `MXPlayerMax` IIFE，但不会把 IIFE、SDK 或 Browser 生命周期实现反向放入 UI 包。

## 11. 范围边界

UI 包不实现 WASM Codec、PGS/VobSub、完整 libass、字幕内容编辑器、playlist/下一集业务、Custom 内建预览 decoder 或 Document Picture-in-Picture。Browser IIFE 是独立组合产物，不改变 UI 包的边界。
