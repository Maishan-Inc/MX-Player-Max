# ADR-0005：平台增强与可过期 Issue 规则

## 状态

已接受。

## 背景

标准能力探测可以回答 API 和具体 Codec 配置是否被报告为支持，但不能覆盖所有初始化缺陷、
浏览器特有 UI/流媒体能力或诊断字段。直接使用 User-Agent 选择后端会把浏览器名称误当成
能力，并在版本变化或可选 API 被禁用时破坏通用路径。

Firefox Bugzilla #1918769 是具体例子：Firefox 145 上 H.264
`VideoDecoder.isConfigSupported()` 可以返回支持，随后 `configure()` 仍失败。这个问题需要
降低候选优先级和保留运行时回退，但不能静态宣布所有 Firefox H.264 不支持。

## 决策

平台层采用三个互相隔离的输出：

1. `PlatformEnhancements` 记录实际 API 信号，不生成候选。
2. `PlatformPolicy.adjustScores()` 只引用输入候选 ID，并为每个候选最多返回一条合并 adjustment。
3. `PlatformDiagnostics` 保存标准播放质量、Firefox 私有帧统计和显式 WebCodecs 加速观测，
   私有统计不参与后端选择。

Issue 规则必须包含稳定 ID、浏览器、半开版本范围、HTTPS Issue URL、失效日期、回归样本、
负向分数和候选匹配条件。规则不能加分、不能修改 `CapabilitySnapshot` 或
`MediaCapabilityReport`，过期/非法规则不生效。

内建 Firefox #1918769 规则覆盖 130 <= version < 146，失效日期为 2027-03-31，匹配
H.264 WebCodecs 候选并减 100 分。版本上界表示已验证风险范围，不表示 146 已被证明修复；
扩展范围前必须用回归样本复现并更新文档。无论规则是否匹配，decoder `configure()` 都必须
保留 try/catch 和原子回退。

## 后果

正面：

- 平台优化可单独删除或禁用，不会破坏候选生成和通用策略。
- Issue 规则可审计、可过期、可在版本边界测试，不会永久固化旧浏览器假设。
- WebKit/Chromium/Gecko 的可选能力可以服务未来流媒体、UI 与诊断，而不污染 Core。
- 同候选 adjustment 聚合避免策略层的重复保护吞掉 Issue 惩罚。

负面：

- 规则元数据和回归样本需要持续维护，过期前必须重新验证。
- 浏览器没有标准方式暴露 WebCodecs 最终硬件/软件选择，部分诊断只能诚实记录 `unknown`。
- Playwright WebKit 只能做 API/DOM 回归，真实 Safari Codec 与系统能力仍需物理环境验证。

## 相关

- `docs/architecture/browser-strategy.md`
- `docs/architecture/codec-strategy.md`
- `docs/development/phase-11-acceptance.md`
- `packages/platform/README.md`
