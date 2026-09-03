# Retrieval Benchmarks

## SciFact First Benchmark

Evidence Desk includes a local-only adapter for the public SciFact dataset. It
measures whether the production lexical ranker retrieves a labeled evidence
sentence, its source document, and its heading section. The benchmark does not
invoke an LLM, generate an answer, modify the public knowledge bundle, or add a
database.

The first implementation uses SciFact's labeled development claims because its
public test claims do not include evidence labels. This produces a reproducible
SciFact development benchmark, but it is not directly comparable to the BEIR
SciFact leaderboard, which uses a separate corpus/query/qrels packaging and
document-level evaluation.

## Data Model

The adapter creates an in-memory catalog using the same types and ranker as the
application:

| SciFact record | Evidence Desk representation |
| --- | --- |
| Complete dataset | One bounded `source:scifact` evaluation scope |
| Paper title | First-class explicit heading section |
| Abstract sentence | Text evidence chunk beneath that heading |
| Development claim | Search query |
| Labeled rationale sentence | Relevant evidence reference |
| Evidence document | Relevant section/document reference |

No benchmark content is added to `knowledge/northstar` or the deployed runtime
catalog. The downloaded files and all result reports stay below
`.local/benchmarks/scifact`, which Git ignores.

## Prepare The Dataset

The preparation command downloads SciFact from the fixed URL used by the
official project, validates archive paths before extraction, enforces a 128 MiB
archive limit, verifies pinned archive and evaluated-file SHA-256 fingerprints,
records a download receipt, and refuses to replace an incomplete existing
dataset directory. An upstream byte change requires an explicit adapter and
baseline review.

```bash
npm run benchmark:scifact:prepare
```

Preparation requires network access and the system `tar` command. Normal
application builds and tests never download benchmark data.

## Run The Benchmark

Run the deterministic first-50-query smoke selection:

```bash
npm run benchmark:scifact:smoke
```

Run every labeled development query that has at least one evidence rationale:

```bash
npm run benchmark:scifact
```

The smoke selection sorts query identifiers numerically and takes the first 50,
so repeated runs use the same claims. Use it for development feedback; use the
full run for a reported baseline.

Reports are written to:

```text
.local/benchmarks/scifact/results/scifact-first-50.json
.local/benchmarks/scifact/results/scifact-full.json
```

Pass `--no-save` to print aggregate results without writing a report:

```bash
npm run benchmark:scifact -- --no-save
```

Reports contain aggregate metrics, input fingerprints, query identifiers, and
per-query counts/scores. They do not contain claim text, abstract text, or
retrieved evidence text.

## Metrics

The application returns at most five evidence results and three navigation
sections, so the benchmark uses the same bounds.

| Metric group | Meaning | Cutoffs |
| --- | --- | --- |
| `evidence` | Exact labeled rationale sentence retrieval | 1, 3, 5 |
| `documentsFromEvidence` | Relevant paper represented among retrieved evidence | 1, 3, 5 |
| `sectionNavigation` | Relevant paper-title heading found by section routing | 1, 3 |

Each group reports:

- `hitRate`: fraction of queries with at least one relevant result;
- `meanRecall`: mean fraction of all relevant references retrieved;
- `mrr`: mean reciprocal rank of the first relevant result;
- `ndcg`: binary normalized discounted cumulative gain.

## Structural Ablation

Every run evaluates two modes:

- `productionWithAncestry` uses the production heading-ancestry boost;
- `ablationWithoutAncestry` uses the same scorer with only that boost disabled.

The comparison isolates the effect of title/heading context without changing
tokenization, source scope, result bounds, or tie ordering. SciFact has one
title heading per paper, so this tests shallow structural context. The local ELM
evaluation remains necessary for multi-level headings, heading-only leaves,
tables, and document-specific section navigation.

The first full run establishes a baseline rather than a release threshold. Set
acceptance thresholds only after preserving that report and reviewing common
failure classes. Do not tune against the 50-query smoke selection and then
present it as held-out performance.

## Recorded Baseline

The first complete run evaluated 188 labeled development claims against 5,183
papers represented as 45,952 sentence chunks. The fingerprint-bound aggregate
result is committed as
[`benchmarks/scifact-development-baseline.v1.json`](../benchmarks/scifact-development-baseline.v1.json).

| Mode | Evidence Hit@1 | Evidence Hit@5 | Document Hit@1 | Document Hit@5 | Section Hit@3 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Production with ancestry | 21.81% | 41.49% | 43.09% | 51.60% | 42.02% |
| Without ancestry boost | 30.85% | 55.32% | 54.79% | 67.02% | 42.02% |

On this shallow-title corpus, the current ancestry boost overweights title
matches and lowers evidence retrieval quality. That result is a calibration
finding, not evidence that document structure is generally harmful. The
section-navigation score is unchanged because the ablation alters evidence
ancestry scoring only. Before changing production ranking, inspect failure
classes and repeat the comparison on the multi-level ELM corpus.

## Dataset Rights And Attribution

SciFact is maintained by the Allen Institute for AI. Its repository states:

- claims and evidence annotations are CC BY 4.0;
- abstracts are from S2ORC and are ODC-By 1.0;
- SciFact code is Apache-2.0.

Evidence Desk does not redistribute the dataset. Anyone running the optional
benchmark remains responsible for complying with the upstream terms and citing
the dataset authors.

Sources:

- [SciFact repository](https://github.com/allenai/scifact)
- [SciFact license](https://github.com/allenai/scifact/blob/master/LICENSE.md)
- [SciFact data format](https://github.com/allenai/scifact/blob/master/doc/data.md)
- [BEIR benchmark](https://github.com/beir-cellar/beir)

## Current Limitations

- The ranker is lexical and uses no BM25, embeddings, reranker, or LLM.
- SciFact does not test tables or multi-level document hierarchies.
- Exact sentence recall is stricter than retrieving a larger paragraph that
  contains the same rationale.
- This benchmark measures retrieval only, not claim verification or answer
  correctness.
- The source download URL is an upstream `latest` artifact, so the preparer
  pins the exact archive and evaluated-file fingerprints used for this
  baseline. A changed upstream artifact fails closed pending review.
