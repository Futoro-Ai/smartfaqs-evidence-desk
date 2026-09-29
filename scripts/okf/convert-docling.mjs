#!/usr/bin/env node

import { convertDoclingJsonl } from "./lib.mjs";
import path from "node:path";

const privateOutputRoot = path.resolve(import.meta.dirname, "../../.local");

const valueOptions = new Set([
  "input-path",
  "output-directory",
  "bundle-id",
  "revision",
  "document-ref",
  "source-ref",
  "source-title",
  "owner",
  "version",
  "display-updated-at",
  "generated-at",
]);

function parseArguments(values) {
  const parsed = { headingPrefix: [], dryRun: false, force: false };
  for (let index = 0; index < values.length; index += 1) {
    const argument = values[index];
    if (argument === "--dry-run") parsed.dryRun = true;
    else if (argument === "--force") parsed.force = true;
    else if (argument === "--heading-prefix") {
      parsed.headingPrefix = (values[++index] || "").split("|").filter(Boolean);
    } else if (argument.startsWith("--")) {
      if (!valueOptions.has(argument.slice(2))) {
        throw new Error(`unknown_option:${argument}`);
      }
      const key = argument
        .slice(2)
        .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      const value = values[++index];
      if (!value || value.startsWith("--")) {
        throw new Error(`missing_option_value:${argument}`);
      }
      parsed[key] = value;
    } else {
      throw new Error(`unexpected_argument:${argument}`);
    }
  }
  return parsed;
}

const options = parseArguments(process.argv.slice(2));
const required = [
  "inputPath",
  "bundleId",
  "revision",
  "documentRef",
  "sourceRef",
  "sourceTitle",
  "owner",
  "version",
  "displayUpdatedAt",
  "generatedAt",
];
if (!options.dryRun) required.push("outputDirectory");
const missing = required.filter((key) => !options[key]);

if (missing.length) {
  console.error(`missing_arguments:${missing.join(",")}`);
  process.exitCode = 1;
} else {
  try {
    const summary = await convertDoclingJsonl({
      ...options,
      allowedOutputRoot: privateOutputRoot,
    });
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
