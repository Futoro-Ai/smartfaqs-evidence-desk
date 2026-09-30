#!/usr/bin/env python3
"""Offline exact cosine retrieval in physically source-partitioned caches."""
import hashlib
from importlib.metadata import version
import json
import math
import os
from pathlib import Path
import resource
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
MANIFEST_BYTES = Path(__file__).with_name("semantic-model.v1.json").read_bytes()
MANIFEST = json.loads(MANIFEST_BYTES)
BASE = ROOT / ".local/benchmarks/semantic"
MAX_INPUT_BYTES = 64 * 1024 * 1024
ENCODING_VERSION = "length-batched-direct-token-windows-mean-query-max-parent.v2"


def digest(value):
    return hashlib.sha256(value).hexdigest()


def token_windows(ids, size=448, overlap=64, max_windows=64):
    if not ids:
        raise ValueError("empty_semantic_text")
    output = []
    for start in range(0, len(ids), size - overlap):
        output.append(ids[start:start + size])
        if len(output) > max_windows:
            raise ValueError("semantic_window_limit_exceeded")
        if start + size >= len(ids):
            break
    return output


def model_windows(tokenizer, ids, prefix_ids=()):
    windows = token_windows(ids, MANIFEST["windowTokens"], MANIFEST["overlapTokens"],
                            MANIFEST["maxWindowsPerText"])
    if tokenizer.cls_token_id is None or tokenizer.sep_token_id is None:
        raise ValueError("unsupported_semantic_tokenizer")
    # The pinned BGE model uses BERT's single-sequence CLS/SEP layout.
    inputs = [[tokenizer.cls_token_id] + list(prefix_ids) + window + [tokenizer.sep_token_id]
              for window in windows]
    if any(len(row) > 512 for row in inputs):
        raise ValueError("semantic_window_input_overflow")
    return inputs


def normalized_query_vector(rows, dimension=384):
    if not rows or any(len(row) != dimension or any(
            not math.isfinite(float(value)) for value in row) for row in rows):
        raise ValueError("invalid_semantic_query_embedding")
    vector = [sum(row[i] for row in rows) / len(rows) for i in range(dimension)]
    norm = math.sqrt(sum(value * value for value in vector))
    if not math.isfinite(norm) or norm <= 1e-12:
        raise ValueError("invalid_semantic_query_embedding")
    return [value / norm for value in vector]


def validate_input(payload):
    if not isinstance(payload, dict) or set(payload) != {"schemaVersion", "documents", "queries"} or \
            payload["schemaVersion"] != "smartfaqs-semantic-input.v1":
        raise ValueError("invalid_semantic_input")
    docs, queries = payload["documents"], payload["queries"]
    if not isinstance(docs, list) or not 1 <= len(docs) <= 100_000 or \
            not isinstance(queries, list) or not 1 <= len(queries) <= 500:
        raise ValueError("invalid_semantic_count")
    scope = {}
    for doc in docs:
        if not isinstance(doc, dict) or set(doc) != {"ref", "sourceRef", "text"} or any(
                not isinstance(doc[k], str) or not doc[k] for k in doc) or \
                len(doc["ref"]) > 256 or len(doc["sourceRef"]) > 256 or len(doc["text"]) > 200_000:
            raise ValueError("invalid_semantic_document")
        refs = scope.setdefault(doc["sourceRef"], set())
        if doc["ref"] in refs:
            raise ValueError("duplicate_semantic_ref")
        refs.add(doc["ref"])
    for query in queries:
        if not isinstance(query, dict) or set(query) != {"sourceRef", "text", "excludedRefs"} or \
                not isinstance(query["sourceRef"], str) or query["sourceRef"] not in scope or \
                not isinstance(query["text"], str) or not 2 <= len(query["text"]) <= 25_000 or \
                not isinstance(query["excludedRefs"], list) or any(
                    not isinstance(ref, str) or len(ref) > 256 for ref in query["excludedRefs"]):
            raise ValueError("invalid_semantic_query_scope")
    return docs, queries


def validate_vectors(vectors, parents, start, end):
    import numpy as np
    if vectors.ndim != 2 or vectors.shape[1] != MANIFEST["dimensions"] or \
            parents.dtype.kind not in "iu" or parents.shape != (len(vectors),) or \
            end <= start or np.any(parents < start) or np.any(parents >= end) or \
            not np.all(np.isfinite(vectors)) or not np.allclose(np.linalg.norm(vectors, axis=1), 1, atol=0.001):
        raise ValueError("invalid_semantic_cache_shape")
    counts = np.bincount(parents.astype("int64") - start, minlength=end - start)
    if np.any(counts == 0) or np.any(counts > MANIFEST["maxWindowsPerText"]):
        raise ValueError("invalid_semantic_parent_coverage")


def publish_cache(directory, vectors, parents, receipt, start, end):
    import numpy as np
    validate_vectors(vectors, parents, start, end)
    for name, array in (("vectors", vectors), ("parents", parents)):
        file = directory / (name + ".npy")
        temporary = file.with_suffix(".partial")
        with temporary.open("wb") as stream:
            np.save(stream, array, allow_pickle=False)
        temporary.replace(file)
        receipt[name + "Sha256"] = digest(file.read_bytes())
    temporary = directory / "receipt.partial"
    temporary.write_text(json.dumps(receipt, sort_keys=True) + "\n")
    temporary.replace(directory / "receipt.json")


def main():
    started = time.perf_counter()
    for name, expected in MANIFEST["libraries"].items():
        if version(name) != expected:
            raise ValueError("unapproved_semantic_library")
    for key in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "HF_HUB_DISABLE_TELEMETRY"):
        os.environ[key] = "1"
    import numpy as np
    import torch
    from sentence_transformers import SentenceTransformer
    torch.set_num_threads(4)
    if len(sys.argv) != 2:
        raise ValueError("semantic_input_required")
    input_path = Path(sys.argv[1]).resolve()
    if not input_path.is_relative_to(BASE.resolve()) or input_path.stat().st_size > MAX_INPUT_BYTES:
        raise ValueError("invalid_semantic_input_path")
    docs, queries = validate_input(json.loads(input_path.read_bytes()))
    model_dir = ROOT / ".local/models/bge-small-en-v1.5" / MANIFEST["revision"]
    for name, expected in MANIFEST["fileSha256"].items():
        file = model_dir / name
        if file.is_symlink():
            raise ValueError("semantic_model_symlink")
        with file.open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != expected:
                raise ValueError("semantic_model_checksum_mismatch")
    model = SentenceTransformer(str(model_dir), device="cpu", model_kwargs={"use_safetensors": True},
                                local_files_only=True, trust_remote_code=False)
    model.max_seq_length = 512
    model.eval()
    loaded_ms = (time.perf_counter() - started) * 1000

    instruction_ids = model.tokenizer(MANIFEST["queryInstruction"], add_special_tokens=False,
                                      truncation=False)["input_ids"]

    def inputs_for_windows(text, is_query=False):
        ids = model.tokenizer(text, add_special_tokens=False, truncation=False)["input_ids"]
        return model_windows(model.tokenizer, ids, instruction_ids if is_query else ()), len(ids)

    def encode_windows(inputs):
        batches = []
        order = sorted(range(len(inputs)), key=lambda i: len(inputs[i]))
        # Feed IDs directly: a decode/re-tokenize round-trip can discard unknown tokens.
        for start in range(0, len(inputs), 32):
            features = model.tokenizer.pad(
                [{"input_ids": inputs[i]} for i in order[start:start + 32]],
                padding=True, return_tensors="pt")
            with torch.inference_mode():
                embeddings = model(features)["sentence_embedding"]
                embeddings = torch.nn.functional.normalize(embeddings, dim=1)
            batches.append(embeddings.cpu().numpy().astype("float32"))
        return np.concatenate(batches)[np.argsort(order)]

    partitions, receipts = {}, []
    for source in sorted({doc["sourceRef"] for doc in docs}):
        scoped = sorted((doc for doc in docs if doc["sourceRef"] == source), key=lambda d: d["ref"])
        corpus_hash = digest(json.dumps(scoped, ensure_ascii=False, separators=(",", ":")).encode())
        identity = digest(MANIFEST_BYTES + corpus_hash.encode() + ENCODING_VERSION.encode()
                          + Path(__file__).read_bytes())
        directory = BASE / "indexes" / digest(source.encode())[:24] / identity
        directory.mkdir(parents=True, exist_ok=True)
        vectors_path, parents_path, receipt_path = (
            directory / "vectors.npy", directory / "parents.npy", directory / "receipt.json")
        cache_hit = receipt_path.is_file()
        if cache_hit:
            receipt = json.loads(receipt_path.read_text())
            if receipt.get("identity") != identity:
                raise ValueError("semantic_cache_identity_mismatch")
            for file, name in ((vectors_path, "vectorsSha256"), (parents_path, "parentsSha256")):
                with file.open("rb") as stream:
                    if hashlib.file_digest(stream, "sha256").hexdigest() != receipt.get(name):
                        raise ValueError("semantic_cache_checksum_mismatch")
            vectors = np.load(vectors_path, allow_pickle=False, mmap_mode="r")
            parents = np.load(parents_path, allow_pickle=False)
        else:
            all_vectors, parent_ids, token_count, multi_window, shard_build_ms = [], [], 0, 0, 0
            # Cold CPU indexing can outlive a run; retain only checksummed, source-bound shards.
            for start in range(0, len(scoped), 128):
                shard = directory / f"shard-{start:06d}"
                shard.mkdir(exist_ok=True)
                shard_receipt_path = shard / "receipt.json"
                if shard_receipt_path.is_file():
                    part = json.loads(shard_receipt_path.read_text())
                    if part.get("identity") != identity or part.get("start") != start:
                        raise ValueError("semantic_shard_identity_mismatch")
                    for name in ("vectors", "parents"):
                        with (shard / (name + ".npy")).open("rb") as stream:
                            if hashlib.file_digest(stream, "sha256").hexdigest() != part.get(name + "Sha256"):
                                raise ValueError("semantic_shard_checksum_mismatch")
                    shard_vectors = np.load(shard / "vectors.npy", allow_pickle=False)
                    shard_parents = np.load(shard / "parents.npy", allow_pickle=False)
                else:
                    shard_started = time.perf_counter()
                    texts, pending_parents, tokens_in_shard, multi_in_shard = [], [], 0, 0
                    for parent in range(start, min(start + 128, len(scoped))):
                        windows, tokens = inputs_for_windows(scoped[parent]["text"])
                        tokens_in_shard += tokens
                        multi_in_shard += int(len(windows) > 1)
                        texts.extend(windows)
                        pending_parents.extend([parent] * len(windows))
                    shard_vectors = encode_windows(texts)
                    shard_parents = np.asarray(pending_parents, dtype="int32")
                    part = {"identity": identity, "start": start,
                            "inputTokenCount": tokens_in_shard, "multiWindowDocumentCount": multi_in_shard,
                            "buildMs": round((time.perf_counter() - shard_started) * 1000, 3)}
                    publish_cache(shard, shard_vectors, shard_parents, part,
                                  start, min(start + 128, len(scoped)))
                validate_vectors(shard_vectors, shard_parents, start, min(start + 128, len(scoped)))
                all_vectors.append(shard_vectors)
                parent_ids.extend(shard_parents)
                token_count += part["inputTokenCount"]
                multi_window += part["multiWindowDocumentCount"]
                shard_build_ms += part["buildMs"]
            vectors = np.concatenate(all_vectors)
            parents = np.asarray(parent_ids, dtype="int32")
            receipt = {
                "schemaVersion": "smartfaqs-semantic-index.v1", "identity": identity,
                "corpusSha256": corpus_hash, "modelManifestSha256": digest(MANIFEST_BYTES),
                "dimension": MANIFEST["dimensions"], "documentCount": len(scoped),
                "windowCount": len(vectors), "inputTokenCount": token_count,
                "multiWindowDocumentCount": multi_window, "discardedTokenCount": 0,
                "buildMs": round(shard_build_ms, 3),
            }
            publish_cache(directory, vectors, parents, receipt, 0, len(scoped))
        validate_vectors(vectors, parents, 0, len(scoped))
        if len(vectors) != receipt["windowCount"]:
            raise ValueError("invalid_semantic_cache_shape")
        partitions[source] = (scoped, vectors, parents)
        receipts.append({**receipt, "sourceHash": digest(source.encode())[:24], "cacheHit": cache_hit,
                         "cacheBytes": vectors_path.stat().st_size + parents_path.stat().st_size})
    output, latencies, query_windows = [], [], []
    for query in queries:
        begin = time.perf_counter()
        scoped, vectors, parents = partitions[query["sourceRef"]]
        texts, _ = inputs_for_windows(query["text"], True)
        qvectors = encode_windows(texts)
        qvector = np.asarray(normalized_query_vector(qvectors.tolist()), dtype="float32")
        scores = np.full(len(scoped), -np.inf, dtype="float32")
        np.maximum.at(scores, parents, vectors @ qvector)
        excluded = set(query["excludedRefs"])
        eligible = np.asarray([i for i, doc in enumerate(scoped) if doc["ref"] not in excluded], dtype="int64")
        order = eligible[np.argsort(-scores[eligible], kind="stable")][:100]
        output.append([scoped[int(i)]["ref"] for i in order])
        latencies.append(round((time.perf_counter() - begin) * 1000, 3))
        query_windows.append(len(qvectors))
    peak_rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    json.dump({
        "schemaVersion": "smartfaqs-semantic-output.v1", "refsByQuery": output,
        "latencyMsByQuery": latencies, "queryWindowCounts": query_windows,
        "startupMs": round(loaded_ms, 3), "indexReceipts": receipts, "discardedTokenCount": 0,
        "peakRssMiB": round(peak_rss / (1024 * 1024 if sys.platform == "darwin" else 1024), 3),
    }, sys.stdout)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("semantic_worker_failed", file=sys.stderr)
        sys.exit(1)
