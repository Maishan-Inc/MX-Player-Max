# AI model assets

The binary files in `weights/` include the immutable upstream archives and the
MXAI v1 browser artifacts derived from them. The browser loads only MXAI; the
upstream files remain beside it for source and license reproducibility.

| Asset | Upstream | Commit | License | SHA-256 |
| --- | --- | --- | --- | --- |
| `weights/rt4ksr/rt4ksr_x2.pth` | `eduardzamfir/RT4KSR` | `fd6627a48d789adf5d9aad29f02ab2a3d2a25296` | Apache-2.0 | `9ec7500092848a480e058a9c703e4b2254bc0cc97928c076bba272177752124f` |
| `weights/rife/RIFEv4.25.zip` | `hzwer/Practical-RIFE` | `17d8c7a1005b37f4c97bfee04e316aaec7fdc536` | MIT | `e63d481b7ae5d4a4e6ad7ac5b410ff78f3bf7be3b51b2e38ca8152747abde5b4` |

| Browser artifact | Derived from | SHA-256 |
| --- | --- | --- |
| `weights/rt4ksr/rt4ksr_x2.mxai` | `rt4ksr_x2.pth`, MXAI v1 f32, 51 inference tensors | `c34a7654fe40f34f6ee0ba47c9c3bea504b18a7c9c045261bfd4733f2662fba0` |
| `weights/rife/rife_v4.25.mxai` | `RIFEv4.25.zip::train_log/flownet.pkl`, MXAI v1 f32, 198 tensors | `665472509a3c9b50d9436d07e85754b8f1c4bb27ab48a3e531a6ebaec5bac56c` |

The corresponding upstream license texts are stored beside each asset. RIFE 4.25 is used because the locked Practical-RIFE upstream archive does not publish a 4.6 artifact. The catalog does not claim that 4.25 is 4.6.

The MXAI files are generated offline with:

```text
python tools/convert_pytorch_to_mxai.py assets/weights/rt4ksr/rt4ksr_x2.pth assets/weights/rt4ksr/rt4ksr_x2.mxai --model rt4ksr-x2 --precision f32
python tools/convert_pytorch_to_mxai.py assets/weights/rife/RIFEv4.25.zip assets/weights/rife/rife_v4.25.mxai --model rife-v4.25 --archive-member train_log/flownet.pkl --precision f32
```

The converter records tensor names and shapes from the checkpoint and never
downloads or executes model code. Only verified MXAI bytes enter the browser.
