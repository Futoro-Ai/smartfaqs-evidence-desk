# Claim and Evidence Assessment

## Purpose and Status

This optional Evidence Desk prototype asks JEV how each retrieved passage relates
to a claim. It does not generate an answer, establish truth, or approve an answer.
Search, bounded reads, and human review still work without a provider key.

The implementation uses pinned `jev-1.13.0` and rubric `claim-evidence.v1`.
Transport, source isolation, schema validation, failure handling, and UI behavior
are tested with fake responses. Semantic accuracy and probability calibration
have **not** been demonstrated by those tests. The included Northstar labels are
AI-reviewed provisional regression fixtures, not independent human gold labels.

## Human Workflow

1. Select one fictional source and search for the relevant evidence.
2. Enter one precise claim, including population, time, conditions, and units.
3. Inspect the returned text or table before using it.
4. Consent to external assessment only if you want this claim and the bounded
   source passages sent to TypeSafe. Consent alone cannot enable the backend.
5. Run assessment. Inspect all four signal columns rather than only support.
6. Open the original passages and record your corrections or reject an item.
7. Optionally use the diverse review set. It balances signal rankings, not truth,
   and may select irrelevant passages; inspect it before staging an answer.
8. Stage an answer with its source-scoped evidence and make the separate human
   approval decision. Neither JEV nor an agent tool can make that decision.
9. Download the assessment receipt and, separately, the answer evidence packet.

Changing source or the retrieved reference set clears assessment state. Responses
from an old source/request are ignored. Editing a claim clears its old judgment.
Only the current source's successful WebMCP assessment is reflected in the panel.
WebMCP start/completion events carry an immutable request identity. Superseded
requests are cancelled through browser/API/MCP/provider signals; cancellation
cannot undo already-billed usage and does not refund reservations.

## Input and Output

The fixed `assess_evidence_claim` tool and `POST /api/assessments` accept:

```json
{
  "sourceRef": "source:employee-handbook",
  "claim": "Full-time employees with 5-9 completed years receive 104 annual leave hours.",
  "evidenceRefs": ["chunk:leave-accrual-table", "chunk:leave-eligibility"],
  "allowExternalAssessment": true
}
```

The claim is 3-500 characters. One to twenty unique references must belong to
that source. Clients cannot supply raw evidence, credentials, a provider URL,
prompts, approval decisions, or additional fields. The server resolves text from
the compiled public catalog. The UI uses the current bounded search results;
the tool/API's twenty-item bound does not expand search's five-result maximum.

Each passage includes its public reference, revision-qualified concept path,
heading ancestry, text hash, supplied/original character counts, truncation flag,
and four independent probabilities:

```json
{
  "supports": 0.82,
  "contradicts": 0.06,
  "qualifies": 0.67,
  "needs_context": 0.31
}
```

These numbers are **illustrative**, not measured results. They do not sum to one.
A passage may support a narrower claim and qualify a broader one simultaneously.
Silence is not contradiction. `needs_context` means that definitions, table
headers, conditions, footnotes, or another passage may still be required.

Up to three apparent-disagreement pairs receive a separate `choice` assessment:
`direct_conflict`, `qualification`, `different_scope`, `different_time`, or
`unresolved`. These five probabilities sum to one. Pair selection is a bounded
heuristic comparing highest support with highest opposing scores; it is not an
exhaustive contradiction detector and has no calibrated conflict threshold.

All packets say `judgmentAuthority=model_advisory` and
`humanApprovalRequired=true`. Raw claim and passage bodies are absent from the
receipt; their hashes are present. Public concept references and labels remain
visible. Hashes/checksums provide identity/integrity, not signatures or proof that
the model or a human was correct.

## Backend Configuration

Copy `.env.example` to `.env.local` for local work. Never place the key in a
`NEXT_PUBLIC_` variable, a tool argument, Git, or a downloaded receipt.

| Variable | Default | Use |
| --- | --- | --- |
| `JEV_CLAIM_ASSESSMENT_ENABLED` | `false` | Set `true` only for an explicitly budgeted local/private pilot. |
| `JEV_API_KEY` | empty | Backend-only TypeSafe key. No outer quotes or whitespace in the actual value. |
| `JEV_ASSESSMENT_MAX_INPUT_TOKENS` | `64000` | Conservative per-assessment reservation ceiling; hard cap `256000`. |
| `JEV_ASSESSMENT_PROCESS_INPUT_TOKENS` | `256000` | Lifetime per-process reservation ceiling; hard cap `1000000`. |

Restart the server after changes. Development, CI, public demos, and normal
operation keep assessment default-off unless an operator deliberately enables a
private pilot. Setting a key by itself does not enable calls. Per-call consent is
also required. No live assessment budget is implied by running the test suite.

The provider path is fixed to `https://api.typesafe.ai/v1/systemone`. Only the
claim, bounded passage text, and fixed rubrics are sent; public reference keys,
gold labels, environment values, and workflow files are not sent. Each passage
is limited to 1800 characters including heading and table context. Character
truncation can lose rows or conditions and is explicitly reported, not repaired
by inventing missing context.

Requests have at most twenty questions and 45000 UTF-8 bytes per pack. Responses
are capped at 64000 bytes. Request timeout is ten seconds; total query timeout is
sixty seconds. There are no automatic retries. Four `noul` questions are asked
per passage; pair comparisons require another request when applicable.

Reservations use UTF-8 bytes plus overhead as a conservative input-token bound,
not a vendor tokenizer or a dollar-price guarantee. Failed requests retain their
reservation. One fresh assessment may run at a time, at most five per minute per
process. Complete results may be cached in memory for five minutes, at most 128
entries, keyed to exact claim, ordered evidence/text, source revision, model, and
rubric. Cache-hit receipts report zero new requests/tokens.

These controls are **not shared across replicas**. Do not enable the paid tool on
an unrestricted public deployment without authenticated authorization, shared
edge/rate controls, and a deployment-wide cost budget. Browser origin checks
alone are not authentication; non-browser MCP clients can omit `Origin`.

The assessment browser endpoint requires an exact canonical HTTP(S) `Origin`
with the incoming HTTP `Host` and request protocol. It rejects absent origins,
cross-site fetches, and path-bearing origins, and does not trust
`X-Forwarded-Host`. This supports local hostname rewriting without allowing
cross-origin browser use.

## Failure Behavior

Disabled, missing consent/key, busy, rate-limited, over-budget, timeout, invalid
provider output, or provider authentication failures return safe reasons. An
unavailable passage judgment is `null`, never a fabricated zero or success.
If any passage pack fails, all passage judgments are unavailable. If pair
comparison alone fails, valid passage judgments remain, but comparison and the
workspace are explicitly incomplete. Incomplete results are not cached.

## Inspectable ICM Handoffs

Every returned packet, including unavailable packets, has seven checksum-bound
JSON stage artifacts: contract, scope, retrieval identity, assessment, comparison,
pending human review, and receipt. The panel lets a person inspect them. These
are records of deterministic execution boundaries, not executable instructions.

Materialize a downloaded receipt into an ignored, private local folder:

```bash
node scripts/benchmarks/claim-assessment/workspace.mjs \
  --receipt /absolute/path/claim-assessment.json --out .local/claim-workspaces
node scripts/benchmarks/claim-assessment/workspace.mjs \
  --verify .local/claim-workspaces/claim-RETURNED_SUFFIX
```

The writer refuses symlink paths, checks stage checksums, creates a new directory
with private file permissions, and publishes `manifest.json` last. Manual labels
are kept in a separate `75-review-corrections.json`; answer approval stays pending.
Verification is read-only. `integrity=verified` is not provider authentication or
a signed attestation. The app itself has no durable database or receipt storage.

## Offline Evaluation

`scripts/benchmarks/claim-assessment/northstar-gold.v1.json` pins the actual public
catalog bytes and supplied passage hashes. Its numeric, units, negation,
qualification, temporal, multi-passage, and unanswerable cases are provisional
regression material. Preserve rationales; obtain independent human adjudication
before using them to claim accuracy. This set is not an untouched holdout.

`claim-predictions.v1` binds model, rubric hash, evaluator commit, corpus hash,
exact gold-file hash, claim hashes, supplied passage hashes, candidate references,
lexical selection, diverse selection, probabilities, timing, and usage. Save the
candidate pool to compare methods without repeating retrieval. Never copy gold
labels into provider input. Unavailable results use `probabilities:null`.

```bash
node scripts/benchmarks/claim-assessment/evaluate.mjs \
  --gold scripts/benchmarks/claim-assessment/northstar-gold.v1.json \
  --predictions .local/claim-predictions.json --threshold 0.5
```

`0.5` is an explicit example, **not a calibrated default**. Choose/freeze a
threshold on separate calibration data before held-out evaluation. The evaluator
reports per-signal precision/recall, judged-only F1, missing-judgment coverage,
positive-signal micro-recall (with numerator/denominator, not unique-passage
recovery or OR-group completeness), multiple/zero-positive rates, and required-passage
completeness. Each evidence group is OR; all groups are AND. It also reports
unlabeled predicted passages rather than silently treating them as negative.
Undefined metrics are `null`, not perfect scores; macro F1 averages only defined
signal F1 values and reports that denominator. Candidate completeness is distinct
from ranking/selection. Missing cases, first-stage misses, unassessed passages,
and assessment-unavailable judgments are counted separately. The latter can
include disabled, consent, budget, rate-limit, cancellation, or provider failures.

The evaluator verifies gold/catalog bytes, bundle revision, source membership,
and exact supplied text. Model, rubric, and evaluator commit identities remain
declared provenance, not authenticated claims. Changing `labelAuthority` alone
does not verify independent adjudication; reports retain provisional status.

SciFact can supply independently defined scientific stance/rationale tasks, but
its labels do not directly specify these four independent signals. BEIR SciFact
queries overlap SciFact development claims, so they are not independent validation.
BRIGHT is a reasoning-intensive retrieval benchmark, not contradiction gold.
Existing retrieval scores do not establish claim-assessment performance. No new
leaderboard result or live semantic assessment score is claimed by this feature.

## Completion and Follow-Up

Implemented: strict source-scoped API/tool, bounded provider adapter, independent
signals, pair comparisons, human correction UI, unchanged answer-approval
boundary, inspectable receipts, private materialization, offline evaluator,
provisional fixtures, and fake-backed integration tests. Browser test cases are
included, but their standalone Chrome launch is blocked in the task sandbox;
they have not passed here. Local side-browser interaction checks are separate
from that automated browser-suite gate.

Before paid/public rollout: independently adjudicate labels, authorize a small
live pilot and budget, measure semantic quality/calibration/latency, test unseen
claims and truncated tables, resolve dependency advisories, add shared controls,
and perform deployment-specific security review. No database, private document
ingestion, global agent configuration, or larger retrieval rewrite is required.

### Local Validation Snapshot: 2026-10-03

- Lint, 112 offline unit/integration tests, OKF consistency, TypeScript, and the
  production build passed. Tests include malformed replacements, caller-input
  mutation, and concurrent duplicate success/failure preserving human corrections.
- The local side browser verified default-off null judgments, human corrections,
  inspectable handoffs, WebMCP-to-panel updates, and source-switch clearing.
  The layouts had no horizontal overflow at 1440px and 390px.
- The standalone Playwright suite remains blocked at browser launch in the task
  sandbox. A matching, task-local Playwright Chromium installation also failed
  before application assertions: macOS denied Mach-port bootstrap registration.
  The attempt stopped at the first failure; twelve tests did not run and another
  worker was interrupted. Its failure reports are preserved separately.
  The side-browser checks do not certify the full fake-response browser suite.
- The existing GitHub Actions workflow installs managed Chromium and runs
  `npm run test:e2e`. Run it on the published feature head; no passing CI result
  for this feature is claimed. System Chrome, personal browser profiles, and
  global browser configuration were not changed.
- No live JEV assessment, calibrated semantic score, public deployment, or
  independent human adjudication is claimed by this snapshot.
