#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compileOkfCatalog } from "../okf/lib.mjs";
import {
  evaluateOkfRetrieval,
  loadOkfRetrievalGold,
} from "./okf-retrieval-lib.mts";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function parseArguments(values: string[]) {
  let bundlePath: string | undefined;
  let goldPath: string | undefined;
  let outputPath: string | undefined;
  let save = true;
  for (let index = 0; index < values.length; index += 1) {
    const argument = values[index];
    if (argument === "--bundle-path") bundlePath = values[++index];
    else if (argument === "--gold-path") goldPath = values[++index];
    else if (argument === "--output-path") outputPath = values[++index];
    else if (argument === "--no-save") save = false;
    else throw new Error(`unknown_option:${argument}`);
  }
  if (!bundlePath) throw new Error("missing_bundle_path");
  if (!goldPath) throw new Error("missing_gold_path");
  return {
    bundlePath: path.resolve(repositoryRoot, bundlePath),
    goldPath: path.resolve(repositoryRoot, goldPath),
    outputPath: outputPath
      ? path.resolve(repositoryRoot, outputPath)
      : undefined,
    save,
  };
}

async function run() {
  const options = parseArguments(process.argv.slice(2));
  const startedAt = performance.now();
  const [catalog, gold, goldBytes] = await Promise.all([
    compileOkfCatalog(options.bundlePath, { publicOnly: false }),
    loadOkfRetrievalGold(options.goldPath),
    readFile(options.goldPath),
  ]);
  const evaluation = evaluateOkfRetrieval(
    catalog.sections,
    catalog.chunks,
    gold,
  );
  const report = {
    ...evaluation,
    bundleId: catalog.bundleId,
    bundleRevision: catalog.revision,
    generatedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - startedAt),
    goldSha256: createHash("sha256").update(goldBytes).digest("hex"),
  };
  let reportPath: string | null = null;
  if (options.save) {
    reportPath =
      options.outputPath ??
      path.join(
        repositoryRoot,
        ".local/benchmarks/okf/results",
        `${catalog.bundleId}.json`,
      );
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  }

  console.log(
    JSON.stringify(
      {
        status: "complete",
        bundleId: report.bundleId,
        bundleRevision: report.bundleRevision,
        evaluatedQueryCount: report.evaluatedQueryCount,
        modes: Object.fromEntries(
          Object.entries(report.modes).map(([name, value]) => [
            name,
            value.metrics,
          ]),
        ),
        complementarity: report.complementarity,
        reportPath,
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
