# AI 模型清单、分发与法律审查

## 分发机制

### 复用现有 WASM Manifest 模式

`packages/decoder-wasm/src/index.ts:5-12` 已定义 `WasmDecoderManifest`。AI 模型镜像其形状，使加载器、缓存策略与许可证审查完全一致：

```typescript
export type ModelPrecision = 'f32' | 'f16'

export interface AiModelManifest {
  readonly model: string           // 'rt4ksr-x2' | 'rife-v4.6' | 'anime4k-cnnx2-ul'
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

CDN（编译后）：
  https://cdn.example.com/models/
    rt4ksr-x2/
      v1.0.0/
        model-f32.bin
        model-f16.bin
        manifest.json
    rife-v4.6/
      v2.4.0/
        model-f32.bin
        model-f16.bin
        manifest.json
    anime4k-cnnx2-ul/
      v4.1.0/
        pipelines-ul.wgsl    # Anime4K 只需着色器，无权重文件
        manifest.json
```

### SDK 自托管

开发者可通过 `MXPlayerOptions.aiModelBaseUrl` 覆盖默认 CDN，将模型文件部署到自己的服务。加载逻辑：

```typescript
const base = options.aiModelBaseUrl ?? 'https://cdn.example.com/models'
const url = `${base}/${manifest.model}/v${manifest.version}/${manifest.variants['f16'] ?? manifest.variants['f32']}`
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
| 权重文件 | 1–4 MB（tier f32） / 0.5–2 MB（tier f16） |
| 训练数据 | DIV2K + Flickr2K |
| 许可证 | 待确认（见下方审查清单） |
| 输入 | Y通道或 RGB，1920×1080 / 1280×720 |
| 输出 | RGB，×2 放大 |

### RIFE

| 字段 | 值 |
|---|---|
| 上游 | hzwer/Practical-RIFE (v4.6) |
| 模型规模 | 约 10M 参数 |
| 权重文件 | 约 40 MB（f32） / 20 MB（f16） |
| 训练数据 | Vimeo90K |
| 许可证 | **⚠ 高风险**——部分发布版本 MIT，部分研究/非商用。需逐版本确认 |
| 专利风险 | 光流 + 双向 warp 可能有竞品专利覆盖（FlowNet/Super-Slomo 相关） |
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
| 上游仓库 / commit | ⬜ 待确认 | ⬜ 待确认 | ⬜ 待确认 |
| 许可证条款 | ⬜ 待评估 | ⬜ 待评估 | ⬜ MIT 已确认 |
| 商业分发允许 | ⬜ 待评估 | ⬜ **看版本** | ✅ MIT |
| 再分发权重文件允许 | ⬜ 待评估 | ⬜ **看版本** | N/A（着色器） |
| 训练数据许可证 | ⬜ DIV2K 需确认 | ⬜ Vimeo90K 需确认 | N/A（传统方法） |
| 专利覆盖（基础方法） | ⬜ CNN 超分无风险 | ⚠️ 建议检索 | ✅ 低风险 |
| 专利覆盖（具体实现） | ⬜ 待评估 | ⚠️ 建议检索 | ✅ 低风险 |
| 编译/转换参数记录 | 不适用（权重） | 不适用（权重） | ✅ 着色器源码 |
| 第三方依赖 | PyTorch 导出 | PyTorch 导出 | 无 |
| 产物大小 | 1–4 MB | 20–40 MB | ~50 KB |
| CDN 就绪 | ⬜ | ⬜ | ✅ |

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

**WASM manifest 在路线图阶段 8，但 AI 模型在阶段 5.5 就需要。**

解决方案：
- **提前**：manifest 的 *schema + 加载器 + 哈希校验* 在阶段 5.5 实现（这是纯 JS、不依赖 WASM）
- **保留**：npm/jsDelivr 发布、Docker 响应头和 CDN 基础设施留在阶段 8

加载器代码放在 `packages/postprocess/src/assets/` 下，使用与 WASM manifest 加载器相同的设计模式（fetch → verify → cache）。
