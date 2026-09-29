#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildSciFactBenchmark,
  evaluateSciFactBenchmark,
  loadSciFactDataset,
  sha256File,
} from "./scifact-lib.mts";
import { writeSciFactIcmWorkspace } from "./scifact-workspace.mts";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const benchmarkRoot = path.join(repositoryRoot, ".local/benchmarks/scifact");
const dataDirectory = path.join(benchmarkRoot, "data");

function parseArguments(values: string[]) {
  let queryLimit: number | undefined;
  let save = true;
  for (let index = 0; index < values.length; index += 1) {
    const argument = values[index];
    if (argument === "--query-limit") {
      const value = values[++index];
      if (!value || !/^\d+$/.test(value)) throw new Error("invalid_query_limit");
      queryLimit = Number(value);
    } else if (argument === "--no-save") {
      save = false;
    } else {
      throw new Error(`unknown_option:${argument}`);
    }
  }
  return { queryLimit, save };
}

async function run() {
  const options = parseArguments(process.argv.slice(2));
  const { corpus, claims } = await loadSciFactDataset(dataDirectory).catch(
    (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(
          "scifact_dataset_missing:run_npm_run_benchmark_scifact_prepare",
        );
      }
      throw error;
    },
  );
  const startedAt = performance.now();
  const benchmark = buildSciFactBenchmark(corpus, claims);
  const evaluation = evaluateSciFactBenchmark(benchmark, options.queryLimit);
  const report = {
    ...evaluation,
    generatedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - startedAt),
    inputFingerprints: {
      corpusSha256: await sha256File(path.join(dataDirectory, "corpus.jsonl")),
      claimsDevSha256: await sha256File(
        path.join(dataDirectory, "claims_dev.jsonl"),
      ),
    },
  };
  let reportPath: string | null = null;
  let workspacePath: string | null = null;
  if (options.save) {
    const runName = options.queryLimit
      ? `scifact-first-${options.queryLimit}`
      : "scifact-full";
    const reportName = `${runName}.json`;
    reportPath = path.join(benchmarkRoot, "results", reportName);
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    workspacePath = path.join(benchmarkRoot, "workspaces", runName);
    await writeSciFactIcmWorkspace(workspacePath, report);
  }

  console.log(
    JSON.stringify(
      {
        status: "complete",
        dataset: report.dataset,
        corpusDocumentCount: report.corpusDocumentCount,
        evidenceChunkCount: report.evidenceChunkCount,
        eligibleQueryCount: report.eligibleQueryCount,
        evaluatedQueryCount: report.evaluatedQueryCount,
        durationMs: report.durationMs,
        bodyOnlyMetrics: report.modes.lexicalBodyOnly.metrics,
        fieldedMetrics: report.modes.fieldedWithoutHierarchy.metrics,
        hierarchyMetrics: report.modes.fieldedWithHierarchy.metrics,
        complementarity: report.complementarity,
        reportPath,
        workspacePath,
      },
      null,
      2,
    ),
  );
}

try {
  await run();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
