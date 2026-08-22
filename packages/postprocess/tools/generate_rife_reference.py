"""Generate reference tensors for the Practical-RIFE 4.25 IFNet inference pass.

Unlike RT4KSR, the interpolation graph has no GPU implementation yet. This oracle
exists so the implementation can be built against measured values instead of a
re-derivation, and so the exact operator set can be enumerated.

The architecture ships inside the vendored archive
(`assets/weights/rife/RIFEv4.25.zip` -> `train_log/IFNet_HDv3.py`); only
`model/warplayer.py` has to be fetched from the upstream repository:

    mkdir -p .release-tmp/upstream/rife
    python - <<'PY'
    import zipfile
    z = zipfile.ZipFile('packages/postprocess/assets/weights/rife/RIFEv4.25.zip')
    open('.release-tmp/upstream/rife/IFNet_HDv3.py', 'wb').write(z.read('train_log/IFNet_HDv3.py'))
    PY
    curl -sSL -o .release-tmp/upstream/rife/warplayer.py \
      https://raw.githubusercontent.com/hzwer/Practical-RIFE/17d8c7a1005b37f4c97bfee04e316aaec7fdc536/model/warplayer.py

Then:

    python packages/postprocess/tools/generate_rife_reference.py \
      --upstream .release-tmp/upstream/rife \
      --checkpoint packages/postprocess/assets/weights/rife/RIFEv4.25.zip \
      --out packages/postprocess/tests/fixtures/rife-reference.json
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import types
import zipfile
from collections import OrderedDict
from io import BytesIO
from pathlib import Path

import torch
import torch.nn.functional as F

# `inference` builds this list from scale=1.0; block i runs at 1/scale_list[i].
SCALE_LIST = [16.0, 8.0, 4.0, 2.0, 1.0]


def load_module(path: Path, name: str) -> types.ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise SystemExit(f"cannot import {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def build_ifnet(upstream: Path):
    """Import IFNet_HDv3 with a stub `model.warplayer` package in front of it."""
    warplayer = load_module(upstream / "warplayer.py", "model.warplayer")
    package = types.ModuleType("model")
    package.__path__ = [str(upstream)]
    sys.modules.setdefault("model", package)
    sys.modules["model.warplayer"] = warplayer
    architecture = load_module(upstream / "IFNet_HDv3.py", "rife_ifnet")
    return architecture.IFNet(), warplayer.warp


def read_state_dict(checkpoint: Path) -> "OrderedDict[str, torch.Tensor]":
    if checkpoint.suffix == ".zip":
        with zipfile.ZipFile(checkpoint) as archive:
            payload = torch.load(BytesIO(archive.read("train_log/flownet.pkl")), map_location="cpu", weights_only=False)
    else:
        payload = torch.load(checkpoint, map_location="cpu", weights_only=False)
    state = payload["state_dict"] if isinstance(payload, dict) and "state_dict" in payload else payload
    stripped = OrderedDict()
    for key, value in state.items():
        stripped[key[len("module."):] if key.startswith("module.") else key] = value
    return stripped


def summarize(tensor: torch.Tensor, digits: int, stride: int) -> dict:
    """Shape, global stats and a stride-sampled grid.

    A full dump of every IFNet stage is several megabytes. Sampling from offset 0
    in both axes keeps the top and left borders — where padding mistakes show up —
    and still covers the whole field, while the stats catch a globally wrong scale.
    """
    dense = tensor.detach().to(torch.float32)
    sampled = dense[..., ::stride, ::stride] if stride > 1 else dense
    return {
        "shape": list(dense.shape),
        "sampleStride": stride,
        "sampleShape": list(sampled.shape),
        "stats": {
            "min": round(dense.min().item(), digits),
            "max": round(dense.max().item(), digits),
            "mean": round(dense.mean().item(), digits),
            "absMax": round(dense.abs().max().item(), digits),
        },
        "values": [round(value, digits) for value in sampled.flatten().tolist()],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upstream", type=Path, default=Path(".release-tmp/upstream/rife"))
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--size", type=int, default=64, help="square input size; must be a multiple of 64 so every scale round-trips")
    parser.add_argument("--sample-stride", type=int, default=4, help="spatial stride for the recorded grid; 1 records every pixel")
    parser.add_argument("--timestep", type=float, default=0.5)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--digits", type=int, default=6)
    args = parser.parse_args()

    if args.size % 64 != 0:
        raise SystemExit("--size must be a multiple of 64: block0 runs at 1/16 scale and halves twice inside conv0")

    model, warp = build_ifnet(args.upstream)
    missing, unexpected = model.load_state_dict(read_state_dict(args.checkpoint), strict=False)
    inference_missing = [key for key in missing if not key.startswith(("teacher.", "caltime."))]
    if inference_missing:
        raise SystemExit(f"checkpoint is missing inference tensors: {inference_missing[:8]}")
    model.eval()

    torch.manual_seed(args.seed)
    size = args.size
    img0 = torch.round(torch.rand(1, 3, size, size) * 255.0) / 255.0
    img1 = torch.round(torch.rand(1, 3, size, size) * 255.0) / 255.0

    stages: "OrderedDict[str, torch.Tensor]" = OrderedDict()
    with torch.no_grad():
        stages["img0"] = img0
        stages["img1"] = img1
        # IFBlock resizes its input by 1/scale and its output by scale, both with
        # mode="bilinear", align_corners=False. Record both directions so the GPU
        # kernel is checked against torch rather than against a re-derivation.
        down = F.interpolate(img0, scale_factor=0.25, mode="bilinear", align_corners=False)
        stages["resize.down4"] = down
        stages["resize.up2"] = F.interpolate(down, scale_factor=2.0, mode="bilinear", align_corners=False)
        timestep = (img0[:, :1].clone() * 0 + 1) * args.timestep
        f0 = model.encode(img0)
        f1 = model.encode(img1)
        stages["encode.f0"] = f0
        stages["encode.f1"] = f1

        blocks = [model.block0, model.block1, model.block2, model.block3, model.block4]
        flow = None
        mask = None
        feat = None
        warped0, warped1 = img0, img1
        for index, block in enumerate(blocks):
            if flow is None:
                inputs = torch.cat((img0, img1, f0, f1, timestep), 1)
                flow, mask, feat = block(inputs, None, scale=SCALE_LIST[index])
            else:
                wf0 = warp(f0, flow[:, :2])
                wf1 = warp(f1, flow[:, 2:4])
                inputs = torch.cat((warped0, warped1, wf0, wf1, timestep, mask, feat), 1)
                delta, mask, feat = block(inputs, flow, scale=SCALE_LIST[index])
                flow = flow + delta
            stages[f"block{index}.flow"] = flow
            stages[f"block{index}.mask"] = mask
            stages[f"block{index}.feat"] = feat
            warped0 = warp(img0, flow[:, :2])
            warped1 = warp(img1, flow[:, 2:4])
            stages[f"block{index}.warped0"] = warped0
            stages[f"block{index}.warped1"] = warped1

        blend = torch.sigmoid(mask)
        stages["mask.sigmoid"] = blend
        output = warped0 * blend + warped1 * (1 - blend)
        stages["output"] = output

        packaged = model(torch.cat((img0, img1), 1), args.timestep, SCALE_LIST)[2][4]
        drift = (packaged - output).abs().max().item()

    if drift > 1e-6:
        raise SystemExit(f"staged walk diverged from IFNet.forward by {drift}")

    reference = {
        "schemaVersion": 1,
        "model": "rife-v4.25",
        "upstream": "https://github.com/hzwer/Practical-RIFE@17d8c7a1005b37f4c97bfee04e316aaec7fdc536",
        "torch": torch.__version__,
        "config": {
            "scaleList": SCALE_LIST,
            "timestep": args.timestep,
            "seed": args.seed,
            "inputSize": size,
            "fastmode": True,
            "ensemble": False,
            "inputQuantized8Bit": True,
            "sampleStride": args.sample_stride,
        },
        "semantics": {
            "encode": "Head: conv3x3 s2 -> LReLU(0.2) -> conv3x3 -> LReLU -> conv3x3 -> LReLU -> ConvTranspose2d(16, 4, 4, stride 2, pad 1), no trailing activation",
            "ifblockInput": "F.interpolate(x, 1/scale, bilinear, align_corners=False); flow is resized the same way and scaled by 1/scale before concat",
            "ifblockBody": "conv 3x3 s2 -> LReLU(0.2) -> conv 3x3 s2 -> LReLU(0.2) -> 8x ResConv -> ConvTranspose2d(c, 52, 4, stride 2, pad 1) -> PixelShuffle(2)",
            "resConv": "LeakyReLU(0.2)(conv3x3(x) * beta + x); beta is per-output-channel so it can be folded into the weight and bias",
            "ifblockOutput": "F.interpolate(tmp, scale, bilinear); flow = tmp[:, :4] * scale, mask = tmp[:, 4:5], feat = tmp[:, 5:]",
            "warp": "grid_sample(bilinear, padding_mode='border', align_corners=True) with flow normalised by (size - 1) / 2",
            "accumulation": "flow = flow + delta per block; mask is replaced per block; feat is passed forward",
            "blend": "sigmoid(mask) * warp(img0, flow[:, :2]) + (1 - sigmoid(mask)) * warp(img1, flow[:, 2:4])",
        },
        "stages": {
            name: summarize(tensor, args.digits, 1 if name in ("img0", "img1", "output", "mask.sigmoid", "block4.flow", "block4.warped0", "resize.down4", "resize.up2") else args.sample_stride)
            for name, tensor in stages.items()
        },
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(reference, indent=1), encoding="utf-8")
    print(f"wrote {args.out} ({args.out.stat().st_size} bytes)")
    for name, tensor in stages.items():
        print(f"  {name:20s} {tuple(tensor.shape)}")


if __name__ == "__main__":
    main()
