# Retrieval Benchmarks

Evidence Desk has two core local-only retrieval evaluators, plus the BEIR
SciFact and BRIGHT robotics adapters:

1. SciFact measures first-stage recall on a public scientific claim corpus.
2. The generic OKF evaluator measures a chosen local bundle, including nested
   headings and tables, against an explicitly reviewed gold set.

These evaluators do not invoke an LLM, generate an answer, modify a knowledge
bundle, or add a database. Dataset files, detailed reports, ICM run artifacts,
and private gold sets remain under `.local/`, which Git ignores.

The separate BEIR SciFact adapter uses the same index and scorer to evaluate
the official document-level test split. Prepare and run it with:

```bash
npm run benchmark:beir-scifact:prepare
npm run benchmark:beir-scifact
```

It represents each scientific abstract as one evidence chunk and reports binary
document nDCG@10. The pinned BEIR SciFact test queries overlap the SciFact
development claims used below. Its document-level judgments differ from the
development set's rationale-sentence labels, but its score is not independent
validation of a title weight selected on those claims. The dataset stays in
`.local/` and the report records input SHA-256 fingerprints.

The preparer verifies pinned SHA-256 values for the extracted files on both
first download and reuse. Reports also fingerprint the ranking, evaluator,
adapter, and runner source files, so results from a dirty checkout remain
distinguishable from results at a clean commit.

A committed ten-query synthetic handbook set exercises text, tables, nested
sections, and two questions that require both passages. Run it with
`npm run benchmark:northstar`. The fixed gold labels are in
`scripts/benchmarks/northstar-structured-gold.v1.json`; this is a small
development test for Evidence Desk behavior, not an external leaderboard score.

The BRIGHT robotics short-document split tests reasoning-heavy retrieval over
the complete robotics corpus. Prepare the pinned dataset locally with Python,
`uv`, and `pyarrow`:

```bash
UV_CACHE_DIR=.local/benchmarks/uv-cache uv run --no-project --with pyarrow==21.0.0 \
  python scripts/benchmarks/prepare-bright-robotics.py
npm run benchmark:bright:robotics
```

This reports content-only robotics nDCG@10. Document IDs are retained for
judgments but are not indexed as titles or retrieval text. The result is not
BRIGHT's 12-dataset leaderboard average. The preparation script verifies both
original Parquet SHA-256 values and stores its converted JSONL files under
`.local/`.

On reuse, the preparer checks the converted JSONL files against its receipt
and confirms that the receipt names the pinned revision and source hashes.

The evaluated inputs are content-bound as follows:

- SciFact uses the upstream `latest` archive only when its SHA-256 is
  `11c621288d41ac144d29b13b0f8503b3820b7d6e8b1f6ff24dff335c196d76be`.
  The corpus and development-claims SHA-256 values are in
  `benchmarks/scifact-bm25f-baseline.v2.json`.
- BEIR SciFact uses the archive with MD5
  `5f7d1de60b170fc8027bb7898e2efca1`; its preparation receipt records
  SHA-256 values for the archive and extracted files.
- BRIGHT robotics uses dataset revision
  `3066d29c9651a576c8aba4832d249807b181ecae`; the preparation script
  pins the Parquet file sizes and SHA-256 values.

## Baseline Before Ranking Changes

The SciFact BM25F baseline artifact records `2026-09-04`. This table combines
that unchanged baseline with local BEIR, BRIGHT, and Northstar checks. The
original later-check reports were not retained with implementation fingerprints,
so their exact chronology and code revisions cannot be reconstructed. The
SciFact and BEIR values have since been reproduced on the pinned datasets.
BRIGHT was also rerun with the corrected pre-cutoff exclusion handling; its
aggregate nDCG@10 was unchanged:

| Evaluation | Scope | Existing result |
| --- | --- | ---: |
| SciFact labeled development | 188 claims, sentence-rationale Evidence Hit@5 | 0.696809 |
| BEIR SciFact official test | 300 queries, document nDCG@10 | 0.669547 |
| BRIGHT robotics | 101 queries, content-only document nDCG@10 | 0.109251 |
| Northstar synthetic handbook | 10 authored queries, Evidence Hit@5 | 1.000000 |

The corresponding body-only scores are 0.574468 Hit@5 and 0.662722 nDCG@10
for SciFact and BEIR SciFact; BRIGHT already uses content only. The
Northstar set is a local regression check, not an independent test set. Its
hierarchy-enabled profile has identical ranked top-five lists on eight of ten
questions and the same top-five sets on all ten, but lowers first-result rank
on one eligibility question. No result
above is a leaderboard submission or an end-to-end answer-quality score.
Dataset fingerprints and per-query results stay in the ignored `.local/`
reports produced by the commands above.

## First Measured Increment

The SciFact development-set title-weight ablation tried increasing BM25F
title weight from `0.35` to `0.5`. With that change, rationale Hit@5 is
`0.707447` (+0.010638) and BEIR SciFact test document nDCG@10 is
`0.672673` (+0.003126). Title weighting does not apply to the content-only
BRIGHT robotics corpus.
The Northstar ten-query result above is from the current hint-enabled bundle;
it is not an isolated measurement of the title-weight change. The experiment used SciFact
development claims to choose a weight; the overlapping BEIR SciFact test
queries cannot establish an independent gain. BRIGHT is a different,
content-only regression check, not a tuning target or leaderboard submission.

This is not an across-the-board gain. Binary SciFact rationale Hit@100 falls from
`0.925532` (174/188 claims) to `0.914894` (172/188). The new weights gain one
top-100 hit and lose three, while gaining two top-five hits and losing none.
A paired offline reciprocal-rank fusion was also explored, but the ranked-list
inputs and runner were not retained. Its historical numbers are not a
reproducible regression baseline. Neither the new weight nor that fusion is a
demonstrated solution to candidate recall. The runtime therefore keeps the
`0.35` title weight; `0.5` remains an optional benchmark profile.

Replay the fixed-weight comparison with the same pinned inputs:

```bash
npm run benchmark:scifact -- --title-weight 0.5
npm run benchmark:beir-scifact -- --title-weight 0.5
```

Omit the option for the `0.35` baseline. Each profile writes a separate ignored
report; only the two fixed weights are accepted. These are local retrieval
measurements, not independent leaderboard submissions.

The optional, reviewed `smartfaqs.answer_questions` hint on one synthetic
handbook chunk moves a separate paraphrase probe from rank 3 to rank 1.
That single local probe is not a generalization result. Official benchmark
corpora have no such hints, so their scores above measure only the weight
change. BRIGHT's low absolute score still points to a need for a stronger
first-stage semantic candidate path rather than more lexical-weight tuning.

The next reranker experiment is separate from this PR's runtime behavior.
Compare fixed first-stage candidate pools of 20, 50, and 100 on the pinned
SciFact and BEIR inputs and an independently reviewed ELM set. Record candidate
recall before reranking, final ranking quality, latency, memory, and text
truncation for every pool. Keep the model and revision pinned, candidates
source-scoped, and the feature default-off with a timeout and lexical fallback.
Do not use the overlapping BEIR SciFact queries as an untouched validation set
or promote a reranker on aggregate scores alone.

## Retrieval Profiles

The SciFact evaluator compares three deterministic profiles over the same
source-scoped index:

| Profile | Purpose |
| --- | --- |
| `lexicalBodyOnly` | BM25 over evidence body text only. |
| `fieldedWithoutHierarchy` | BM25F over body, title, keywords, local heading, aliases, section identifiers, and table fields. |
| `fieldedWithHierarchy` | The same BM25F profile plus a bounded descendant boost for matched nested sections. |

Nested routing is intentionally inactive for depth-one headings. This prevents
a broad document title from boosting every sentence in a flat corpus. A
heading remains navigation metadata, not factual evidence; only evidence chunks
appear in the evidence result list.

## SciFact Data Model

The adapter creates an in-memory catalog using the same types, tokenizer,
index, and ranker as the application:

| SciFact record | Evidence Desk representation |
| --- | --- |
| Complete dataset | One bounded `source:scifact` evaluation scope |
| Paper title | First-class explicit heading section |
| Abstract sentence | Text evidence chunk beneath that heading |
| Development claim | Search query |
| Labeled rationale sentence | Relevant evidence reference |
| Evidence document | Relevant section/document reference |

SciFact's public test claims do not include evidence labels, so this harness
uses its labeled development claims. The result is reproducible but is not
directly comparable to the BEIR SciFact leaderboard, which uses a different
query/qrels packaging and document-level evaluation.

## Prepare SciFact

```bash
npm run benchmark:scifact:prepare
```

The command downloads the fixed upstream artifact, rejects unsafe archive
paths, enforces a 128 MiB archive limit, verifies pinned archive and evaluated
file SHA-256 fingerprints, and refuses to replace an incomplete existing data
directory. Normal builds and tests never download benchmark data.

## Run SciFact

Run the deterministic first-50-query development check:

```bash
npm run benchmark:scifact:smoke
```

Run all 188 labeled development queries:

```bash
npm run benchmark:scifact
```

Pass `--no-save` to print aggregate results without writing local artifacts:

```bash
npm run benchmark:scifact -- --no-save
```

Saved reports and ICM-style run artifacts appear at:

```text
.local/benchmarks/scifact/results/scifact-full.json
.local/benchmarks/scifact/workspaces/scifact-full/
  00-contract/contract.json
  30-retrieve/queries.jsonl
  40-rank/queries.jsonl
  50-verify/queries.jsonl
  80-export/report.json
```

The staged workspace records query IDs, candidate counts, ranks, metrics, and
failure classes. It excludes claim text, abstract text, and evidence text.

## Metrics And Failure Classes

The public application still returns at most five evidence results and three
navigation sections. The benchmark additionally examines evidence ranking
through 100 to distinguish ranking failures from lexical misses.

| Metric group | Cutoffs |
| --- | --- |
| Exact rationale-sentence evidence | 1, 3, 5, 10, 20, 50, 100 |
| Relevant documents represented by evidence | 1, 3, 5, 10, 20, 50, 100 |
| Section navigation | 1, 3, 5, 10 |

Each group reports hit rate, mean recall, mean reciprocal rank, and binary
normalized discounted cumulative gain. Query diagnostics classify misses as:

- `success_within_visible_limit`: relevant evidence is in the first five;
- `relevant_below_visible_limit`: relevant evidence ranks 6 through 100;
- `relevant_below_analysis_limit`: relevant evidence has a positive lexical
  match but ranks below 100;
- `no_positive_lexical_match`: none of the gold evidence shares an indexed
  normalized term with the query.

The report also records median and p95 query time, positive-candidate volume,
and top-five overlap/complementarity between the two fielded profiles. Timing is
environment-specific and is not part of the committed regression baseline.

## Recorded Results

The original substring-score baseline remains in
[`scifact-development-baseline.v1.json`](../benchmarks/scifact-development-baseline.v1.json).
The pinned pre-increment fingerprint-bound aggregate is
[`scifact-bm25f-baseline.v2.json`](../benchmarks/scifact-bm25f-baseline.v2.json).

| Retrieval | Evidence Hit@1 | Evidence Hit@5 | Evidence Hit@100 | Document Hit@5 |
| --- | ---: | ---: | ---: | ---: |
| Original substring scorer, no ancestry | 30.85% | 55.32% | not recorded | 67.02% |
| Body-only BM25 | 37.77% | 57.45% | 86.70% | 75.53% |
| Fielded BM25 | 44.68% | 69.68% | 92.55% | 84.04% |

Fielded BM25 improves Hit@5 by 14.36 percentage points over the strongest
original baseline. Of 188 queries, 131 succeed within five, 43 first succeed
between ranks 6 and 100, 12 have a positive relevant match below rank 100, and
2 have no positive lexical match. This means ranking and query expansion are
still useful future work, but dense retrieval is not required to deliver the
first substantial recall gain.

SciFact has only one heading level. The nested hierarchy stream is therefore
inactive by design and produces the same top-five lists as fielded BM25. That
is an honest limitation, not evidence that hierarchy is irrelevant.

## Evaluate A Local OKF Bundle

Create a local JSON gold file with this strict shape:

```json
{
  "schemaVersion": "smartfaqs-okf-retrieval-gold.v1",
  "sourceRef": "source:local-document",
  "queries": [
    {
      "id": "reviewed-case-1",
      "query": "A reviewed question",
      "relevantChunkRefs": ["chunk:reviewed-evidence"],
      "relevantSectionRefs": ["section:reviewed-section"]
    }
  ]
}
```

Keep private gold files and converted bundles beneath `.local/`. Run:

```bash
npm run benchmark:okf -- \
  --bundle-path .local/okf/local-document \
  --gold-path .local/benchmarks/okf/local-document-gold.json
```

The evaluator validates every gold reference against the selected source,
fails on duplicate query IDs or extra fields, compares fielded BM25 with and
without nested routing, and writes only a sanitized local report. It does not
copy local source content into the repository or public catalog.

The current ignored ten-query ELM development set covers text, tables, section
numbers, and heading-only parent routes. It achieved 100% Evidence Hit@5 and
100% mean Evidence Recall@5 in both modes. Nested routing improved MRR from
0.691667 to 0.741667. The two modes returned the same top-five candidate sets,
but hierarchy changed their order on 6 of 10 queries. In this set, structure
improves prioritization rather than adding otherwise missing evidence. This is
a small development check, not a public benchmark or a held-out quality claim.

A separate, ignored local ELM review corrected two table-evidence references
in the 40-question gold file. The review receipt records two reviewers and
`humanValidated=false`; it does not establish human validation. The reviewed
gold file is `elmc6-40-gold.reviewed.v1.json` (SHA-256
`41ff641a44274b868410a84a6e49aed38d10f269a4a2611b5d4336397c33c9cd`).
The 12-paraphrase and 24-question files are also local development sets after
their recorded runs, not untouched holdouts. Their gold-file SHA-256 values are
`f7495229e6bd959094df42d5c4620727368fb856e63639746b88b7cfb34cc4a4`
and `4b6f98bf07a9e384f4bba131b764ed0a0b33d11e5b949ba4c8ffd12e046d957c`,
respectively. These identifiers support local reproduction without publishing
private source text or gold labels.

## Rights And Attribution

SciFact is maintained by the Allen Institute for AI. Its repository states
that claims and evidence annotations are CC BY 4.0, abstracts are from S2ORC
under ODC-By 1.0, and code is Apache-2.0. Evidence Desk does not redistribute
the dataset.

- [SciFact repository](https://github.com/allenai/scifact)
- [SciFact license](https://github.com/allenai/scifact/blob/master/LICENSE.md)
- [SciFact data format](https://github.com/allenai/scifact/blob/master/doc/data.md)
- [BEIR benchmark](https://github.com/beir-cellar/beir)

## Remaining Limits

- Retrieval is lexical BM25F; there is no embedding model or learned reranker.
- SciFact does not test tables or multi-level hierarchy.
- The local ELM set is small, private, and development-selected.
- Exact sentence recall is stricter than retrieval of a larger paragraph that
  contains the same rationale.
- Retrieval evaluation does not measure claim verification or final answer
  correctness.
- The SciFact download URL is an upstream `latest` artifact, so any byte change
  fails closed pending fingerprint and adapter review.
