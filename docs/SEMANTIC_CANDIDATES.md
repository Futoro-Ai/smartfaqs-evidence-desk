# Offline Semantic Candidate Experiment

## Status and Scope

This is a developer-only, source-scoped retrieval experiment. The website,
WebMCP tools and standard MCP endpoint still use the existing lexical runtime.
No database, hosted model API, public import endpoint, deployment flag or
production request path was added.

The exact implementation base is `fc05585bcb6e5783301a378042667f616919a6e1`.
The fixed protocol is [semantic-protocol.v1.json](../benchmarks/semantic-protocol.v1.json).
Aggregate results are in
[semantic-candidates-baseline.v1.json](../benchmarks/semantic-candidates-baseline.v1.json).
Input text, questions, labels, model weights, embeddings and detailed reports
remain in ignored `.local/` storage.

## Corpus and Label Authority

BRIGHT robotics uses all 61,961 short documents and all 101 queries at dataset
revision `3066d29c9651a576c8aba4832d249807b181ecae`. The runner checks the
prepared JSONL files against the pinned download receipt. Document IDs are
judgment keys, never retrieval text. Exclusions apply before rank cutoffs.
This is a robotics-only offline measurement, not the BRIGHT leaderboard average
or an official submission.

The primary domain corpus is the USPS [ELM5 PDF](https://about.usps.com/manuals/elm/elmc5.pdf),
pinned to SHA-256
`652d1612fdff0bb6e85546b981db5ddc59496ad7a27b65c5e88b5efb6b24de95`.
This evaluated edition is ELM 55, March 2024, not a claim of current benefits
or legal guidance. Docling 2.130.0 used OCR off, accurate table extraction and
remote services disabled. The unchanged OKF converter retained heading-only
records as structural navigation, not factual evidence.

The private bundle contains 3,575 evidence chunks: 51 nonempty tables and
3,524 text chunks, with 1,785 section concepts derived from 1,933 heading-only
records. Exact token preflight found a maximum of 5,296 tokens per semantic
document; no text exceeded the 24,640-token window capacity.

Extraction is not perfect. Docling reported four dropped cells from a
42-by-5 grid, but the exact table mapping was not verified. A potentially
affected table on PDF page 221 is conservatively excluded from positive gold,
not from the retrieval corpus. One table item on page 204 was empty and
produced no evidence chunk. The runner verifies the PDF, JSONL export, full
Docling export and extraction-review fingerprints and carries these limitations
into the report.

There are 48 new ELM5 questions, split into 24 development and 24 held-out
questions. Each split has six questions in each category:

- Table values, units and footnotes.
- Negation and exceptions.
- Multiple independently required passages.
- Unanswerable or out-of-source requests.

One read-only reviewer authored the questions; a second source-only review
checked all 48 and corrected eight entries before ELM scoring. Positive gold
references and question IDs are disjoint across splits. Negative rationale
anchors and source concepts are not fully disjoint. Eight queries name
numbered sections, exhibits or tables, so this is not an entirely hint-free
paraphrase set. One printed arithmetic example is internally inconsistent:
its retrieval labels establish source-faithful extraction, not validated
arithmetic.

The status is `ai_source_review_not_external_human_adjudication`. Neither
source review nor a held-out split within one manual substitutes for external
human adjudication or broad domain generalization. The reported held-out set is now a regression set; further tuning needs new,
unseen questions. Gold files remain private;
other developers can reproduce BRIGHT exactly but cannot reproduce the
recorded ELM question-level scores without those exact reviewed gold files.

## Independent Candidate Path

The optional model is [BAAI/bge-small-en-v1.5](https://huggingface.co/BAAI/bge-small-en-v1.5/blob/5c38ec7c405ec4b44b94cc5a9bb96e735b38267a/README.md), revision
`5c38ec7c405ec4b44b94cc5a9bb96e735b38267a`, under MIT.
[semantic-model.v1.json](../scripts/benchmarks/semantic-model.v1.json)
pins the ten consumed model-file hashes, 384 dimensions, query instruction,
tokenizer and library versions. Downloads occur only in the explicit preparer.
Inference uses local files, safe tensor weights, no remote code and no model API.

Documents include their heading ancestry and structured table headers/rows.
Every token is retained in 448-token windows with 64-token overlap, up to
64 windows per text. Original token IDs go directly to the model; there is
no lossy decode/re-tokenize step. Oversized text fails closed rather than
silently truncating. Query-window vectors are normalized means; document
scores take the maximum window score for each parent evidence record.

Each source has its own physically separate index. Exact cosine search cannot
return another source's candidates. Input/output schemas, count and byte
bounds, excluded references, result uniqueness and source membership are
validated independently of model availability.

The existing lexical path uses 2,000 candidates and a 200-result control depth.
The semantic path independently returns at most 100 parents. Pools 20, 50 and
100 are compared separately with equal-weight RRF, constant 60, truncated to
the named budget. The union may contain twice the budget; its hit rate is an
opportunity bound, compared with lexical top-2K, not a deployable equal-budget
quality score. Here K means the named pool size: lexical top-2K is depth
40, 100 or 200, not the first-stage 2,000-candidate search bound.

## Cache and Failure Behavior

Index identity binds the corpus, model manifest, tokenization/window policy and
worker source bytes. Embeddings and parent arrays use non-pickle NumPy storage,
SHA-256 checks and shape/norm validation.

Cold CPU indexing saves checksummed 128-document shards. Batches are sorted
by token length to reduce padding, then restored to the original window order
before parent aggregation. Only shards bound
to the exact source/index identity can resume; corrupted shards fail closed. Vectors and parent coverage are validated before
publication. Array files and their receipt are published atomically, with the
receipt last; an interrupted publication cannot be a cache hit.
An initial non-resumable 20-minute CPU attempt timed out. Its lexical-fallback
packet was retained. Before ELM scoring, the operational cold deadline became
60 minutes and indexing became resumable; ranking, model and quality gates
did not change. A second unsorted run was deliberately stopped for cache
hardening, retained as a fallback packet, and not reused by the v2 worker.
GPU acceleration was unavailable in the authorized sandbox.

The subprocess has no shell, an 8 MiB output bound and a fixed timeout.
Unavailable libraries/model files, timeout, malformed output or source-scope
violations produce a labeled lexical fallback. Fallback scores are not semantic
measurements. Only verified `semanticStatus=ok` results support comparisons.
There is no OS-enforced memory limit, shared service, per-tenant cache policy
or production admission control. Peak worker RSS is measured, not capped.

## Results

All runs below completed with `semanticStatus=ok`, identical final worker/model
fingerprints and zero discarded tokens. The 100-candidate comparison is:

| Dataset | Path | Hit@5 | nDCG@10 | Complete@5 |
| --- | --- | ---: | ---: | ---: |
| bright-robotics (101 answerable) | lexical | 0.207921 | 0.109251 | 0.207921 |
| bright-robotics (101 answerable) | dense | 0.247525 | 0.135366 | 0.247525 |
| bright-robotics (101 answerable) | fused | 0.287129 | 0.155102 | 0.287129 |
| elm-development (18 answerable) | lexical | 0.833333 | 0.583971 | 0.444444 |
| elm-development (18 answerable) | dense | 0.888889 | 0.664155 | 0.500000 |
| elm-development (18 answerable) | fused | 0.833333 | 0.574459 | 0.500000 |
| elm-heldout (18 answerable) | lexical | 0.833333 | 0.633721 | 0.500000 |
| elm-heldout (18 answerable) | dense | 0.944444 | 0.802237 | 0.722222 |
| elm-heldout (18 answerable) | fused | 0.888889 | 0.742621 | 0.611111 |
| northstar-regression (9 answerable) | lexical | 1.000000 | 1.000000 | 1.000000 |
| northstar-regression (9 answerable) | dense | 1.000000 | 1.000000 | 1.000000 |
| northstar-regression (9 answerable) | fused | 1.000000 | 1.000000 | 1.000000 |

The fixed-budget comparisons include every planned pool, not just the best one:

| Dataset | Pool | Lexical Hit@K | Fused Hit@K | Union opportunity | Lexical top-2K | New candidate queries | Fused nDCG@10 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| bright-robotics | 20 | 0.366337 | 0.415842 | 0.455446 | 0.475248 | 9 | 0.144383 |
| bright-robotics | 50 | 0.495050 | 0.485149 | 0.594059 | 0.574257 | 10 | 0.146349 |
| bright-robotics | 100 | 0.574257 | 0.613861 | 0.693069 | 0.663366 | 12 | 0.155102 |
| elm-development | 20 | 0.888889 | 1.000000 | 1.000000 | 0.888889 | 2 | 0.604526 |
| elm-development | 50 | 0.888889 | 1.000000 | 1.000000 | 0.944444 | 2 | 0.557735 |
| elm-development | 100 | 0.944444 | 1.000000 | 1.000000 | 1.000000 | 1 | 0.574459 |
| elm-heldout | 20 | 1.000000 | 1.000000 | 1.000000 | 1.000000 | 0 | 0.732433 |
| elm-heldout | 50 | 1.000000 | 1.000000 | 1.000000 | 1.000000 | 0 | 0.742621 |
| elm-heldout | 100 | 1.000000 | 1.000000 | 1.000000 | 1.000000 | 0 | 0.742621 |
| northstar-regression | 20 | 1.000000 | 1.000000 | 1.000000 | 1.000000 | 0 | 1.000000 |
| northstar-regression | 50 | 1.000000 | 1.000000 | 1.000000 | 1.000000 | 0 | 1.000000 |
| northstar-regression | 100 | 1.000000 | 1.000000 | 1.000000 | 1.000000 | 0 | 1.000000 |

At pool 100, BRIGHT fusion raises Hit@5 from 21/101 to 29/101 and candidate
Hit@100 from 58/101 to 62/101. The dense path recovers 12 queries missed by
lexical top-100; those are candidate-path recoveries, not 12 additional fused
successes. The 200-item union hits 70/101, versus lexical top-200's 67/101.
Mean top-100 Jaccard is 0.119692. The paired fused-minus-lexical nDCG interval
is [0.002490, 0.084314]. These exploratory intervals do not adjust for trying
multiple pools. Pool 50 loses candidate hit and recall even though top-five
ranking improves. A smaller pool is therefore not a uniformly equivalent
replacement. All pools use the same encoded corpus and query work.

ELM development complete@5 improves from 8/18 to 9/18, but table complete
coverage goes from 4/6 to 6/6 while negation/exception falls from 3/6 to 2/6.
Development multi-passage remains 1/6. Held-out complete@5 improves from
9/18 to 11/18; held-out negation stays 4/6, and multi-passage rises from 1/6
to 3/6. Dense-only held-out complete@5 is 13/18, but that is not a license
to select a new serving profile after seeing held-out results.

| Measurement | Cold wall seconds | Warm wall seconds | Warm query median/p95 ms | Cold/warm worker peak MiB |
| --- | ---: | ---: | ---: | ---: |
| BRIGHT robotics | 1003.112208 | 19.612054 | 45.231 / 411.845 | 1236.141 / 1180.312 |
| ELM development | 63.937317 | 12.431923 | 18.708 / 36.349 | 1029.609 / 453.703 |

Cold and warm ranking metrics match exactly on both datasets; ordered-result
identity was not checked. Wall time includes
worker startup, index work/loading and query scoring, not the outer runner's
lexical work and controller overhead. Query timing begins after model and index
readiness; startup alone is approximately 8-11 seconds. Warm receipts retain
the original build duration as history, not a claim of rebuilding the index.
BRIGHT encoded 69,918 windows from 6,801,685 input tokens; ELM encoded 3,597
windows from 288,032 input tokens. No tokens were silently dropped.
The machine was an Apple M1 Max, 10 cores, 32 GiB RAM, macOS ARM64, four Torch
CPU threads.

**Decision: retain lexical runtime and defer reranking/serving integration.**
The frozen BRIGHT recovery/ranking, ELM aggregate complete@5, latency and
memory gates pass. External human adjudication remains absent, and the
additional category-level adoption safeguard fails on development negation.
This is a promising independent candidate path, not a completed production
retrieval upgrade. Next work is human adjudication and targeted exception and
multi-passage analysis on new questions, then a separately reviewed bounded
reranker or guarded runtime proposal if that evidence justifies it.


## Metrics and Decision Rules

Hit@5/K means at least one labeled relevant record was found. Mean recall@K
counts all labeled relevant records. Recall and nDCG flatten group alternatives,
so each alternative counts as separately relevant; only complete-evidence@5
uses the intended OR-within-group and AND-across-groups semantics.
Binary nDCG@10 is not answer accuracy.

ELM complete-evidence@5 requires at least one alternative from every required
evidence group. BRIGHT has one relevant-document alternatives group per query;
its complete@5 is therefore equivalent to Hit@5 and is not full-answer proof.

The twelve ELM unanswerable questions are counted but excluded from positive
retrieval denominators. This experiment has no answer/refusal stage and does
not measure abstention correctness. Jaccard overlap, novel relevant occurrences,
newly recovered queries, top-five gains/losses and paired nDCG-delta intervals
are recorded. Bootstrap intervals use 2,000 samples with fixed seed 20260930;
small correlated single-manual samples remain limited evidence.

Advancement requires at least six new BRIGHT top-100 query recoveries, fused
nDCG@10 gain of 0.01, no ELM complete@5 regression, warm query p95 at most
1,500 ms and worker RSS at most 2,048 MiB. External human gold adjudication
is required before a strong domain-quality claim. Aggregate complete@5 alone can hide
category regressions, so category-level tradeoffs are also reported as an
additional conservative adoption safeguard, not a retroactive change to the
frozen aggregate gate. The frozen gates are not
loosened to match observed results. The old cross-encoder's passage truncation
and BRIGHT limits are unchanged; reranking is deferred unless candidate
recovery and domain safety justify a separate experiment.

## Reproduction

Use a clean, task-owned checkout and keep all optional environments/caches local.
Python 3.11 and `uv` are required for model scoring; ordinary application tests
and builds do not install Python libraries or download weights.

```bash
UV_CACHE_DIR=.local/uv-cache uv venv .local/semantic-venv --python 3.11
UV_CACHE_DIR=.local/uv-cache uv pip install \
  --python .local/semantic-venv/bin/python \
  -r scripts/benchmarks/semantic-requirements.lock.txt
.local/semantic-venv/bin/python scripts/benchmarks/prepare-semantic-model.py

UV_CACHE_DIR=.local/uv-cache uv run --no-project --with pyarrow==21.0.0 \
  python scripts/benchmarks/prepare-bright-robotics.py
npm run benchmark:semantic -- --dataset bright-robotics
```

The locked environment records the tested macOS ARM64 CPU build. Other
platform/build variants must be recorded and reviewed, not silently treated as
identical library versions. Inference is local/offline after preparation.

Prepare ELM5 locally, then reuse the existing OKF converter:

```bash
UV_CACHE_DIR=.local/uv-cache HF_HOME=.local/docling-cache \
  uv run --no-project --with docling==2.130.0 --with torch==2.8.0 \
  --with torchvision==0.23.0 python scripts/benchmarks/prepare-elmc5.py
node scripts/okf/convert-docling.mjs \
  --input-path .local/benchmarks/semantic/elm/elmc5.jsonl \
  --output-directory .local/okf/elmc5-full \
  --bundle-id elmc5-semantic-local --revision pdf-652d1612-docling-2130 \
  --document-ref elmc5 --source-ref source:elmc5-full \
  --source-title "ELM5 Employee Benefits" --owner "Local evaluator" \
  --version ELM55 --display-updated-at "March 2024" \
  --generated-at 2026-09-30T19:00:00Z
```

The converter rejects existing output unless explicitly overridden. Keep the bundle at
`.local/okf/elmc5-full`, with source `source:elmc5-full`. Before scoring,
supply the source-bound extraction review and exactly reviewed private gold
files at `.local/benchmarks/semantic/gold/elm-{development,heldout}.v1.json`.
The runner rejects missing, malformed, unbalanced or uncertain-table gold.
It deliberately does not invent labels. Docling's model snapshots are not fully
pinned by this preparer; the saved export hashes are the evaluated authority.
If regeneration changes those hashes, review the extraction and labels again
rather than carrying forward the recorded scores.

```bash
npm run benchmark:semantic -- --dataset elm-development
npm run benchmark:semantic -- --dataset elm-heldout
npm run benchmark:semantic -- --dataset northstar-regression
```

Archive each cold result before a warm rerun: each named report path is
overwritten by a new run. Detailed reports contain hashed query identifiers
and numeric evidence only; worker inputs contain source text and stay private.

## Validation

```bash
python3 scripts/benchmarks/test_semantic_worker.py
SEMANTIC_MODEL_TESTS=1 .local/semantic-venv/bin/python \
  scripts/benchmarks/test_semantic_worker.py
npm run check
npx tsc --noEmit --incremental false
npm run test:e2e
```

The optional model tests verify cold cache creation, shard continuation,
corruption rejection and restoration, invalid embedding rejection before
publication, interrupted receipt recovery and source isolation using synthetic
text. Test-created cache directories are removed by a scoped cleanup. Browser validation
must use the matching installed browser, an unused local port and a
task-owned production build or the specified hosted revision. Source scope,
strict schemas and human approval boundaries are never bypassed for benchmarks.

Validation on 2026-09-30:

- `npm run check`: passed lint, 91 tests across 12 files, OKF catalog validation
  and the Next.js production build.
- `npx tsc --noEmit --incremental false`: passed.
- Optional local-model Python tests: 10 passed, including cache continuation,
  corruption rejection and source isolation.
- Full BRIGHT, ELM development/held-out and Northstar runs: completed; BRIGHT
  and ELM development cold/warm ranking metrics matched.
- Two independent read-only source/report reviews completed; the cold/warm
  ordered-result overclaim was corrected. These are AI reviews, not human gold
  adjudication or a repository-wide security audit.
- Local CLI Playwright: environment-blocked. Chrome aborted before page assertions
  in the native isolation sandbox. A corrected task-local configuration lists
  all six desktop/mobile tests, but listing is not execution or a passing suite.
- [GitHub Linux CI](https://github.com/Futoro-Ai/smartfaqs-evidence-desk/actions/runs/36779902351)
  on implementation commit `a31b8d75cb674331830ba7004d3e5ddfdea4d793`:
  lint, 91 unit tests, production build and all six desktop/mobile Playwright
  tests passed. CI installed the matching Chromium and ran the existing suite;
  this closes the matching-browser execution gap for that implementation.
- Supported in-app browser smoke against this task's local production build:
  seven fixed WebMCP tools, lexical search with heading ancestry and canonical
  synthetic references, synthetic UI review/export controls, pending agent
  exports, and source switching that clears approval/packet state all worked.
  At 412-pixel width, body width was 412 pixels with no horizontal overflow.
  This synthetic smoke is not a substitute for the six-case CLI suite, response
  header assertions, human gold adjudication or deployment-head verification.

The temporary local server was stopped. The public hosted alias was opened for
viewing, not certified against this unmerged branch. Matching-browser CI proof
is distinct from hosted deployment validation, broader PR review and the blocked
domain-quality/runtime-adoption gates. Existing npm
advisories (two moderate, two high and one critical) were not remediated by this
offline task; no dependency-security-clean claim is made. No production
readiness or external human adjudication is claimed.
