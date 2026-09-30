#!/usr/bin/env python3
"""Download only the pinned local cross-encoder files for opt-in benchmarks."""

import hashlib
import json
from pathlib import Path

from huggingface_hub import snapshot_download


ROOT = Path(__file__).resolve().parents[2]
MANIFEST = json.loads(Path(__file__).with_name("reranker-model.v1.json").read_text())
TARGET = ROOT / ".local" / "models" / "ms-marco-MiniLM-L6-v2" / MANIFEST["revision"]


def main() -> None:
    TARGET.mkdir(parents=True, exist_ok=True)
    snapshot_download(
        repo_id=MANIFEST["repository"],
        revision=MANIFEST["revision"],
        local_dir=TARGET,
        allow_patterns=list(MANIFEST["fileSha256"]),
    )
    for name, expected in MANIFEST["fileSha256"].items():
        if not (TARGET / name).is_file():
            raise SystemExit("reranker_model_incomplete")
        with (TARGET / name).open("rb") as model_file:
            if hashlib.file_digest(model_file, "sha256").hexdigest() != expected:
                raise SystemExit("reranker_model_checksum_mismatch")
    print(f"model_ready revision={MANIFEST['revision']} files_verified={len(MANIFEST['fileSha256'])}")


if __name__ == "__main__":
    main()
