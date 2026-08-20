# AI 模型清单、分发与法律审查

## 分发机制

### 复用现有 WASM Manifest 模式

`@mx-player-max/decoder-wasm` 公共入口已定义严格的 `WasmDecoderManifest`。AI 模型采用
相同的版本、变体、哈希、来源与审查模式；两类资产的具体能力字段不同，但 URL、缓存、
完整性和发布门禁保持一致：

```typescript
export type ModelPrecision = 'f32' | 'f16'

export interface AiModelManifest {
  readonly model: string           // 'rt4ksr-x2' | 'rife-v4.25' | 'anime4k-cnnx2-ul'
  readonly version: string
  readonly tier: AiQualityTier
  readonly variants: Partial<Record<ModelPrecision, string>>
  readonly sha256: Partial<Record<ModelPrecision, string>>
  readonly license: string
  readonly upstream: string        // AGENTS.md §5 强制
  readonly buildFlags: string
  readonly patentRisk: string
  readonly requiredFeatures: readonly GPUFeatureName[]
}
```

### 资产分布

```text
仓库（源码）：
  packages/postprocess/src/
    interpolate/*.wgsl       # 手写着色器源码
    superres/*.wgsl          # 手写着色器源码
    assets/manifest.json     # 模型 manifest
    assets/weights/
      rt4ksr/rt4ksr_x2.mxai
      rife/rife_v4.25.mxai

自托管根目录（由应用通过 `aiModelBaseUrl` 指定）：
  weights/rt4ksr/rt4ksr_x2.mxai
  weights/rife/rife_v4.25.mxai
```

### SDK 自托管

开发者必须通过 `MXPlayerOptions.aiModelBaseUrl` 指定模型根目录，将模型文件部署到自己的服务。SDK 不隐式请求未拥有的默认 CDN。加载逻辑：

```typescript
const base = options.aiModelBaseUrl
const url = new URL(manifest.variants.f32!, base)
```

## 加载规则（镜像 wasm-and-distribution.md §2）

所有规则原样继承自 WASM 解码器的分发策略：

1. **懒加载**：仅在策略选定 AI 且系统确定档位后，才请求对应模型文件。绝不在启动阶段加载或预检。
2. **版本化 URL + 内容哈希**：文件名含模型名和版本号，`manifest.json` 记录完整 SHA-256。加载后在 Web Worker 中计算摘要与 manifest 比对。
3. **不重复下载两种精度变体**：对应 WASM 的「单线程/多线程不同时下载」规则。一个会话中只使用 `f16` 或 `f32` 中的一种。
4. **失败回退**：SHA-256 校验失败、网络错误、解包错误 均不中断播放——记录错误后回退到 passthrough，按会话缓存失败结果避免重复请求坏资产。
5. **设备缓存**：权重 blob 存储于 Cache Storage（`caches.open('mx-ai-models-v1')`），浏览器 HTTP 缓存作为 secondary。
6. **自托管支持**：开发者通过 `aiModelBaseUrl` 维护自己的模型副本。

## 模型清单

### RT4KSR

| 字段 | 值 |
|---|---|
| 上游 | CVPR 2023 NTIRE RT4KSR baseline |
| 模型规模 | 约 100K–500K 参数（随 tier 变化） |
| 上游权重 | `rt4ksr_x2.pth`（Apache-2.0） |
| 浏览器产物 | `rt4ksr_x2.mxai`（51 个 inference tensor），SHA-256 `c34a7654fe40f34f6ee0ba47c9c3bea504b18a7c9c045261bfd4733f2662fba0` |
| 训练数据 | DIV2K + Flickr2K |
| 许可证 | Apache-2.0（上游 commit 已锁定） |
| 输入 | Y通道或 RGB，1920×1080 / 1280×720 |
| 输出 | RGB，×2 放大 |

### RIFE

| 字段 | 值 |
|---|---|
| 上游 | hzwer/Practical-RIFE (v4.25) |
| 模型规模 | 约 10M 参数 |
| 上游权重 | `RIFEv4.25.zip`（MIT） |
| 浏览器产物 | `rife_v4.25.mxai`（198 个 tensor），SHA-256 `665472509a3c9b50d9436d07e85754b8f1c4bb27ab48a3e531a6ebaec5bac56c` |
| 训练数据 | Vimeo90K |
| 许可证 | **MIT**（© Megvii Inc.）。上游 ECCV2022-RIFE 与 Practical-RIFE 的权重均为 MIT |
| 许可证陷阱 | 风险来自**下游封装**而非 RIFE 本身。例如 `ComfyUI-Rife-Tensorrt` 为 CC BY-NC-SA（禁商用）。只能从 hzwer 上游取权重，绝不从第三方整合包取 |
| 专利风险 | 低-中。光流 + 双向 warp 为学术通用方法，但建议对具体实现做一次检索 |
| 输入 | 两帧 RGB，1080p |
| 输出 | 一帧 RGB，按 phase 合成 |

### Anime4K-WebGPU

| 字段 | 值 |
|---|---|
| 上游 | bloc97/Anime4K v4.0.1 + Anime4KWebBoost port |
| 规模 | 无权重——纯着色器（CNNx2UL，约 2.2K params） |
| 文件 | ~50 KB WGSL 着色器源码 |
| 训练数据 | 动画内容特化 |
| 许可证 | MIT ⚡（与上游 Anime4K 一致） |
| 专利风险 | 低——工业标准卷积操作 |
| GPU 特性要求 | `float32-filterable`（Firefox 不支持，需运行时检测） |

## 许可证与专利审查清单

AGENTS.md §5 的强制要求（**不得跳过，不得推迟到实现阶段后**）：

### 每个模型必须提供

| 审查项 | RT4KSR | RIFE | Anime4K |
|---|---|---|---|
| 上游仓库 / commit | ✅ eduardzamfir/RT4KSR@fd6627a4 | ✅ hzwer/Practical-RIFE@17d8c7a1 | N/A（当前未引入源码或产物） |
| 许可证条款 | ✅ Apache-2.0 | ✅ MIT（upstream authors） | N/A（引入时必须锁定 MIT 上游） |
| 商业分发允许 | ✅ Apache-2.0 条款允许 | ✅ MIT 允许 | N/A（当前不分发） |
| 再分发权重文件允许 | ✅ 上游仓库随 Apache-2.0 分发 | ✅ 上游 archive 随 MIT 分发 | N/A（着色器） |
| **来源纯净性** | N/A | ⚠️ **只能取上游**。下游整合包（如 ComfyUI-Rife-Tensorrt = CC BY-NC-SA）会污染许可证 | N/A |
| 训练数据许可证 | ⚠️ 训练数据不随仓库分发 | ⚠️ Vimeo90K 不随仓库分发 | N/A（传统方法） |
| 专利覆盖（基础方法） | ✅ 低风险，保留 Apache 专利审查 | ⚠️ 建议对光流/warp 具体实现检索 | ✅ 低风险 |
| 专利覆盖（具体实现） | ✅ 工程审查通过 | ⚠️ 工程审查通过，法务仍可复核 | ✅ 低风险 |
| 编译/转换参数记录 | ✅ MXAI v1 f32，无量化 | ✅ MXAI v1 f32，仅 inference tensors | ✅ 着色器源码 |
| 第三方依赖 | PyTorch 导出 | PyTorch 导出 | 无 |
| 产物大小 | 613 KB MXAI + 1.7 MB 上游 | 24.6 MB MXAI + 22.9 MB 上游 archive | ~50 KB |
| 自托管就绪 | ✅ | ✅ | N/A（当前不分发） |

> **RIFE 许可证结论已更新（2026-08）**：锁定的 Practical-RIFE 4.25 archive 与仓库均为 MIT，允许商用与再分发。上游没有名为 4.6 的可锁定 archive，因此本阶段明确使用 4.25，不在 manifest 中伪装为 4.6。真正的风险是**供应链**：多个第三方封装采用 CC BY-NC-SA 等禁商用条款。因此只从 hzwer 上游按锁定 commit 取权重，并在 manifest 的 `upstream` 字段记录该 commit。

### 审查结论必须在 Phase A 完成

**任何未完成的审查项，对应模型不得标记为可发布。**

审查完成后：
- 将结论写入 `assets/manifest.json` 对应条目
- 在 `docs/ai/assets-and-licensing.md` 中更新审查状态
- 由项目维护者签字确认

## Anime4K 的特殊性

**这是本特性唯一的有意破例**（引入外部依赖）：理由是该库纯 WGSL、无 WASM 运行时、代码审查仅需审查着色器源码、许可证明确。但其 `float32-filterable` 特性限制浏览器覆盖范围。

若许可证审查不通过，Anime4K 直接弃用——低档改用 RT4KSR 的小型变体。

## 排期冲突

**WASM manifest 在阶段 10，但 AI 模型在阶段 7 就需要。**

解决方案：
- **提前**：manifest 的 *schema + 加载器 + 哈希校验* 在阶段 7 实现（这是纯 JS、不依赖 WASM）
- **保留**：npm/jsDelivr 发布、Docker 响应头和 CDN 基础设施留在阶段 12

加载器代码放在 `packages/postprocess/src/assets/` 下，使用与 WASM manifest 加载器相同的设计模式（fetch → verify → cache）。
