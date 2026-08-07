# @mx-player-max/platform

浏览器专属增强的隔离层。平台策略只能调整候选评分或提供可选钩子，不能绕过标准能力检测。

`createPlatformPolicy(snapshot)` 返回 Chromium、WebKit、Gecko 或 generic 策略。策略的 `adjustScores()` 只能引用输入列表中已有的 `candidateId`，并返回有限的 `scoreDelta` 与原因；Codec 支持仍完全来自 `MediaCapabilityReport`。

当前平台提示只对已经验证的原生/WebCodecs/WebGPU 组合做小幅调分，不包含 `Chrome = WebCodecs`、`Safari = HTMLVideo`、`Firefox = WASM` 一类映射。
