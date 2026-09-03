#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const SOURCE_URL =
  "https://scifact.s3-us-west-2.amazonaws.com/release/latest/data.tar.gz";
const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const benchmarkRoot = path.join(repositoryRoot, ".local/benchmarks/scifact");
const dataDirectory = path.join(benchmarkRoot, "data");
const requiredFiles = ["corpus.jsonl", "claims_dev.jsonl"];

if (process.argv.length > 2) {
  console.error(`unexpected_argument:${process.argv[2]}`);
  process.exit(1);
}

function assertInside(root, target) {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("scifact_target_outside_benchmark_root");
  }
}

async function datasetReady() {
  return (
    await Promise.all(
      requiredFiles.map((name) =>
        stat(path.join(dataDirectory, name))
          .then((value) => value.isFile())
          .catch(() => false),
      ),
    )
  ).every(Boolean);
}

function validateArchiveEntries(stdout) {
  const entries = stdout.split(/\r?\n/).filter(Boolean);
  if (entries.length === 0) throw new Error("scifact_archive_empty");
  for (const entry of entries) {
    const normalized = path.posix.normalize(entry);
    if (
      entry.startsWith("/") ||
      normalized === ".." ||
      normalized.startsWith("../") ||
      (normalized !== "data" && !normalized.startsWith("data/"))
    ) {
      throw new Error("scifact_archive_path_blocked");
    }
  }
}

async function prepare() {
  if (await datasetReady()) {
    return { status: "already_prepared", dataDirectory };
  }
  if (await stat(dataDirectory).catch(() => null)) {
    throw new Error("incomplete_scifact_dataset_directory");
  }

  await mkdir(benchmarkRoot, { recursive: true });
  const temporaryRoot = path.join(
    benchmarkRoot,
    `.prepare-${process.pid}-${Date.now()}`,
  );
  const archivePath = path.join(temporaryRoot, "data.tar.gz");
  assertInside(benchmarkRoot, temporaryRoot);
  await mkdir(temporaryRoot);

  try {
    const response = await fetch(SOURCE_URL, { redirect: "follow" });
    if (!response.ok) throw new Error(`scifact_download_failed:${response.status}`);
    if (new URL(response.url).hostname !== new URL(SOURCE_URL).hostname) {
      throw new Error("scifact_download_redirect_host_blocked");
    }
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_ARCHIVE_BYTES) {
      throw new Error("scifact_archive_too_large");
    }
    const archive = Buffer.from(await response.arrayBuffer());
    if (archive.length > MAX_ARCHIVE_BYTES) {
      throw new Error("scifact_archive_too_large");
    }
    await writeFile(archivePath, archive);

    const listing = await execute("tar", ["-tzf", archivePath], {
      maxBuffer: 4 * 1024 * 1024,
    });
    validateArchiveEntries(listing.stdout);
    await execute("tar", ["-xzf", archivePath, "-C", temporaryRoot]);

    for (const name of requiredFiles) {
      const contents = await readFile(path.join(temporaryRoot, "data", name));
      if (contents.length === 0) throw new Error(`scifact_file_empty:${name}`);
    }
    await rename(path.join(temporaryRoot, "data"), dataDirectory);
    await writeFile(
      path.join(benchmarkRoot, "download-receipt.json"),
      `${JSON.stringify(
        {
          schemaVersion: "smartfaqs-benchmark-download-receipt.v1",
          sourceUrl: SOURCE_URL,
          resolvedUrl: response.url,
          archiveSha256: createHash("sha256").update(archive).digest("hex"),
          etag: response.headers.get("etag"),
          lastModified: response.headers.get("last-modified"),
          preparedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );
    return { status: "prepared", dataDirectory };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

try {
  console.log(JSON.stringify(await prepare(), null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
