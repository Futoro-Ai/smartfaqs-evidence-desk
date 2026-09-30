#!/usr/bin/env python3
"""Prepare the pinned BRIGHT robotics split for local retrieval evaluation."""

import hashlib
import json
from pathlib import Path
import shutil
import urllib.request

import pyarrow.parquet as parquet


ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / ".local/benchmarks/bright-robotics"
REVISION = "3066d29c9651a576c8aba4832d249807b181ecae"
FILES = {
    "documents": (
        "documents/robotics-00000-of-00001.parquet",
        "2c83f286006a3b2e11a677abe88f382009c5ee79f97c1f43f6a571f3f94e6d15",
        7874186,
    ),
    "examples": (
        "examples/robotics-00000-of-00001.parquet",
        "621484c87c9ebae12f81e32a0a8c5d085af4b95cbe1b575ab40ae4b659adb53a",
        178820,
    ),
}


def download(name: str, location: Path) -> tuple[str, list[dict]]:
    relative, expected_hash, expected_size = FILES[name]
    url = f"https://huggingface.co/datasets/xlangai/BRIGHT/resolve/{REVISION}/{relative}"
    request = urllib.request.Request(url, headers={"User-Agent": "EvidenceDeskBenchmark/1"})
    with urllib.request.urlopen(request, timeout=60) as response, location.open("wb") as output:
        digest = hashlib.sha256()
        total = 0
        while block := response.read(1024 * 1024):
            total += len(block)
            if total > expected_size:
                raise ValueError(f"bright_{name}_too_large")
            digest.update(block)
            output.write(block)
    if total != expected_size or digest.hexdigest() != expected_hash:
        raise ValueError(f"bright_{name}_hash_mismatch")
    return digest.hexdigest(), parquet.read_table(location).to_pylist()


def write_rows(location: Path, rows: list[dict], fields: tuple[str, ...]) -> str:
    digest = hashlib.sha256()
    with location.open("wb") as output:
        for row in rows:
            selected = {field: row[field] for field in fields}
            line = (json.dumps(selected, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
            output.write(line)
            digest.update(line)
    return digest.hexdigest()


def main() -> None:
    data = TARGET / "data"
    if data.exists():
        if not all((data / f"{name}.jsonl").is_file() for name in FILES):
            raise ValueError("incomplete_bright_robotics_data")
        receipt_path = TARGET / "download-receipt.json"
        if not receipt_path.is_file():
            raise ValueError("bright_prepare_receipt_missing")
        receipt = json.loads(receipt_path.read_text())
        if (receipt.get("dataset") != "xlangai/BRIGHT" or
                receipt.get("revision") != REVISION or receipt.get("split") != "robotics" or
                receipt.get("sourceSha256") != {
                    name: expected_hash for name, (_, expected_hash, _) in FILES.items()
                }):
            raise ValueError("bright_prepare_receipt_mismatch")
        for name in FILES:
            expected_hash = receipt.get("jsonlSha256", {}).get(name)
            actual_hash = hashlib.sha256((data / f"{name}.jsonl").read_bytes()).hexdigest()
            if not expected_hash or actual_hash != expected_hash:
                raise ValueError(f"bright_prepared_file_hash_mismatch:{name}")
        print(json.dumps({"status": "already_prepared", "dataDirectory": str(data)}))
        return
    TARGET.mkdir(parents=True, exist_ok=True)
    temporary = TARGET / "prepare.tmp"
    if temporary.exists():
        raise ValueError("bright_prepare_directory_exists")
    temporary.mkdir()
    try:
        inputs = {}
        outputs = {}
        counts = {}
        for name, fields in (
            ("documents", ("id", "content")),
            ("examples", ("id", "query", "excluded_ids", "gold_ids")),
        ):
            inputs[name], rows = download(name, temporary / f"{name}.parquet")
            identifiers = [row["id"] for row in rows]
            if len(identifiers) != len(set(identifiers)):
                raise ValueError(f"duplicate_bright_{name}_id")
            counts[name] = len(rows)
            outputs[name] = write_rows(temporary / f"{name}.jsonl", rows, fields)
        data.mkdir()
        for name in FILES:
            (temporary / f"{name}.jsonl").replace(data / f"{name}.jsonl")
        (TARGET / "download-receipt.json").write_text(json.dumps({
            "dataset": "xlangai/BRIGHT",
            "revision": REVISION,
            "split": "robotics",
            "sourceSha256": inputs,
            "jsonlSha256": outputs,
            "counts": counts,
        }, indent=2) + "\n")
        print(json.dumps({"status": "prepared", "dataDirectory": str(data), "counts": counts}))
    finally:
        shutil.rmtree(temporary)


if __name__ == "__main__":
    main()
