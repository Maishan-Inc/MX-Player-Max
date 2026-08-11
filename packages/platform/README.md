# @mx-player-max/platform

浏览器专属增强的隔离层。平台策略只能读取已经探测到的能力、调整现有候选评分或输出
诊断，不能创建候选、把未知能力提升为支持，也不能跳过后端初始化失败后的原子回退。

## 策略与增强

```ts
import { createPlatformPolicy } from '@mx-player-max/platform'

const policy = createPlatformPolicy(capabilitySnapshot)
const enhancements = policy.enhancements
const adjustments = policy.adjustScores(candidates, media, intent, context)
```

`enhancements` 记录以下运行时信号：

- Chromium 相关：Worker MediaSource、WebGPU external texture。
- WebKit 相关：原生 HLS、原生 HEVC、HDR display、ManagedMediaSource、AirPlay、PiP。
- 通用/Gecko 相关：`fastSeek()`、`getVideoPlaybackQuality()` 和只用于诊断的
  `mozDecodedFrames`、`mozPresentedFrames`、`mozPaintedFrames`、`mozFrameDelay`。

这些字段都来自 `CapabilitySnapshot` 或实际 API 探测。`nativeHevc` 只代表
`canPlayType()` 对固定 HEVC 查询返回 `maybe/probably`，`hdrDisplay` 只代表显示环境查询；
它们不能替代当前媒体的 `MediaCapabilityReport`。

`PlatformRuntimeAdapter` 可以在测试或非 DOM 宿主中注入。适配器抛错时对应增强为 `false`，
通用策略仍可继续工作。

## Issue 规则

`PlatformIssueRule` 必须包含浏览器、半开版本范围、HTTPS Issue 链接、失效日期、回归样本、
负向分数和候选匹配条件。非法、正向或已过期规则不会生效。规则只返回输入候选的
`PlatformScoreAdjustment`；删除规则或缺失平台 API 不会删除通用候选。

内建规则目前只有 Firefox Bugzilla #1918769：Firefox 130-145 的 H.264 WebCodecs
`isConfigSupported()` 可能成功但 `configure()` 失败，因此匹配的 WebCodecs 候选减 100 分。
这不是“不支持”声明；若它仍是唯一候选，初始化仍可尝试，并必须保留 try/catch 与原子回退。

测试可以用 `issueRules` 和 `now` 注入固定规则/时间：

```ts
const policy = createPlatformPolicy(snapshot, {
  issueRules: auditedRules,
  now: new Date('2026-08-11T00:00:00Z'),
})
```

## 诊断

```ts
import { createPlatformDiagnostics } from '@mx-player-max/platform'

const diagnostics = createPlatformDiagnostics()
diagnostics.recordWebCodecsAcceleration({
  codec: 'avc1.640028',
  requestedPreference: 'prefer-hardware',
  support: 'supported',
  selected: 'unknown',
  reasons: ['config-supported-selection-not-observable'],
})

const snapshot = diagnostics.snapshot(video)
```

WebCodecs 没有跨浏览器标准 API 可以直接报告最终使用了硬件还是软件实现，因此记录器只保存
解码器适配器明确观察到的结果；不能从 `supported` 或 `powerEfficient` 推断 `hardware`。
播放质量优先读取标准 `getVideoPlaybackQuality()`，Firefox 私有计数只进入诊断快照，不参与评分。
