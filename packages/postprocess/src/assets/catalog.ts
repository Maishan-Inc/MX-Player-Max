import type { AiModelManifest } from './manifest'

export const RT4KSR_X2_MANIFEST: AiModelManifest = {
  model: 'rt4ksr-x2',
  version: '2023.04.09',
  tier: 'medium',
  format: 'mxai',
  variants: { f32: 'weights/rt4ksr/rt4ksr_x2.mxai' },
  sha256: { f32: 'c34a7654fe40f34f6ee0ba47c9c3bea504b18a7c9c045261bfd4733f2662fba0' },
  license: 'Apache-2.0',
  upstream: 'https://github.com/eduardzamfir/RT4KSR@fd6627a48d789adf5d9aad29f02ab2a3d2a25296',
  buildFlags: 'MXAI v1 f32 derived offline from the upstream PyTorch checkpoint; no post-training quantization',
  patentRisk: 'low; Apache-2.0 patent grant applies to the upstream work',
  requiredFeatures: [],
  review: {
    status: 'approved',
    reviewer: 'MX-Player-Max Phase 7 engineering audit',
    reviewedAt: '2026-08-08',
    notes: 'Repository and checkpoint are distributed with Apache-2.0. Training data is not redistributed.',
  },
}

export const RIFE_V425_MANIFEST: AiModelManifest = {
  model: 'rife-v4.25',
  version: '4.25',
  tier: 'high',
  format: 'mxai',
  variants: { f32: 'weights/rife/rife_v4.25.mxai' },
  sha256: { f32: '665472509a3c9b50d9436d07e85754b8f1c4bb27ab48a3e531a6ebaec5bac56c' },
  license: 'MIT',
  upstream: 'https://github.com/hzwer/Practical-RIFE@17d8c7a1005b37f4c97bfee04e316aaec7fdc536',
  buildFlags: 'MXAI v1 f32 derived offline from train_log/flownet.pkl; inference tensors only; no quantization',
  patentRisk: 'low-to-medium; optical-flow and warping methods require separate patent review',
  requiredFeatures: [],
  review: {
    status: 'approved',
    reviewer: 'MX-Player-Max Phase 7 engineering audit',
    reviewedAt: '2026-08-08',
    notes: 'The upstream archive and repository declare MIT. Only the upstream archive is vendored; no non-commercial wrapper is used.',
  },
}

export const AI_MODEL_MANIFESTS: readonly AiModelManifest[] = [RT4KSR_X2_MANIFEST, RIFE_V425_MANIFEST]
