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
const EXPECTED_ARCHIVE_SHA256 =
  "11c621288d41ac144d29b13b0f8503b3820b7d6e8b1f6ff24dff335c196d76be";
const EXPECTED_FILE_SHA256 = {
  "corpus.jsonl":
    "b8d6c89624cb2ed74dee8938effc4f5d8bd2086887880af8110d64be4ceade62",
  "claims_dev.jsonl":
    "86f0435d08fdb65d1aa41d1472684f57e6e71930626497bdf4d7a9ec1a632217",
};
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

async function verifyDataset(directory) {
  for (const [name, expectedHash] of Object.entries(EXPECTED_FILE_SHA256)) {
    const contents = await readFile(path.join(directory, name));
    if (contents.length === 0) throw new Error(`scifact_file_empty:${name}`);
    const actualHash = createHash("sha256").update(contents).digest("hex");
    if (actualHash !== expectedHash) {
      throw new Error(`scifact_file_hash_mismatch:${name}`);
    }
  }
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
    await verifyDataset(dataDirectory);
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
    const archiveSha256 = createHash("sha256").update(archive).digest("hex");
    if (archiveSha256 !== EXPECTED_ARCHIVE_SHA256) {
      throw new Error("scifact_archive_hash_mismatch");
    }
    await writeFile(archivePath, archive);

    const listing = await execute("tar", ["-tzf", archivePath], {
      maxBuffer: 4 * 1024 * 1024,
    });
    validateArchiveEntries(listing.stdout);
    await execute("tar", ["-xzf", archivePath, "-C", temporaryRoot]);

    await verifyDataset(path.join(temporaryRoot, "data"));
    await rename(path.join(temporaryRoot, "data"), dataDirectory);
    await writeFile(
      path.join(benchmarkRoot, "download-receipt.json"),
      `${JSON.stringify(
        {
          schemaVersion: "smartfaqs-benchmark-download-receipt.v1",
          sourceUrl: SOURCE_URL,
          resolvedUrl: response.url,
          archiveSha256,
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
