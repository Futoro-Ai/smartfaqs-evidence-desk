"""Pure worker validation, independent of optional model libraries."""
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import uuid

spec = importlib.util.spec_from_file_location("semantic_worker", Path(__file__).with_name("semantic-worker.py"))
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class WorkerTests(unittest.TestCase):
    def test_every_token_covered(self):
        ids = list(range(1700))
        windows = worker.token_windows(ids)
        self.assertEqual(set(ids), set(x for window in windows for x in window))
        self.assertTrue(all(len(window) <= 448 for window in windows))
        self.assertEqual(windows[0][-64:], windows[1][:64])

    def test_no_silent_window_drop(self):
        with self.assertRaisesRegex(ValueError, "window_limit"):
            worker.token_windows(list(range(30000)))

    def test_empty_text(self):
        with self.assertRaisesRegex(ValueError, "empty_semantic"):
            worker.token_windows([])

    def test_special_and_unknown_ids_are_not_decoded_away(self):
        class Tokenizer:
            cls_token_id = 101
            sep_token_id = 102
        self.assertEqual(worker.model_windows(Tokenizer(), [100, 103, 7], [20]),
                         [[101, 20, 100, 103, 7, 102]])

    def test_invalid_query_embeddings_fail_closed(self):
        for rows in ([[0, 0]], [[1, float("nan")]], [[float("inf"), 0]],
                     [[1]], [[1, 0], [-1, 0]], []):
            with self.assertRaisesRegex(ValueError, "invalid_semantic_query_embedding"):
                worker.normalized_query_vector(rows, 2)
        self.assertEqual(worker.normalized_query_vector([[3, 4]], 2), [0.6, 0.8])

    def test_scope(self):
        payload = {
            "schemaVersion": "smartfaqs-semantic-input.v1",
            "documents": [{"ref": "a", "sourceRef": "source:a", "text": "public text"}],
            "queries": [{"sourceRef": "source:b", "text": "query", "excludedRefs": []}],
        }
        with self.assertRaisesRegex(ValueError, "query_scope"):
            worker.validate_input(payload)
        payload["queries"][0]["sourceRef"] = "source:a"
        worker.validate_input(payload)
        payload["documents"].append(payload["documents"][0])
        with self.assertRaisesRegex(ValueError, "duplicate"):
            worker.validate_input(payload)

    def test_extra_fields_rejected(self):
        with self.assertRaisesRegex(ValueError, "invalid_semantic_input"):
            worker.validate_input({"schemaVersion": "smartfaqs-semantic-input.v1", "prompt": "bad"})

    @unittest.skipUnless(os.environ.get("SEMANTIC_MODEL_TESTS") == "1", "optional pinned model required")
    def test_resumable_cache_and_corruption_rejection(self):
        source = "source:cache-test-" + uuid.uuid4().hex
        worker.BASE.mkdir(parents=True, exist_ok=True)
        source_directory = worker.BASE / "indexes" / hashlib.sha256(source.encode()).hexdigest()[:24]
        self.assertFalse(source_directory.exists())
        try:
            with tempfile.TemporaryDirectory(dir=worker.BASE) as temporary:
                input_path = Path(temporary) / "input.json"
                input_path.write_text(json.dumps({
                    "schemaVersion": "smartfaqs-semantic-input.v1",
                    "documents": [
                        {"ref": "a", "sourceRef": source, "text": "Annual leave accrual rates by service duration."},
                        {"ref": "b", "sourceRef": source, "text": "Dental coverage enrollment periods and exclusions."},
                    ],
                    "queries": [
                        {"sourceRef": source, "text": "annual leave accrual", "excludedRefs": ["b"]},
                        {"sourceRef": source, "text": "dental coverage enrollment", "excludedRefs": []},
                    ],
                }))
                def run():
                    return subprocess.run([sys.executable, str(Path(worker.__file__)), str(input_path)],
                                          capture_output=True, timeout=60, check=False)
                first = run()
                self.assertEqual(first.returncode, 0, first.stderr.decode())
                first_output = json.loads(first.stdout)
                receipt = first_output["indexReceipts"][0]
                self.assertFalse(receipt["cacheHit"])
                self.assertEqual(first_output["refsByQuery"], [["a"], ["b", "a"]])
                directory = source_directory / receipt["identity"]
                for name in ("receipt.json", "vectors.npy", "parents.npy"):
                    (directory / name).unlink()
                resumed = run()
                self.assertEqual(resumed.returncode, 0, resumed.stderr.decode())
                resumed_output = json.loads(resumed.stdout)
                self.assertEqual(resumed_output["refsByQuery"], first_output["refsByQuery"])
                self.assertEqual(resumed_output["indexReceipts"][0]["buildMs"], receipt["buildMs"])
                (directory / "receipt.json").unlink()
                shard_vectors = directory / "shard-000000/vectors.npy"
                original = shard_vectors.read_bytes()
                shard_vectors.write_bytes(original[:-1] + bytes([original[-1] ^ 1]))
                rejected = run()
                self.assertNotEqual(rejected.returncode, 0)
                self.assertEqual(rejected.stdout, b"")
                self.assertEqual(rejected.stderr.decode().splitlines()[-1], "semantic_worker_failed")
                shard_vectors.write_bytes(original)
                restored = run()
                self.assertEqual(restored.returncode, 0, restored.stderr.decode())
        finally:
            if source_directory.exists():
                shutil.rmtree(source_directory)

    @unittest.skipUnless(os.environ.get("SEMANTIC_MODEL_TESTS") == "1", "optional NumPy required")
    def test_invalid_shards_are_not_published(self):
        import numpy as np
        valid = np.pad(np.eye(2, dtype="float32"), ((0, 0), (0, 382)))
        nonfinite = valid.copy()
        nonfinite[0, 0] = np.nan
        cases = [
            (np.zeros((2, 384), dtype="float32"), np.array([0, 1])),
            (np.eye(2), np.array([0, 1])),
            (nonfinite, np.array([0, 1])),
            (valid, np.array([0.0, 1.0])),
            (valid, np.array([0, 0])),
            (valid, np.array([0, 2])),
        ]
        with tempfile.TemporaryDirectory(dir=worker.BASE) as temporary:
            for vectors, parents in cases:
                with self.assertRaises(ValueError):
                    worker.publish_cache(Path(temporary), vectors, parents, {}, 0, 2)
                self.assertEqual(list(Path(temporary).iterdir()), [])

    @unittest.skipUnless(os.environ.get("SEMANTIC_MODEL_TESTS") == "1", "optional NumPy required")
    def test_interrupted_final_receipt_is_not_a_cache_hit(self):
        import numpy as np
        vectors = np.pad(np.eye(2, dtype="float32"), ((0, 0), (0, 382)))
        parents = np.array([0, 1], dtype="int32")
        original_replace = Path.replace
        def interrupt_receipt(file, target):
            if target.name == "receipt.json":
                raise OSError("simulated_interruption")
            return original_replace(file, target)
        with tempfile.TemporaryDirectory(dir=worker.BASE) as temporary:
            directory = Path(temporary)
            with patch.object(Path, "replace", interrupt_receipt):
                with self.assertRaisesRegex(OSError, "simulated_interruption"):
                    worker.publish_cache(directory, vectors, parents, {}, 0, 2)
            self.assertFalse((directory / "receipt.json").exists())
            self.assertTrue((directory / "receipt.partial").exists())
            worker.publish_cache(directory, vectors, parents, {}, 0, 2)
            self.assertTrue((directory / "receipt.json").exists())


if __name__ == "__main__":
    unittest.main()
