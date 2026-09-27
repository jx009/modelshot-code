"""Provision pinned Apache-2.0 SlimSAM ONNX weights during build, never on requests."""
import hashlib
import os
from pathlib import Path
from urllib.request import urlopen

REVISION = "5850ab45f587c112167512ffef949107115e26a0"
FILES = {
    "vision_encoder_quantized.onnx": "cce23c7b2e5d4f330932738fb67ba518e04b0d99ccdd1cccd22a7da4e01f2971",
    "prompt_encoder_mask_decoder_quantized.onnx": "cb90b279f549d2cab7fd6e20c38522438c65d84bdcca3d2a764cff7d857fdce2",
}


def provision(directory):
    root = Path(directory)
    root.mkdir(parents=True, exist_ok=True)
    for name, checksum in FILES.items():
        target = root / name
        if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == checksum:
            continue
        url = f"https://huggingface.co/Xenova/slimsam-77-uniform/resolve/{REVISION}/onnx/{name}"
        with urlopen(url, timeout=120) as response:
            data = response.read(32 * 1024 * 1024)
        if hashlib.sha256(data).hexdigest() != checksum:
            raise RuntimeError(f"Invalid model checksum: {name}")
        partial = root / f"{name}.partial"
        partial.write_bytes(data)
        partial.replace(target)
        print(f"Verified {name}: {len(data)} bytes", flush=True)


if __name__ == "__main__":
    provision(os.environ.get("SEGMENT_MODEL_DIR", "/opt/modelshot-models/slimsam"))
