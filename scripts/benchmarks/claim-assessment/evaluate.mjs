import { createHash } from "node:crypto";
import { readFile, lstat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const signals = ["supports", "contradicts", "qualifies", "needs_context"];
const hash = (s) => createHash("sha256").update(s).digest("hex");
const probability = z.number().finite().min(0).max(1);
const judgments = z.object(Object.fromEntries(signals.map((s) => [s, probability]))).strict();
const truth = z.object(Object.fromEntries(signals.map((s) => [s, z.boolean()]))).strict();
export const goldSchema = z.object({ schemaVersion: z.literal("claim-gold.v1"),
  corpusSha256: z.string().regex(/^[a-f0-9]{64}$/), sourceRevision: z.string().min(1).max(100),
  labelAuthority: z.enum(["ai_review_provisional", "independently_human_adjudicated"]),
  split: z.enum(["development", "calibration", "heldout", "regression"]),
  cases: z.array(z.object({ id: z.string().min(1).max(80), sourceRef: z.string().max(256),
    claim: z.string().min(3).max(500), category: z.string().max(80),
    passages: z.array(z.object({ chunkRef: z.string().max(256), textHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      labels: truth, rationale: z.string().min(1).max(600) }).strict()).min(1).max(20),
    evidenceGroups: z.array(z.array(z.string().max(256)).min(1).max(20)).max(20),
  }).strict()).min(1).max(1000) }).strict();
export const predictionsSchema = z.object({ schemaVersion: z.literal("claim-predictions.v1"),
  model: z.string().min(1).max(80), rubricHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  evaluatorRevision: z.string().regex(/^[a-f0-9]{40}$/), goldSha256: z.string().regex(/^[a-f0-9]{64}$/),
  corpusSha256: z.string().regex(/^[a-f0-9]{64}$/),
  cases: z.array(z.object({ id: z.string(), sourceRef: z.string(), claimHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    candidateRefs: z.array(z.string()).max(100), lexicalSelectedRefs: z.array(z.string()).max(20),
    selectedRefs: z.array(z.string()).max(20),
    passages: z.array(z.object({ chunkRef: z.string(), textHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      probabilities: judgments.nullable() }).strict()).max(20),
    elapsedMs: z.number().finite().nonnegative(), inputTokens: z.number().int().nonnegative(),
  }).strict()).max(1000) }).strict();

export function evaluateClaims(goldValue, predictionValue, { threshold, goldSha256, catalogText } = {}) {
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold >= 1) throw new Error("explicit_threshold_required");
  if (!/^[a-f0-9]{64}$/.test(goldSha256 ?? "") || typeof catalogText !== "string") throw new Error("expected_identities_required");
  const gold = goldSchema.parse(goldValue), predictions = predictionsSchema.parse(predictionValue);
  const catalog = JSON.parse(catalogText);
  if (predictions.corpusSha256 !== gold.corpusSha256 || hash(catalogText) !== gold.corpusSha256 ||
      catalog.revision !== gold.sourceRevision) throw new Error("corpus_identity_mismatch");
  if (predictions.goldSha256 !== goldSha256) throw new Error("gold_identity_mismatch");
  const scoped = (sourceRef, chunkRef) => catalog.chunks.find((c) => c.sourceRef === sourceRef && c.ref === chunkRef);
  const passageHash = (chunk) => "sha256:" + hash([chunk.sectionPath.join(" > "), chunk.content,
    ...(chunk.table ? [chunk.table.headers.join(" | "), ...chunk.table.rows.map((r) => r.join(" | "))] : [])].join("\n").slice(0, 1800));
  const unique = (values) => new Set(values).size === values.length;
  if (!unique(gold.cases.map((c) => c.id)) || !unique(predictions.cases.map((c) => c.id))) throw new Error("duplicate_case_id");
  const byId = new Map(predictions.cases.map((c) => [c.id, c]));
  if (predictions.cases.some((p) => !gold.cases.some((g) => g.id === p.id))) throw new Error("unknown_prediction_case");
  const counts = Object.fromEntries(signals.map((s) => [s, { tp: 0, fp: 0, fn: 0, tn: 0, missedPositive: 0 }]));
  let total = 0, judged = 0, exact = 0, zero = 0, multiple = 0, positiveTotal = 0, positiveRecovered = 0;
  let answerable = 0, candidateComplete = 0, selectedComplete = 0, lexicalComplete = 0;
  let latency = 0, tokens = 0, unlabeledPredictedPassages = 0;
  const errors = [];
  const unavailableCounts = { missing_case: 0, not_in_candidate_pool: 0, not_assessed: 0, assessment_unavailable: 0 };
  for (const g of gold.cases) {
    if (!unique(g.passages.map((p) => p.chunkRef))) throw new Error("duplicate_gold_passage");
    if (g.passages.some((p) => !scoped(g.sourceRef, p.chunkRef) || passageHash(scoped(g.sourceRef, p.chunkRef)) !== p.textHash) ||
        g.evidenceGroups.some((group) => !unique(group) || group.some((ref) => !g.passages.some((p) => p.chunkRef === ref)))) {
      throw new Error("gold_scope_or_passage_mismatch");
    }
    const p = byId.get(g.id);
    if (p && (p.sourceRef !== g.sourceRef || p.claimHash !== "sha256:" + hash(g.claim.trim()) ||
        !unique(p.passages.map((x) => x.chunkRef)) || !unique(p.candidateRefs) ||
        !unique(p.selectedRefs) || !unique(p.lexicalSelectedRefs) || p.candidateRefs.some((ref) => !scoped(g.sourceRef, ref)) ||
        [...p.selectedRefs, ...p.lexicalSelectedRefs, ...p.passages.map((x) => x.chunkRef)].some((ref) => !p.candidateRefs.includes(ref)))) {
      throw new Error("prediction_scope_or_claim_mismatch");
    }
    if (g.evidenceGroups.length) {
      answerable++;
      const complete = (refs) => g.evidenceGroups.every((group) => group.some((ref) => refs.includes(ref)));
      if (complete(p?.candidateRefs ?? [])) candidateComplete++;
      if (complete(p?.selectedRefs ?? [])) selectedComplete++;
      if (complete(p?.lexicalSelectedRefs ?? [])) lexicalComplete++;
    }
    if (p) {
      latency += p.elapsedMs; tokens += p.inputTokens;
      unlabeledPredictedPassages += p.passages.filter((passage) => !g.passages.some((x) => x.chunkRef === passage.chunkRef)).length;
    }
    for (const passage of g.passages) {
      total++;
      const observation = p?.passages.find((x) => x.chunkRef === passage.chunkRef);
      if (observation && observation.textHash !== passage.textHash) throw new Error("passage_identity_mismatch");
      const probabilities = observation?.probabilities;
      if (!probabilities) {
        for (const s of signals) if (passage.labels[s]) { positiveTotal++; counts[s].missedPositive++; }
        const reason = !p ? "missing_case" : !p.candidateRefs.includes(passage.chunkRef) ? "not_in_candidate_pool" :
          !observation ? "not_assessed" : "assessment_unavailable";
        unavailableCounts[reason]++;
        errors.push({ caseId: g.id, chunkRef: passage.chunkRef, reason }); continue;
      }
      judged++;
      const positive = signals.filter((s) => probabilities[s] >= threshold);
      if (!positive.length) zero++;
      if (positive.length > 1) multiple++;
      let correct = true;
      for (const s of signals) {
        const predicted = probabilities[s] >= threshold, actual = passage.labels[s];
        counts[s][actual ? predicted ? "tp" : "fn" : predicted ? "fp" : "tn"]++;
        if (actual) { positiveTotal++; if (predicted) positiveRecovered++; }
        if (predicted !== actual) { correct = false; errors.push({ caseId: g.id, chunkRef: passage.chunkRef, signal: s, predicted, actual }); }
      }
      if (correct) exact++;
    }
  }
  const ratio = (a, b) => b ? a / b : null;
  const metrics = Object.fromEntries(signals.map((s) => { const c = counts[s];
    return [s, { ...c, precision: ratio(c.tp, c.tp + c.fp), recallOnJudged: ratio(c.tp, c.tp + c.fn),
      positivePassageRecallIncludingMissing: ratio(c.tp, c.tp + c.fn + c.missedPositive),
      f1OnJudged: ratio(2 * c.tp, 2 * c.tp + c.fp + c.fn) }]; }));
  const f1 = Object.values(metrics).map((m) => m.f1OnJudged).filter((v) => v !== null);
  return { schemaVersion: "claim-evaluation.v1", labelAuthority: gold.labelAuthority, split: gold.split,
    interpretation: "provisional_regression_only", independentAdjudicationVerified: false,
    modelIdentityVerified: false, evaluatorRevisionVerified: false, rubricIdentityVerified: false,
    semanticCalibrationDemonstrated: false, threshold, model: predictions.model, rubricHash: predictions.rubricHash,
    evaluatorRevision: predictions.evaluatorRevision, sourceRevision: gold.sourceRevision,
    corpusSha256: predictions.corpusSha256, goldSha256: predictions.goldSha256,
    caseCount: gold.cases.length, totalPassages: total, judgedPassages: judged, unlabeledPredictedPassages, coverage: ratio(judged, total),
    exactMultilabelAccuracyOnJudged: ratio(exact, judged), macroF1OnJudged: f1.length ? f1.reduce((a, b) => a + b, 0) / f1.length : null,
    zeroPositiveRate: ratio(zero, judged), multiplePositiveRate: ratio(multiple, judged),
    macroF1ContributingSignals: f1.length, unavailableCounts,
    positiveSignalRecovered: positiveRecovered, positiveSignalTotal: positiveTotal,
    positiveSignalRecovery: ratio(positiveRecovered, positiveTotal), perSignal: metrics,
    answerableCases: answerable, candidateCompleteness: ratio(candidateComplete, answerable),
    lexicalCompleteness: ratio(lexicalComplete, answerable), diverseSelectionCompleteness: ratio(selectedComplete, answerable),
    meanElapsedMs: ratio(latency, predictions.cases.length), inputTokens: tokens, errors };
}

async function boundedJson(file) {
  const info = await lstat(file);
  if (!info.isFile() || info.size > 8_000_000) throw new Error("evaluation_input_invalid");
  return readFile(file, "utf8");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  try {
    if (args.length !== 6 || args[0] !== "--gold" || args[2] !== "--predictions" || args[4] !== "--threshold") throw new Error("usage");
    const [goldText, predictionText, catalogText] = await Promise.all([boundedJson(args[1]), boundedJson(args[3]),
      readFile(new URL("../../../src/data/okfCatalog.generated.json", import.meta.url), "utf8")]);
    console.log(JSON.stringify(evaluateClaims(JSON.parse(goldText), JSON.parse(predictionText), {
      threshold: Number(args[5]), goldSha256: hash(goldText), catalogText }), null, 2));
  } catch { console.error("claim_evaluation_failed: check file bounds, identities, schemas and an explicit threshold"); process.exitCode = 1; }
}
