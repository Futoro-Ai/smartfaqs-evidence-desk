# Retrieval Benchmarks

Evidence Desk has two local-only retrieval evaluators:

1. SciFact measures first-stage recall on a public scientific claim corpus.
2. The generic OKF evaluator measures a chosen local bundle, including nested
   headings and tables, against an explicitly reviewed gold set.

Neither evaluator invokes an LLM, generates an answer, modifies a knowledge
bundle, or adds a database. Dataset files, detailed reports, ICM run artifacts,
and private gold sets remain under `.local/`, which Git ignores.

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
The current fingerprint-bound aggregate is
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
