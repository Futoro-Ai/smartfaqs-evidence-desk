#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildBeirSciFactBenchmark, loadBeirSciFactDataset } from "./beir-scifact-lib.mts";
import { evaluateSciFactBenchmark, sha256File } from "./scifact-lib.mts";

const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== "--title-weight" ||
  (args[1] !== "0.35" && args[1] !== "0.5"))) {
  throw new Error("invalid_title_weight_option");
}
const titleWeight = args.length === 0 ? 0.35 : Number(args[1]);

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const benchmarkRoot = path.join(repositoryRoot, ".local/benchmarks/beir-scifact");
const dataDirectory = path.join(benchmarkRoot, "data");

try {
  const { corpus, queries, qrels } = await loadBeirSciFactDataset(dataDirectory);
  const benchmark = buildBeirSciFactBenchmark(corpus, queries, qrels);
  const evaluation = evaluateSciFactBenchmark(benchmark, undefined, titleWeight);
  const report = {
    schemaVersion: "smartfaqs-beir-scifact-test.v1",
    dataset: "BEIR SciFact test",
    documentRepresentation: "one_abstract_per_evidence_chunk",
    codeRevision: process.env.GIT_COMMIT ?? null,
    generatedAt: new Date().toISOString(),
    inputFingerprints: {
      corpusSha256: await sha256File(path.join(dataDirectory, "corpus.jsonl")),
      queriesSha256: await sha256File(path.join(dataDirectory, "queries.jsonl")),
      qrelsSha256: await sha256File(path.join(dataDirectory, "qrels/test.tsv")),
    },
    implementationFingerprints: {
      rankingSha256: await sha256File(path.join(repositoryRoot, "src/lib/evidence/ranking.ts")),
      evaluatorSha256: await sha256File(path.join(repositoryRoot, "scripts/benchmarks/scifact-lib.mts")),
      adapterSha256: await sha256File(path.join(repositoryRoot, "scripts/benchmarks/beir-scifact-lib.mts")),
      runnerSha256: await sha256File(path.join(repositoryRoot, "scripts/benchmarks/run-beir-scifact.mts")),
    },
    evaluation,
  };
  const reportPath = path.join(benchmarkRoot, "results",
    titleWeight === 0.35 ? "beir-scifact-test.json" : `beir-scifact-test-title-${titleWeight}.json`);
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    status: "complete",
    corpusDocumentCount: evaluation.corpusDocumentCount,
    evaluatedQueryCount: evaluation.evaluatedQueryCount,
    titleWeight,
    bodyOnly: evaluation.modes.lexicalBodyOnly.metrics.evidence["10"],
    fielded: evaluation.modes.fieldedWithoutHierarchy.metrics.evidence["10"],
    reportPath,
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
