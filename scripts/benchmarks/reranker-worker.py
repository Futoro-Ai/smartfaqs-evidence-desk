#!/usr/bin/env python3
"""Score bounded pairs with a local pinned model; never contact a model API."""

import json
import hashlib
import os
from pathlib import Path
import resource
import sys
import time

from importlib.metadata import version
from sentence_transformers import CrossEncoder


MAX_INPUT_BYTES = 64 * 1024 * 1024
MAX_TOKENS = 256
POOL_SIZES = (20, 50, 100)
MANIFEST = json.loads(Path(__file__).with_name("reranker-model.v1.json").read_text())


def main() -> None:
    if version("sentence-transformers") != MANIFEST["library"].split("==", 1)[1]:
        raise ValueError("unapproved_reranker_library_version")
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    model_dir = Path(sys.argv[1]).resolve()
    if model_dir.name != MANIFEST["revision"]:
        raise ValueError("unapproved_reranker_model")
    for name, expected in MANIFEST["fileSha256"].items():
        with (model_dir / name).open("rb") as model_file:
            if hashlib.file_digest(model_file, "sha256").hexdigest() != expected:
                raise ValueError("unapproved_reranker_model")
    raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    if len(raw) > MAX_INPUT_BYTES:
        raise ValueError("reranker_input_too_large")
    payload = json.loads(raw)
    if not isinstance(payload, dict) or set(payload) != {"schemaVersion", "queries"} or \
            payload.get("schemaVersion") != "smartfaqs-reranker-input.v1":
        raise ValueError("invalid_reranker_input")
    queries = payload.get("queries")
    if not isinstance(queries, list) or not 1 <= len(queries) <= 500:
        raise ValueError("invalid_reranker_query_count")

    model = CrossEncoder(str(model_dir), device="cpu", max_length=MAX_TOKENS,
                         local_files_only=True, trust_remote_code=False)
    scores_by_query = []
    latency_by_query = []
    truncated_by_query = []
    for query in queries:
        if not isinstance(query, dict) or set(query) != {"query", "passages"}:
            raise ValueError("invalid_reranker_pair")
        query_text = query.get("query")
        passages = query.get("passages")
        if not isinstance(query_text, str) or not isinstance(passages, list) or \
                not 2 <= len(query_text) <= 500 or len(passages) > 100 or any(
            not isinstance(text, str) or not 1 <= len(text) <= 2000 for text in passages
        ):
            raise ValueError("invalid_reranker_pair")
        scores_by_pool = []
        latency = []
        truncated = []
        for pool_size in POOL_SIZES:
            batch = passages[:pool_size]
            if batch:
                tokenized = model.tokenizer(
                    [query_text] * len(batch), batch, truncation=False,
                    add_special_tokens=True,
                )
                truncated_count = sum(
                    len(input_ids) > MAX_TOKENS for input_ids in tokenized["input_ids"]
                )
                start = time.perf_counter()
                batch_scores = model.predict(
                    [(query_text, passage) for passage in batch],
                    batch_size=16,
                    show_progress_bar=False,
                )
                elapsed_ms = (time.perf_counter() - start) * 1000
                scores_by_pool.append([float(score) for score in batch_scores])
            else:
                elapsed_ms = 0.0
                truncated_count = 0
                scores_by_pool.append([])
            latency.append(round(elapsed_ms, 3))
            truncated.append(truncated_count)
        scores_by_query.append(scores_by_pool)
        latency_by_query.append(latency)
        truncated_by_query.append(truncated)

    peak_rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    peak_mib = peak_rss / (1024 * 1024 if sys.platform == "darwin" else 1024)
    json.dump({
        "scoresByPool": scores_by_query,
        "latencyMsByPool": latency_by_query,
        "truncatedCountByPool": truncated_by_query,
        "peakMemoryMiB": round(peak_mib, 3),
    }, sys.stdout)


if __name__ == "__main__":
    main()
