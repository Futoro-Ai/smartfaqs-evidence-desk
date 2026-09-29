#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkCatalog, writeCatalog } from "./lib.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const bundleRoot = path.join(repositoryRoot, "knowledge/northstar");
const outputPath = path.join(repositoryRoot, "src/data/okfCatalog.generated.json");
const checkOnly = process.argv.includes("--check");

try {
  const catalog = checkOnly
    ? await checkCatalog(bundleRoot, outputPath)
    : await writeCatalog(bundleRoot, outputPath);
  console.log(
    JSON.stringify({
      status: checkOnly ? "current" : "generated",
      bundleId: catalog.bundleId,
      revision: catalog.revision,
      sourceCount: catalog.sources.length,
      sectionCount: catalog.sections.length,
      evidenceCount: catalog.chunks.length,
    }),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
