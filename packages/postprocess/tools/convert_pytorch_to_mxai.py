"""Convert an upstream PyTorch checkpoint into the bounded MXAI v1 tensor format.

This tool is intentionally offline. It never fetches a model and it records the
input file hash in the caller's manifest. PyTorch is the only build-time
dependency; the browser runtime never imports it.
"""

from __future__ import annotations

import argparse
import io
import struct
import zipfile
import collections
from pathlib import Path


def load_state_dict(path: Path, archive_member: str | None):
    """Load a checkpoint with PyTorch when available, or with the small
    read-only torch-zip reader below.

    The fallback is deliberately limited to tensor state_dict archives. It
    means the checked-in upstream weights can be converted in a clean build
    environment without making torch a runtime dependency of the SDK.
    """
    try:
        import torch

        if archive_member is None:
            value = torch.load(path, map_location="cpu")
        else:
            with zipfile.ZipFile(path) as archive:
                value = torch.load(io.BytesIO(archive.read(archive_member)), map_location="cpu")
        if hasattr(value, "state_dict"):
            value = value.state_dict()
        if not isinstance(value, dict):
            raise ValueError("checkpoint does not contain a state dict")
        return value
    except ModuleNotFoundError as error:
        if error.name != "torch":
            raise
        return load_torch_zip_without_torch(path, archive_member)


class _TensorRecord:
    def __init__(self, storage_key, offset, shape, stride, dtype):
        self.storage_key = storage_key
        self.offset = int(offset)
        self.shape = tuple(int(value) for value in shape)
        self.stride = tuple(int(value) for value in stride)
        self.dtype = dtype


class _OrderedDict(collections.OrderedDict):
    pass


def load_torch_zip_without_torch(path: Path, archive_member: str | None):
    """Read torch.save's zip serialization without importing torch."""
    if archive_member is None:
        checkpoint = path
    else:
        with zipfile.ZipFile(path) as archive:
            raw = archive.read(archive_member)
        checkpoint = None
        if raw[:4] != b"PK\x03\x04":
            raise ValueError("fallback conversion requires a torch zip archive")
        # A nested torch zip is copied to memory so the same reader can parse it.
        checkpoint = io.BytesIO(raw)

    with zipfile.ZipFile(checkpoint) as archive:
        names = archive.namelist()
        pickle_name = next((name for name in names if name.endswith("/data.pkl") or name == "data.pkl"), None)
        if pickle_name is None:
            raise ValueError("torch archive has no data.pkl")
        prefix = pickle_name[:-len("data.pkl")]
        data = archive.read(pickle_name)

        class Reader(__import__("pickle").Unpickler):
            def persistent_load(self, pid):
                return ("storage", pid)

            def find_class(self, module, name):
                if module == "torch._utils" and name.startswith("_rebuild_tensor"):
                    return lambda storage, offset, shape, stride, *rest: _TensorRecord(
                        storage[1][2], offset, shape, stride, storage[1][1].__name__
                    )
                if module == "collections" and name == "OrderedDict":
                    return _OrderedDict
                if module.startswith("torch"):
                    return type(name, (), {})
                return super().find_class(module, name)

        value = Reader(io.BytesIO(data)).load()
        if hasattr(value, "state_dict"):
            value = value.state_dict()
        if isinstance(value, dict) and "state_dict" in value and isinstance(value["state_dict"], dict):
            value = value["state_dict"]
        if not isinstance(value, dict):
            raise ValueError("checkpoint does not contain a state dict")

        records = {}
        output = {}
        for name, tensor in value.items():
            if not isinstance(name, str) or not isinstance(tensor, _TensorRecord):
                continue
            if tensor.storage_key not in records:
                storage_name = f"{prefix}data/{tensor.storage_key}"
                if storage_name not in names:
                    raise ValueError(f"torch archive is missing storage {tensor.storage_key}")
                records[tensor.storage_key] = (tensor.dtype, archive.read(storage_name))
            dtype, payload = records[tensor.storage_key]
            output[name] = materialize_tensor(tensor, dtype, payload)
        return output


def materialize_tensor(tensor: _TensorRecord, dtype: str, payload: bytes):
    """Return a torch-like value accepted by tensor_bytes()."""
    # Keep this object independent from torch. tensor_bytes handles the
    # fallback record directly and preserves non-contiguous tensor strides.
    return _FallbackTensor(tensor, dtype, payload)


class _FallbackTensor:
    def __init__(self, record, dtype, payload):
        self.record = record
        self.dtype = dtype
        self.payload = payload
        self.shape = record.shape


def tensor_bytes(value):
    if isinstance(value, _FallbackTensor):
        return fallback_tensor_bytes(value)

    import torch

    tensor = value.detach().cpu().contiguous()
    if tensor.dtype not in (torch.float16, torch.float32, torch.uint32, torch.int32):
        tensor = tensor.float()
    element_type = {torch.float16: 2, torch.float32: 1, torch.uint32: 3, torch.int32: 3}[tensor.dtype]
    if tensor.dtype == torch.int32:
        tensor = tensor.view(torch.uint32)
    return element_type, tuple(int(dimension) for dimension in tensor.shape), tensor.numpy().tobytes(order="C")


def fallback_tensor_bytes(value: _FallbackTensor):
    dtype_name = value.dtype.replace("Storage", "").lower()
    if dtype_name in ("float", "double"):
        element_type, fmt = 1, "f"
    elif dtype_name in ("half", "bfloat16"):
        element_type, fmt = 2, "e"
    elif dtype_name in ("long", "int", "int32", "uint"):
        element_type, fmt = 3, "I"
    else:
        raise ValueError(f"unsupported torch storage type {value.dtype}")
    item_size = struct.calcsize("<" + fmt)
    shape = value.record.shape
    count = 1
    for dimension in shape:
        count *= dimension
    if count == 0:
        raise ValueError("zero-sized tensor")
    values = []
    # Torch state_dict tensors are normally contiguous. The general indexed
    # path also handles the occasional view without silently changing layout.
    for linear in range(count):
        remainder = linear
        index = [0] * len(shape)
        for axis in range(len(shape) - 1, -1, -1):
            index[axis] = remainder % shape[axis]
            remainder //= shape[axis]
        element = value.record.offset + sum(i * s for i, s in zip(index, value.record.stride))
        start = element * item_size
        values.append(struct.unpack_from("<" + fmt, value.payload, start)[0])
    if element_type == 3:
        return element_type, shape, struct.pack("<" + "I" * len(values), *[int(v) & 0xffffffff for v in values])
    return element_type, shape, struct.pack("<" + fmt * len(values), *values)


def write_mxai(output: Path, model: str, precision: int, state_dict) -> None:
    records = []
    names = bytearray()
    for name in sorted(state_dict):
        value = state_dict[name]
        if not hasattr(value, "shape"):
            continue
        element_type, shape, payload = tensor_bytes(value)
        if len(shape) > 8 or any(dimension <= 0 or dimension > 65536 for dimension in shape):
            raise ValueError(f"unsafe tensor shape for {name}: {shape}")
        name_offset = 20 + len(model.encode("utf-8")) + len(names)
        name_bytes = name.encode("utf-8")
        names.extend(name_bytes)
        records.append((name_offset, len(name_bytes), len(shape), element_type, shape, payload))

    table_offset = 20 + len(model.encode("utf-8")) + len(names)
    table_end = table_offset + 48 * len(records)
    data_offset = table_end
    entries = bytearray()
    payload = bytearray()
    for name_offset, name_length, rank, element_type, shape, tensor_payload in records:
        padded_shape = tuple(shape) + (0,) * (8 - len(shape))
        entries.extend(struct.pack("<I H B B I I", name_offset, name_length, rank, element_type, data_offset, len(tensor_payload)))
        entries.extend(struct.pack("<8I", *padded_shape))
        payload.extend(tensor_payload)
        data_offset += len(tensor_payload)

    model_bytes = model.encode("utf-8")
    header = struct.pack("<4s H H B 3x I I", b"MXAI", 1, len(model_bytes), precision, len(records), table_offset)
    output.write_bytes(header + model_bytes + names + entries + payload)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--model", required=True)
    parser.add_argument("--archive-member")
    parser.add_argument("--precision", choices=("f16", "f32"), default="f32")
    args = parser.parse_args()
    state_dict = load_state_dict(args.input, args.archive_member)
    write_mxai(args.output, args.model, 2 if args.precision == "f16" else 1, state_dict)


if __name__ == "__main__":
    main()
