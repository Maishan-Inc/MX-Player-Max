# 技术选型与平台矩阵

本文回答两个常见问题：**AI 视频增强用的是什么技术**，以及**哪些平台能用**。

## 一、为什么不能照搬 DLSS / FSR

游戏超分和视频超分是**两类不同的问题**，这是理解整个领域的关键。

### 游戏超分是「重建」，视频超分是「猜测」

DLSS、FSR2+、XeSS 都运行在**渲染管线内部**，能拿到视频文件里根本不存在的数据：

| 输入 | 游戏能拿到 | 视频能拿到 |
|---|---|---|
| 低分辨率彩色帧 | ✅ | ✅ |
| **运动矢量** | ✅ 引擎算出的逐像素真值 | ❌ 只能从像素估计 |
| **深度缓冲** | ✅ | ❌ 不存在 |
| **相机抖动** | ✅ 每帧主动偏移采样 | ❌ 不存在 |
| 历史帧 | ✅ | ✅ |

其中**相机抖动（jitter）是结构性差异**：游戏可以每帧故意偏移采样位置，于是它累积的是**真实的新信息**；视频没有这个机会，只能靠网络幻觉出高频细节。

运动矢量的差距同样根本。游戏引擎知道每个物体确切移动到哪里，因为位移就是它自己算的。视频只有两个选择——用光流估计（贵），或者从编码器的运动矢量里捡（不准）。**编码器的运动矢量是为压缩码率优化的，不是为描述真实运动优化的**：相邻块的矢量之间不需要有物理相关性，只要能省 bit 就行。做帧率转换需要的恰恰是「同一物体的相邻块矢量应当相关」，两者目标相反。

### FSR 1.0 是最好的对照实验

FSR 1.0 恰好是「按视频超分的方式做的游戏超分」——纯空域、单帧、Lanczos 边缘检测，不用运动矢量。它的画质明显低于 FSR 2+，但**集成成本极低**。

这正是视频超分的处境：没有集成负担，也没有重建保真度。

### 结论对本项目的意义

不要向用户承诺「DLSS 级别的画质」。视频超分能做到的是**去压缩伪影 + 边缘锐化 + 适度细节恢复**，做不到游戏时域超分的重建质量。这个预期管理要写进 UI 文案。

---

## 二、我们用什么技术

### 超分：RT4KSR（主）+ Anime4K（低档 / 动画特化）

| | RT4KSR | Anime4K-WebGPU |
|---|---|---|
| 类型 | CNN，学术 baseline（CVPR 2023 NTIRE） | 手写卷积着色器 |
| 权重 | 1–4 MB | **无权重**，纯 WGSL |
| 适用内容 | 通用实拍 | 动画特化 |
| 许可证 | Apache-2.0（已按锁定上游审核） | MIT（候选方案，当前未引入产物） |
| 浏览器现成实现 | ❌ 无 WebGPU 移植，需自己写 | ✅ npm 包可直接用 |

**RT4KSR 没有现成的浏览器实现**，这是搜索确认的。要用它必须自己把网络移植成 compute shader，或者走 ONNX Runtime Web。ADR-0003 选择前者。

它之所以适合手写移植：结构重参数化在推理时会折叠成普通卷积栈，几乎能 1:1 映射到 WGSL compute pass 链。

**Real-ESRGAN 明确排除**——质量好，但比实时需求慢约三个数量级。它属于离线工具（Video2X、Waifu2x-Extension-GUI 那一类），不属于播放器。

### 插帧：RIFE

上游 `hzwer/Practical-RIFE` v4.x，MIT 许可证，支持任意时间步合成——这正是拉取式帧源需要的能力（见 [interpolation.md](interpolation.md)）。

⚠️ **供应链陷阱**：RIFE 本身是 MIT，但多个流行的第三方封装是 CC BY-NC-SA（禁商用）。必须从 hzwer 上游按锁定 commit 取权重。详见 [assets-and-licensing.md](assets-and-licensing.md)。

### 参考实现

| 项目 | 用途 |
|---|---|
| `Anime4KWebBoost/Anime4K-WebGPU` | 可直接用的 npm 包，低档超分 |
| `sb2702/websr` | 浏览器实时超分库，架构参考 |
| Anime4K WebExtension / AniLens / NexVid | 已上架的浏览器扩展，证明路线可行 |

### 为什么不用 ONNX Runtime Web

我们只跑两个固定已知的网络，而 ORT Web 要带来数 MB 的 WASM + JS。更关键的是 `GridSample` 算子——RIFE 最依赖的算子——直到 ORT Web v1.26.0 才在 WebGPU 后端支持，把项目押在极新的实现上过于脆弱。自己写反向 warp 约 60 行 WGSL（对流场做双线性采样）。

[AGENTS.md §5](../../AGENTS.md) 要求逐二进制审查来源、版本、许可证、编译参数和专利风险。自有着色器加权重 blob 的审查面，远小于一个庞大的传递依赖树。

代价是真实的：需要自写 conv / warp kernel 并离线转换权重，还要为「与参考实现的数值等价性」准备验证工装。但工作量**有界**，且 Anime4K-WebGPU 已经证明纯 WGSL 路线可行。详见 [ADR-0003](../decisions/ADR-0003-ai-post-processing.md)。

---

## 三、为什么不用 RTX VSR 那种「驱动级」方案

NVIDIA RTX Video Super Resolution 在 Chrome/Edge/Firefox 里对**所有**视频生效，用户在驱动面板里开关，网页什么都不用做。

看起来它让我们的工作变得多余，实际上不是——**两者是互补关系**：

| | RTX VSR | 本项目 |
|---|---|---|
| 生效范围 | 全系统所有视频 | 仅本播放器 |
| 硬件 | 仅 NVIDIA RTX 20/30/40 系 | 任何支持 WebGPU 的 GPU |
| 平台 | 仅 Windows | Windows / macOS / Linux / Android |
| 控制权 | 用户在驱动面板 | SDK 可编程 |
| 插帧 | ❌ 不提供 | ✅ |
| 输入限制 | 360p–1440p，需低于屏幕分辨率 | 无 |
| 笔记本 | 必须插电 | 无限制 |

RTX VSR 也**不是 DLSS**——NVIDIA 明确说明它是完全不同的算法，只从低分辨率帧推断，不使用引擎数据。这进一步印证了上一节的结论。

**实践影响**：如果用户已经开了 RTX VSR，我们再叠一层超分会造成重复处理和画质劣化。这需要在 UI 里给出提示，但**无法程序化检测**——驱动级处理对网页完全透明。

---

## 四、平台支持矩阵

> **本节只覆盖 WebGPU 与 AI 可用性。** 解码管线的选择（HTMLVideo / WebCodecs / WASM）与视频编码格式（H.264 / HEVC / AV1 / VP9）的逐浏览器支持情况，见 [platform-support-matrix.md](../architecture/platform-support-matrix.md)——那份文档回答「这个文件在这台设备上能不能播、走哪条管线」，本节只回答「AI 能不能开」。

### WebGPU 现状（2026-08）

WebGPU 已在四大浏览器默认开启，这是 2025 年 11 月达成的里程碑。全球覆盖率约 70%。

| 平台 | 浏览器 | 状态 |
|---|---|---|
| **Windows** | Chrome / Edge 113+ | ✅ 默认开启 |
| | Firefox 141+ | ✅ 默认开启 |
| **macOS** | Safari 26（Tahoe 26） | ✅ 默认开启，映射到 Metal |
| | Chrome / Edge | ✅ |
| | Firefox 145+ | ✅ 仅 Apple Silicon |
| **Linux** | Chrome | ⚠️ 需 `#enable-unsafe-webgpu` flag |
| | Firefox | ⚠️ 开发中 |
| **Android** | Chrome 121+ / Edge / Samsung Internet 24+ | ✅ Android 12+，需 Qualcomm/ARM GPU |
| | Firefox | ⏳ 目标 2026 年底 |
| **iOS / iPadOS** | Safari 26+（iOS 26+） | ✅ 默认开启 |
| | Chrome / Edge on iOS | ✅ 继承 WebKit，与 Safari 同步 |

**iOS 25 及更早版本不支持**，且由于 iOS 上所有浏览器都必须用 WebKit，换浏览器无法绕过。

### AI 特性可用性（区分「能跑」与「跑得动」）

WebGPU 可用 ≠ AI 能实时。真正的门槛是算力：

| 平台 | WebGPU | 超分 | 插帧 | 说明 |
|---|---|---|---|---|
| Windows + 独显 | ✅ | ✅ 1080p→4K | ✅ | 目标平台 |
| Windows + 集显 | ✅ | ⚠️ 限 720p→1440p | ❌ | governor 应关闭插帧 |
| macOS Apple Silicon | ✅ | ✅ | ✅ | 统一内存有利 |
| macOS Intel | ✅ | ⚠️ 低档 | ❌ | |
| Linux | ⚠️ 需 flag | — | — | 视为不可用，回退 passthrough |
| Android 高端 | ✅ | ⚠️ 低档 | ❌ | 首阶段不在范围内 |
| Android 中低端 | ✅/❌ | ❌ | ❌ | |
| iOS / iPadOS | ✅ | ⚠️ 未验证 | ❌ | 首阶段不在范围内 |

**首阶段目标明确为桌面**（AGENTS.md 第 14 行）。移动端即使 WebGPU 可用，热节流和电池也会让 AI 不可持续——手机跑几分钟神经网络就会降频。

### 为什么不用 WebNN

WebNN 是专门为神经网络设计的 Web API，能访问 NPU（Copilot+ PC、Apple Neural Engine、Snapdragon X），理论上比 WebGPU 更合适。

**但它 2026 年还不能用于生产**：

- Chrome 147–149 仅 Origin Trial 阶段
- W3C 规范 2026 年 1 月才进入 Candidate Recommendation
- Safari / Firefox 均未实现
- Android 上禁用

预计成为默认可用路径要到 2027 年。**WebGPU 是当前唯一可靠的选择**，这个结论至少在本项目阶段 7 之前不会变。

如果将来 WebNN 成熟，它可以作为 `SpatialStage` / `TemporalStage` 的另一个实现挂进来——契约层的设计已经预留了这个可能（stage 接口不假设底层用什么算）。

---

## 五、降级路径

能力探测的结果决定走哪条路，全程不得中断播放：

```text
navigator.gpu 存在？
  ├─ 否 → passthrough（无 AI）
  └─ 是 → requestAdapter() 成功？
      ├─ 否 → passthrough
      └─ 是 → isFallbackAdapter？
          ├─ 是 → passthrough（软件光栅器跑不动）
          └─ 否 → 检查 float32-filterable / shader-f16
              → governor 实测帧时间 → 定档
                  ├─ 超预算 → 先关插帧，再关超分
                  └─ 有余量 → 缓慢升档
```

档位变化必须作为 SDK 事件上报——静默降级被 `subtitle-pipeline.md:25` 的先例禁止。

## 参考来源

- [WebGPU 实现状态（官方 wiki）](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status)
- [WebGPU 已在主流浏览器支持 — web.dev](https://web.dev/blog/webgpu-supported-major-browsers)
- [WebNN 浏览器兼容性](https://webnn.io/en/api-reference/browser-compatibility/api)
- [NVIDIA RTX Video FAQ](https://nvidia.custhelp.com/app/answers/detail/a_id/5448)
- [AMD FSR SDK — 时域超分与运动矢量要求](https://gpuopen.com/manuals/fsr_sdk/techniques/super-resolution-temporal/)
- [Practical-RIFE 上游仓库](https://github.com/hzwer/Practical-RIFE)
- [Anime4K-WebGPU](https://github.com/Anime4KWebBoost/Anime4K-WebGPU)
