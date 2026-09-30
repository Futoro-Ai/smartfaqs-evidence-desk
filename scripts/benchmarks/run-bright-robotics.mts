#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateBrightRobotics, loadBrightRobotics } from "./bright-robotics-lib.mts";
import { sha256File } from "./scifact-lib.mts";

if (process.argv.length > 2) throw new Error(`unexpected_argument:${process.argv[2]}`);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const benchmarkRoot = path.join(root, ".local/benchmarks/bright-robotics");
const dataDirectory = path.join(benchmarkRoot, "data");

try {
  const { documents, examples } = await loadBrightRobotics(dataDirectory);
  const result = evaluateBrightRobotics(documents, examples);
  const report = {
    schemaVersion: "smartfaqs-bright-robotics-short-doc.v1",
    datasetRevision: "3066d29c9651a576c8aba4832d249807b181ecae",
    generatedAt: new Date().toISOString(),
    documentSha256: await sha256File(path.join(dataDirectory, "documents.jsonl")),
    examplesSha256: await sha256File(path.join(dataDirectory, "examples.jsonl")),
    implementationFingerprints: {
      rankingSha256: await sha256File(path.join(root, "src/lib/evidence/ranking.ts")),
      evaluatorSha256: await sha256File(path.join(root, "scripts/benchmarks/bright-robotics-lib.mts")),
      runnerSha256: await sha256File(path.join(root, "scripts/benchmarks/run-bright-robotics.mts")),
    },
    ...result,
  };
  const reportPath = path.join(benchmarkRoot, "results", "robotics-short-doc.json");
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    status: "complete", documentCount: result.documentCount, queryCount: result.queryCount,
    bodyOnly: { ndcgAt10: result.bodyOnly.ndcgAt10, recallAt100: result.bodyOnly.recallAt100 },
    reportPath,
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
