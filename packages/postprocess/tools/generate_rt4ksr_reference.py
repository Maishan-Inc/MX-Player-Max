"""Generate layer-by-layer reference tensors for the RT4KSR x2 checkpoint.

The WGSL super-resolution graph in `packages/postprocess/src/gpu/` was derived
from the checkpoint's tensor names alone. This script runs the *upstream* forward
pass so the GPU kernels can be compared against an authoritative oracle instead
of a re-derivation.

Upstream source is not vendored. Fetch it once into a scratch directory:

    mkdir -p .release-tmp/upstream && cd .release-tmp/upstream
    curl -sSL -o rt4ksr.tar.gz \
      https://codeload.github.com/eduardzamfir/RT4KSR/tar.gz/fd6627a48d789adf5d9aad29f02ab2a3d2a25296
    tar -xzf rt4ksr.tar.gz && mv RT4KSR-fd6627* rt4ksr

Then:

    python packages/postprocess/tools/generate_rt4ksr_reference.py \
      --upstream .release-tmp/upstream/rt4ksr \
      --checkpoint packages/postprocess/assets/weights/rt4ksr/rt4ksr_x2.pth \
      --out packages/postprocess/tests/fixtures/rt4ksr-reference.json
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import OrderedDict
from pathlib import Path

import torch
import torch.nn as nn


def build_model(upstream: Path, act_type: str, feats: int, blocks: int, scale: int):
    code = upstream / "code"
    if not (code / "model" / "arch.py").is_file():
        raise SystemExit(f"upstream architecture not found under {code}; see this file's docstring")
    sys.path.insert(0, str(code))
    from model.arch import RT4KSR_Rep  # noqa: E402
    from model.modules import activation  # noqa: E402

    # `rt4ksr_rep()` hardcodes eca_gamma=0, forget=False, layernorm=True,
    # residual=False. The checkpoint is the pre-reparameterisation training
    # architecture, so is_train must be True.
    return RT4KSR_Rep(
        num_channels=3,
        num_feats=feats,
        num_blocks=blocks,
        upscale=scale,
        act=activation(act_type),
        eca_gamma=0,
        is_train=True,
        forget=False,
        layernorm=True,
        residual=False,
    )


def strip_module_prefix(state: "OrderedDict[str, torch.Tensor]") -> "OrderedDict[str, torch.Tensor]":
    stripped = OrderedDict()
    for key, value in state.items():
        stripped[key[len("module."):] if key.startswith("module.") else key] = value
    return stripped


def flatten(tensor: torch.Tensor, digits: int) -> dict:
    values = tensor.detach().to(torch.float32).flatten().tolist()
    return {"shape": list(tensor.shape), "values": [round(value, digits) for value in values]}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upstream", type=Path, default=Path(".release-tmp/upstream/rt4ksr"))
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--size", type=int, default=8, help="square LR input size; must be even")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--digits", type=int, default=6)
    parser.add_argument("--exact-input", action="store_true", help="skip 8-bit quantisation of the generated input")
    parser.add_argument("--act-type", default="gelu", help="upstream parser default is gelu")
    parser.add_argument("--feature-channels", type=int, default=24)
    parser.add_argument("--num-blocks", type=int, default=4)
    parser.add_argument("--scale", type=int, default=2)
    args = parser.parse_args()

    if args.size % 2 != 0:
        raise SystemExit("--size must be even because the network starts with PixelUnshuffle(2)")

    model = build_model(args.upstream, args.act_type, args.feature_channels, args.num_blocks, args.scale)
    payload = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    state = payload["state_dict"] if isinstance(payload, dict) and "state_dict" in payload else payload
    missing, unexpected = model.load_state_dict(strip_module_prefix(state), strict=True)  # type: ignore[misc]
    if missing or unexpected:
        raise SystemExit(f"state dict mismatch: missing={missing} unexpected={unexpected}")
    model.eval()

    torch.manual_seed(args.seed)
    lr = torch.rand(1, 3, args.size, args.size, dtype=torch.float32)
    if not args.exact_input:
        # Quantise to 8 bit so an rgba8unorm upload reproduces the input exactly and
        # the GPU pipeline can be compared end to end, not just per layer.
        lr = torch.round(lr * 255.0) / 255.0

    stages: "OrderedDict[str, torch.Tensor]" = OrderedDict()
    with torch.no_grad():
        stages["input"] = lr
        unshuffled = model.down(lr)
        stages["down"] = unshuffled
        shallow = model.head(unshuffled)
        stages["head"] = shallow
        feats = shallow
        for index, block in enumerate(model.body):
            feats = block(feats)
            stages[f"body.{index}"] = feats
        normed = model.tail[0](feats)
        stages["tail.norm"] = normed
        tailed = model.tail[1](normed)
        stages["tail.resblock"] = tailed
        upsampled = model.upsample[0](tailed)
        stages["upsample.conv"] = upsampled
        output = model.upsample[1](upsampled)
        stages["output"] = output
        # Sanity: the staged walk must reproduce the packaged forward exactly.
        drift = (model(lr) - output).abs().max().item()

    if drift > 1e-6:
        raise SystemExit(f"staged walk diverged from model.forward by {drift}")

    reference = {
        "schemaVersion": 1,
        "model": "rt4ksr-x2",
        "upstream": "https://github.com/eduardzamfir/RT4KSR@fd6627a48d789adf5d9aad29f02ab2a3d2a25296",
        "torch": torch.__version__,
        "config": {
            "actType": args.act_type,
            "featureChannels": args.feature_channels,
            "numBlocks": args.num_blocks,
            "scale": args.scale,
            "isTrain": True,
            "forget": False,
            "layernorm": True,
            "blockResidual": False,
            "seed": args.seed,
            "inputSize": args.size,
            "inputQuantized8Bit": not args.exact_input,
        },
        "semantics": {
            "inputUnshuffle": "torch.nn.PixelUnshuffle(2); channel = c * r*r + i * r + j",
            "outputShuffle": f"torch.nn.PixelShuffle({2 * args.scale}); channel = c * r*r + i * r + j",
            "headConv": "Conv2d(12, F, 3, padding=1) zero padding, no activation",
            "resBlock": "expand 1x1 -> pad 1px with expand bias per channel -> fea 3x3 padding=0 + pre-pad identity -> reduce 1x1 -> += block input; no activation inside",
            "bodyBlock": "LayerNorm2d -> ResBlock -> activation; block-level residual disabled (residual=False)",
            "tail": "LayerNorm2d -> ResBlock; no trailing activation",
            "layerNorm2d": "mean/var over the channel dim, eps=1e-6, then weight*y + bias",
            "highFrequencyBranch": "gaussian blur, hfb and gamma are dead at inference because forget=False",
        },
        "stages": {name: flatten(tensor, args.digits) for name, tensor in stages.items()},
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(reference, indent=1), encoding="utf-8")
    print(f"wrote {args.out} ({args.out.stat().st_size} bytes)")
    for name, tensor in stages.items():
        print(f"  {name:16s} {tuple(tensor.shape)}")


if __name__ == "__main__":
    main()
