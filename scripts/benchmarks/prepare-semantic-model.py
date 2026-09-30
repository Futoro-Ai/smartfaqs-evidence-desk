#!/usr/bin/env python3
"""Explicit public model download; inference itself is always offline."""
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = json.loads(Path(__file__).with_name("semantic-model.v1.json").read_text())


def main():
    target = ROOT / ".local/models/bge-small-en-v1.5" / MANIFEST["revision"]
    for name, expected in MANIFEST["fileSha256"].items():
        file = target / name
        file.parent.mkdir(parents=True, exist_ok=True)
        if not file.exists():
            request = urllib.request.Request(
                f'https://huggingface.co/{MANIFEST["repository"]}/resolve/{MANIFEST["revision"]}/{name}',
                headers={"User-Agent": "EvidenceDeskOfflineExperiment/1"})
            temporary = file.with_suffix(file.suffix + ".partial")
            with urllib.request.urlopen(request, timeout=120) as response, temporary.open("wb") as output:
                total = 0
                while block := response.read(1024 * 1024):
                    total += len(block)
                    if total > 140_000_000:
                        raise ValueError("semantic_model_file_too_large")
                    output.write(block)
            with temporary.open("rb") as stream:
                if hashlib.file_digest(stream, "sha256").hexdigest() != expected:
                    raise ValueError("semantic_model_checksum_mismatch")
            temporary.replace(file)
        with file.open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != expected:
                raise ValueError("semantic_model_checksum_mismatch")
    print(json.dumps({"model_ready": True, "revision": MANIFEST["revision"]}))


if __name__ == "__main__":
    main()
