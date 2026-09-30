import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseDocument, stringify } from "yaml";
import { z } from "zod";

export const OKF_VERSION = "0.2";
export const PROFILE_VERSION = "smartfaqs-okf-profile.v1";
export const CATALOG_VERSION = "smartfaqs-okf-catalog.v1";
const GENERATED_BUNDLE_MARKER = "smartfaqs-docling-okf-output.v1";
const GENERATED_BUNDLE_MARKER_FILE = ".smartfaqs-okf-generated.json";

const MAX_BUNDLE_FILES = 10_000;
const MAX_MARKDOWN_BYTES = 512 * 1024;
const MAX_DOCLING_BYTES = 64 * 1024 * 1024;
const MAX_DOCLING_ROWS = 20_000;
const MAX_CHUNK_CHARACTERS = 100_000;

const safeRef = /^[a-z][a-z0-9]*(?::[a-z0-9][a-z0-9-]*)+$/;
const safeBundleId = /^[a-z0-9][a-z0-9-]{1,63}$/;
const safeRevision = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const rootIndexSchema = z
  .object({ okf_version: z.literal(OKF_VERSION) })
  .strict();

const generatedSchema = z
  .object({
    by: z.string().min(1).max(120),
    at: z.string().datetime({ offset: true }),
  })
  .strict();

const sourceEntrySchema = z
  .object({
    id: z.string().min(1).max(80).optional(),
    resource: z.string().min(1).max(500),
    title: z.string().min(1).max(160).optional(),
    author: z.string().min(1).max(120).optional(),
    last_modified: z.string().datetime({ offset: true }).optional(),
  })
  .passthrough();

const commonConceptSchema = z
  .object({
    type: z.string().min(1).max(80),
    title: z.string().min(1).max(240).optional(),
    description: z.string().min(1).max(500).optional(),
    resource: z.string().min(1).max(500).optional(),
    tags: z.array(z.string().min(1).max(60)).max(32).optional(),
    status: z.enum(["draft", "stable", "deprecated"]).optional(),
    generated: generatedSchema.optional(),
    sources: z.array(sourceEntrySchema).max(32).optional(),
  })
  .passthrough();

const bundleExtensionSchema = z
  .object({
    profile_version: z.literal(PROFILE_VERSION),
    role: z.literal("bundle"),
    bundle_id: z.string().regex(safeBundleId),
    revision: z.string().regex(safeRevision),
    rights_class: z.enum([
      "synthetic_public_demo",
      "permission_confirmed",
      "local_private_only",
    ]),
  })
  .strict();

const sourceExtensionSchema = z
  .object({
    profile_version: z.literal(PROFILE_VERSION),
    role: z.literal("source"),
    stable_id: z.string().regex(safeRef),
    source_ref: z.string().regex(/^source:[a-z0-9][a-z0-9-]*$/),
    owner: z.string().min(1).max(120),
    version: z.string().min(1).max(80),
    display_updated_at: z.string().min(1).max(80),
    display_order: z.number().int().nonnegative(),
    accent: z.enum(["green", "coral", "gold"]),
    rights_class: z.enum([
      "synthetic_public_demo",
      "permission_confirmed",
      "local_private_only",
    ]),
  })
  .strict();

const sectionExtensionSchema = z
  .object({
    profile_version: z.literal(PROFILE_VERSION),
    role: z.literal("section"),
    stable_id: z.string().regex(/^section:[a-z0-9][a-z0-9-]*$/),
    source_ref: z.string().regex(/^source:[a-z0-9][a-z0-9-]*$/),
    section_path: z.array(z.string().min(1).max(240)).min(1).max(20),
    depth: z.number().int().positive().max(20),
    source_order: z.number().int().nonnegative(),
    structural_origin: z.enum([
      "authored",
      "explicit_heading",
      "inferred_from_heading_path",
    ]),
    heading_record_count: z.number().int().nonnegative(),
    page: z.number().int().positive().nullable().optional(),
    aliases: z.array(z.string().min(1).max(240)).max(20).optional(),
    keywords: z.array(z.string().min(1).max(60)).min(1).max(32),
  })
  .strict();

const evidenceExtensionSchema = z
  .object({
    profile_version: z.literal(PROFILE_VERSION),
    role: z.literal("evidence"),
    stable_id: z.string().regex(/^chunk:[a-z0-9][a-z0-9-]*$/),
    source_ref: z.string().regex(/^source:[a-z0-9][a-z0-9-]*$/),
    section: z.string().min(1).max(300),
    page: z.number().int().positive().nullable().optional(),
    kind: z.enum(["text", "table"]),
    keywords: z.array(z.string().min(1).max(60)).min(1).max(32),
    answer_questions: z.array(z.string().min(8).max(240)).min(1).max(3).optional(),
  })
  .strict();

const doclingRowSchema = z
  .object({
    text: z.string().min(1).max(MAX_CHUNK_CHARACTERS),
    chunk_index: z.number().int().nonnegative().optional(),
    chunk_index_in_section: z.number().int().nonnegative().optional(),
    chunk_type: z.string().min(1).max(40).optional(),
    heading_path: z.array(z.string().min(1).max(240)).max(20).optional(),
    heading_path_v2: z.array(z.string().min(1).max(240)).max(20).optional(),
    page_start: z.number().int().positive().nullable().optional(),
    semantic_span_hash: z.string().min(1).max(256).optional(),
  })
  .passthrough();

function asPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function assertInside(root, target, label) {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label}_outside_root`);
  }
}

function slug(value) {
  const result = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return result || "untitled";
}

function digest(value, length = 12) {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function frontmatterBlock(metadata) {
  return `---\n${stringify(metadata, { lineWidth: 0 }).trimEnd()}\n---\n`;
}

function splitFrontmatter(markdown, relativePath, required = true) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    if (required) throw new Error(`missing_frontmatter:${relativePath}`);
    return { metadata: null, body: markdown };
  }

  const document = parseDocument(match[1], {
    maxAliasCount: 50,
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    throw new Error(`invalid_frontmatter:${relativePath}`);
  }
  return {
    metadata: document.toJS({ maxAliasCount: 50 }),
    body: markdown.slice(match[0].length),
  };
}

function parseTableRow(line) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let current = "";
  let escaped = false;
  for (const character of trimmed) {
    if (escaped) {
      current += character === "|" || character === "\\" ? character : `\\${character}`;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  if (escaped) current += "\\";
  cells.push(current.trim());
  return cells;
}

function isTableSeparator(line, columnCount) {
  const cells = parseTableRow(line);
  return (
    cells.length === columnCount &&
    cells.every((cell) => /^:?-{3,}:?$/.test(cell))
  );
}

export function extractMarkdownTable(body, relativePath = "concept") {
  const lines = body.split(/\r?\n/);
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!lines[index].trim().startsWith("|")) continue;
    const headers = parseTableRow(lines[index]);
    if (headers.length < 2 || !isTableSeparator(lines[index + 1], headers.length)) {
      continue;
    }

    const rows = [];
    let end = index + 2;
    while (end < lines.length && lines[end].trim().startsWith("|")) {
      const row = parseTableRow(lines[end]);
      if (row.length !== headers.length) {
        throw new Error(`invalid_table_width:${relativePath}`);
      }
      rows.push(row);
      end += 1;
    }
    if (rows.length === 0) throw new Error(`table_has_no_rows:${relativePath}`);
    return { headers, rows, start: index, end };
  }
  throw new Error(`table_not_found:${relativePath}`);
}

function normalizeDoclingTable(text) {
  try {
    extractMarkdownTable(text);
    return text;
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("table_not_found:")) {
      throw error;
    }
  }

  const lines = text.trim().split(/\r?\n/);
  if (!lines.every((line) => line.trim().startsWith("|") && line.trim().endsWith("|"))) {
    return text;
  }
  const rows = lines.map(parseTableRow);
  const columnCount = rows[0].length;
  if (columnCount < 2 || rows.some((row) => row.length !== columnCount)) return text;

  // Keep every source row as data; neutral column names do not imply a source header.
  const headers = Array.from({ length: columnCount }, (_, index) => `Column ${index + 1}`);
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...lines,
  ].join("\n");
}

function bodyContent(body, tableRange) {
  const lines = body.split(/\r?\n/);
  if (lines[0]?.trim().startsWith("# ")) lines.shift();
  if (tableRange) {
    const offset = body.split(/\r?\n/)[0]?.trim().startsWith("# ") ? 1 : 0;
    lines.splice(tableRange.start - offset, tableRange.end - tableRange.start);
  }
  return lines.join("\n").trim();
}

async function markdownFiles(bundleRoot) {
  const root = path.resolve(bundleRoot);
  const files = [];

  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("bundle_symlinks_not_allowed");
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(absolute);
        if (files.length > MAX_BUNDLE_FILES) throw new Error("bundle_file_limit_exceeded");
      }
    }
  }

  await walk(root);
  return files;
}

export async function loadOkfBundle(bundleRoot) {
  const root = path.resolve(bundleRoot);
  const rootIndexPath = path.join(root, "index.md");
  const rootIndexText = await readFile(rootIndexPath, "utf8");
  if (Buffer.byteLength(rootIndexText) > MAX_MARKDOWN_BYTES) {
    throw new Error("root_index_too_large");
  }
  const rootIndex = splitFrontmatter(rootIndexText, "index.md");
  rootIndexSchema.parse(rootIndex.metadata);

  const concepts = [];
  for (const absolute of await markdownFiles(root)) {
    const relativePath = asPosix(path.relative(root, absolute));
    if (relativePath === "index.md" || path.basename(relativePath) === "index.md") {
      if (relativePath !== "index.md") {
        const indexText = await readFile(absolute, "utf8");
        if (/^---\r?\n/.test(indexText)) {
          throw new Error(`nested_index_frontmatter_not_allowed:${relativePath}`);
        }
      }
      continue;
    }
    if (path.basename(relativePath) === "log.md") continue;

    const fileStats = await stat(absolute);
    if (fileStats.size > MAX_MARKDOWN_BYTES) {
      throw new Error(`concept_too_large:${relativePath}`);
    }
    const markdown = await readFile(absolute, "utf8");
    const parsed = splitFrontmatter(markdown, relativePath);
    const metadata = commonConceptSchema.parse(parsed.metadata);
    concepts.push({
      conceptId: relativePath.slice(0, -3),
      relativePath,
      metadata,
      body: parsed.body.trim(),
    });
  }

  return { okfVersion: OKF_VERSION, concepts };
}

function requireExtension(metadata, schema, relativePath) {
  const result = schema.safeParse(metadata.smartfaqs);
  if (!result.success) {
    throw new Error(`invalid_smartfaqs_profile:${relativePath}:${result.error.issues[0].message}`);
  }
  return result.data;
}

export async function compileOkfCatalog(bundleRoot, { publicOnly = true } = {}) {
  const bundle = await loadOkfBundle(bundleRoot);
  const bundleConcepts = bundle.concepts.filter(
    (concept) => concept.metadata.type === "Knowledge Bundle",
  );
  if (bundleConcepts.length !== 1) throw new Error("exactly_one_bundle_concept_required");

  const bundleConcept = bundleConcepts[0];
  const bundleExtension = requireExtension(
    bundleConcept.metadata,
    bundleExtensionSchema,
    bundleConcept.relativePath,
  );
  if (publicOnly && bundleExtension.rights_class !== "synthetic_public_demo") {
    throw new Error("public_catalog_requires_synthetic_public_demo_bundle");
  }
  if (publicOnly && bundleConcept.metadata.status !== "stable") {
    throw new Error("public_catalog_requires_stable_bundle");
  }

  const sourceConcepts = bundle.concepts.filter(
    (concept) => concept.metadata.type === "Knowledge Source",
  );
  const evidenceConcepts = bundle.concepts.filter(
    (concept) => concept.metadata.type === "Evidence",
  );
  if (sourceConcepts.length === 0) throw new Error("knowledge_source_required");
  if (evidenceConcepts.length === 0) throw new Error("evidence_concept_required");

  const sourceRefs = new Set();
  const sources = sourceConcepts.map((concept) => {
    const extension = requireExtension(
      concept.metadata,
      sourceExtensionSchema,
      concept.relativePath,
    );
    if (extension.stable_id !== extension.source_ref) {
      throw new Error(`source_stable_id_mismatch:${concept.relativePath}`);
    }
    if (sourceRefs.has(extension.source_ref)) {
      throw new Error(`duplicate_source_ref:${extension.source_ref}`);
    }
    if (publicOnly && extension.rights_class !== "synthetic_public_demo") {
      throw new Error(`public_catalog_source_rights_blocked:${extension.source_ref}`);
    }
    if (publicOnly && concept.metadata.status !== "stable") {
      throw new Error(`public_catalog_source_not_stable:${extension.source_ref}`);
    }
    if (!concept.metadata.title || !concept.metadata.description) {
      throw new Error(`source_title_and_description_required:${concept.relativePath}`);
    }
    sourceRefs.add(extension.source_ref);
    return {
      ref: extension.source_ref,
      label: concept.metadata.title,
      summary: concept.metadata.description,
      owner: extension.owner,
      version: extension.version,
      updatedAt: extension.display_updated_at,
      accent: extension.accent,
      chunkCount: 0,
      sectionCount: 0,
      displayOrder: extension.display_order,
    };
  });

  const sourcePaths = new Map(
    sourceConcepts.map((concept) => {
      const extension = requireExtension(
        concept.metadata,
        sourceExtensionSchema,
        concept.relativePath,
      );
      return [extension.source_ref, `/${concept.relativePath}`];
    }),
  );
  const sourceDirectories = new Map(
    sourceConcepts.map((concept) => {
      const extension = requireExtension(
        concept.metadata,
        sourceExtensionSchema,
        concept.relativePath,
      );
      return [extension.source_ref, path.posix.dirname(concept.relativePath)];
    }),
  );

  const sectionConcepts = bundle.concepts.filter(
    (concept) => concept.metadata.type === "Document Section",
  );
  const sectionRefs = new Set();
  const sectionByDirectory = new Map();
  const sections = sectionConcepts.map((concept) => {
    const extension = requireExtension(
      concept.metadata,
      sectionExtensionSchema,
      concept.relativePath,
    );
    if (!sourceRefs.has(extension.source_ref)) {
      throw new Error(`unknown_section_source_ref:${concept.relativePath}`);
    }
    const expectedSourcePath = sourcePaths.get(extension.source_ref);
    if (
      concept.metadata.sources?.length !== 1 ||
      concept.metadata.sources[0].resource !== expectedSourcePath
    ) {
      throw new Error(`section_source_provenance_mismatch:${concept.relativePath}`);
    }
    if (publicOnly && concept.metadata.status !== "stable") {
      throw new Error(`public_catalog_section_not_stable:${extension.stable_id}`);
    }
    if (sectionRefs.has(extension.stable_id)) {
      throw new Error(`duplicate_section_ref:${extension.stable_id}`);
    }
    if (!concept.metadata.title || !concept.metadata.description) {
      throw new Error(`section_title_and_description_required:${concept.relativePath}`);
    }
    if (extension.depth !== extension.section_path.length) {
      throw new Error(`section_depth_mismatch:${concept.relativePath}`);
    }
    if (concept.metadata.title !== extension.section_path.at(-1)) {
      throw new Error(`section_title_path_mismatch:${concept.relativePath}`);
    }
    if (
      extension.structural_origin === "explicit_heading" &&
      extension.heading_record_count === 0
    ) {
      throw new Error(`explicit_section_requires_heading_record:${concept.relativePath}`);
    }

    const directory = path.posix.dirname(concept.relativePath);
    const sourceDirectory = sourceDirectories.get(extension.source_ref);
    if (
      !sourceDirectory ||
      directory === sourceDirectory ||
      !directory.startsWith(`${sourceDirectory}/`)
    ) {
      throw new Error(`section_outside_source_directory:${concept.relativePath}`);
    }
    if (sectionByDirectory.has(directory)) {
      throw new Error(`duplicate_section_directory:${directory}`);
    }
    sectionRefs.add(extension.stable_id);
    sectionByDirectory.set(directory, extension.stable_id);
    return {
      ref: extension.stable_id,
      conceptRef: `${bundleExtension.bundle_id}@${bundleExtension.revision}/${concept.conceptId}`,
      sourceRef: extension.source_ref,
      label: concept.metadata.title,
      description: concept.metadata.description,
      sectionPath: extension.section_path,
      depth: extension.depth,
      sourceOrder: extension.source_order,
      structuralOrigin: extension.structural_origin,
      headingRecordCount: extension.heading_record_count,
      page: extension.page ?? null,
      aliases: extension.aliases ?? [],
      keywords: extension.keywords.map((keyword) => keyword.toLowerCase()),
      directory,
      parentRef: null,
      rollup: {
        directSectionCount: 0,
        directEvidenceCount: 0,
        descendantEvidenceCount: 0,
        textCount: 0,
        tableCount: 0,
        pageStart: null,
        pageEnd: null,
        descendantDigest: "",
      },
    };
  });
  const sectionByRef = new Map(sections.map((section) => [section.ref, section]));

  for (const section of sections) {
    let parentDirectory = path.posix.dirname(section.directory);
    while (parentDirectory !== ".") {
      const parentRef = sectionByDirectory.get(parentDirectory);
      if (parentRef) {
        section.parentRef = parentRef;
        break;
      }
      parentDirectory = path.posix.dirname(parentDirectory);
    }
    if (section.depth > 1 && !section.parentRef) {
      throw new Error(`section_parent_concept_missing:${section.conceptRef}`);
    }
    if (section.parentRef) {
      const parent = sectionByRef.get(section.parentRef);
      if (
        !parent ||
        parent.sourceRef !== section.sourceRef ||
        parent.depth !== section.depth - 1 ||
        !startsWithPath(section.sectionPath, parent.sectionPath)
      ) {
        throw new Error(`section_parent_mismatch:${section.conceptRef}`);
      }
      parent.rollup.directSectionCount += 1;
    }
  }

  function nearestSection(relativePath) {
    let directory = path.posix.dirname(relativePath);
    while (directory !== ".") {
      const sectionRef = sectionByDirectory.get(directory);
      if (sectionRef) return sectionByRef.get(sectionRef);
      directory = path.posix.dirname(directory);
    }
    return null;
  }

  const chunkRefs = new Set();
  const chunks = evidenceConcepts.map((concept) => {
    const extension = requireExtension(
      concept.metadata,
      evidenceExtensionSchema,
      concept.relativePath,
    );
    if (!sourceRefs.has(extension.source_ref)) {
      throw new Error(`unknown_source_ref:${concept.relativePath}`);
    }
    if (publicOnly && concept.metadata.status !== "stable") {
      throw new Error(`public_catalog_evidence_not_stable:${extension.stable_id}`);
    }
    const expectedSourcePath = sourcePaths.get(extension.source_ref);
    if (
      concept.metadata.sources?.length !== 1 ||
      concept.metadata.sources[0].resource !== expectedSourcePath
    ) {
      throw new Error(`evidence_source_provenance_mismatch:${concept.relativePath}`);
    }
    if (chunkRefs.has(extension.stable_id)) {
      throw new Error(`duplicate_chunk_ref:${extension.stable_id}`);
    }
    if (!concept.metadata.title) {
      throw new Error(`evidence_title_required:${concept.relativePath}`);
    }
    const sectionConcept = nearestSection(concept.relativePath);
    if (!sectionConcept || sectionConcept.sourceRef !== extension.source_ref) {
      throw new Error(`evidence_section_concept_missing:${concept.relativePath}`);
    }
    chunkRefs.add(extension.stable_id);

    const tableRange =
      extension.kind === "table"
        ? extractMarkdownTable(concept.body, concept.relativePath)
        : null;
    const content =
      bodyContent(concept.body, tableRange) || concept.metadata.description || "";
    if (!content) throw new Error(`evidence_body_required:${concept.relativePath}`);

    const conceptRef = `${bundleExtension.bundle_id}@${bundleExtension.revision}/${concept.conceptId}`;
    return {
      ref: extension.stable_id,
      conceptRef,
      sourceRef: extension.source_ref,
      sectionRef: sectionConcept.ref,
      sectionConceptRef: sectionConcept.conceptRef,
      sectionPath: sectionConcept.sectionPath,
      label: concept.metadata.title,
      section: extension.section,
      page: extension.page ?? null,
      kind: extension.kind,
      content,
      ...(tableRange
        ? { table: { headers: tableRange.headers, rows: tableRange.rows } }
        : {}),
      keywords: extension.keywords.map((keyword) => keyword.toLowerCase()),
      ...(extension.answer_questions
        ? { answerQuestions: extension.answer_questions }
        : {}),
    };
  });

  const descendantRefsBySection = new Map(
    sections.map((section) => [section.ref, []]),
  );
  for (const chunk of chunks) {
    const directSection = sectionByRef.get(chunk.sectionRef);
    if (!directSection) throw new Error(`unknown_chunk_section:${chunk.conceptRef}`);
    directSection.rollup.directEvidenceCount += 1;

    let section = directSection;
    while (section) {
      section.rollup.descendantEvidenceCount += 1;
      section.rollup[chunk.kind === "table" ? "tableCount" : "textCount"] += 1;
      if (Number.isInteger(chunk.page)) {
        section.rollup.pageStart =
          section.rollup.pageStart === null
            ? chunk.page
            : Math.min(section.rollup.pageStart, chunk.page);
        section.rollup.pageEnd =
          section.rollup.pageEnd === null
            ? chunk.page
            : Math.max(section.rollup.pageEnd, chunk.page);
      }
      descendantRefsBySection.get(section.ref).push(chunk.conceptRef);
      section = section.parentRef ? sectionByRef.get(section.parentRef) : null;
    }
  }
  for (const section of sections) {
    section.rollup.descendantDigest = `sha256:${digest(
      descendantRefsBySection.get(section.ref).sort().join("\n"),
      24,
    )}`;
  }

  for (const source of sources) {
    source.chunkCount = chunks.filter((chunk) => chunk.sourceRef === source.ref).length;
    source.sectionCount = sections.filter(
      (section) => section.sourceRef === source.ref,
    ).length;
    if (source.chunkCount === 0) throw new Error(`source_has_no_evidence:${source.ref}`);
  }

  sources.sort(
    (left, right) => left.displayOrder - right.displayOrder || left.ref.localeCompare(right.ref),
  );
  sections.sort(
    (left, right) =>
      left.sourceRef.localeCompare(right.sourceRef) ||
      left.sourceOrder - right.sourceOrder ||
      left.conceptRef.localeCompare(right.conceptRef),
  );
  chunks.sort((left, right) => left.conceptRef.localeCompare(right.conceptRef));
  return {
    schemaVersion: CATALOG_VERSION,
    okfVersion: bundle.okfVersion,
    bundleId: bundleExtension.bundle_id,
    revision: bundleExtension.revision,
    sources: sources.map((source) => ({
      ref: source.ref,
      label: source.label,
      summary: source.summary,
      owner: source.owner,
      version: source.version,
      updatedAt: source.updatedAt,
      accent: source.accent,
      chunkCount: source.chunkCount,
      sectionCount: source.sectionCount,
    })),
    sections: sections.map((section) => ({
      ref: section.ref,
      conceptRef: section.conceptRef,
      sourceRef: section.sourceRef,
      label: section.label,
      description: section.description,
      sectionPath: section.sectionPath,
      depth: section.depth,
      sourceOrder: section.sourceOrder,
      structuralOrigin: section.structuralOrigin,
      headingRecordCount: section.headingRecordCount,
      page: section.page,
      aliases: section.aliases,
      keywords: section.keywords,
      parentRef: section.parentRef,
      rollup: section.rollup,
    })),
    chunks,
  };
}

export async function writeCatalog(bundleRoot, outputPath) {
  const catalog = await compileOkfCatalog(bundleRoot, { publicOnly: true });
  const serialized = `${JSON.stringify(catalog, null, 2)}\n`;
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serialized, "utf8");
  return catalog;
}

export async function checkCatalog(bundleRoot, outputPath) {
  const catalog = await compileOkfCatalog(bundleRoot, { publicOnly: true });
  const expected = `${JSON.stringify(catalog, null, 2)}\n`;
  const actual = await readFile(outputPath, "utf8").catch(() => "");
  if (actual !== expected) throw new Error("generated_catalog_out_of_date");
  return catalog;
}

function headingPathFor(row) {
  const preferred = row.heading_path_v2?.filter(Boolean);
  if (preferred?.length) return preferred;
  const fallback = row.heading_path?.filter(Boolean);
  return fallback?.length ? fallback : ["Unsectioned"];
}

function startsWithPath(candidate, prefix) {
  return prefix.every((segment, index) => candidate[index] === segment);
}

function indexMarkdown(title, directories, documents) {
  const lines = [`# ${title}`, ""];
  if (directories.length) {
    lines.push("## Sections", "");
    for (const [name, label] of directories) lines.push(`* [${label}](${name}/)`);
    lines.push("");
  }
  if (documents.length) {
    lines.push("## Concepts", "");
    for (const document of documents) {
      lines.push(`* [${document.title}](${document.name}) - ${document.description}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function conceptMarkdown(metadata, title, content) {
  return `${frontmatterBlock(metadata)}\n# ${title}\n\n${content.trim()}\n`;
}

function doclingSummary(rows, selectedRows, evidenceRows, sectionNodes) {
  const chunkTypes = {};
  let pageMetadataCount = 0;
  let maxChunkCharacters = 0;
  for (const row of evidenceRows) {
    const kind = row.chunk_type || "unspecified";
    chunkTypes[kind] = (chunkTypes[kind] || 0) + 1;
    if (Number.isInteger(row.page_start) && row.page_start > 0) pageMetadataCount += 1;
    maxChunkCharacters = Math.max(maxChunkCharacters, row.text.length);
  }
  return {
    status: "ready",
    inputRowCount: rows.length,
    selectedRowCount: selectedRows.length,
    evidenceDocumentCount: evidenceRows.length,
    headingOnlyRecordCount: selectedRows.filter(
      (row) => row.chunk_type === "heading_only",
    ).length,
    sectionConceptCount: sectionNodes.size,
    explicitSectionCount: [...sectionNodes.values()].filter(
      (section) => section.headingRecordCount > 0,
    ).length,
    inferredSectionCount: [...sectionNodes.values()].filter(
      (section) => section.headingRecordCount === 0,
    ).length,
    pageMetadataCount,
    maxChunkCharacters,
    chunkTypeCounts: Object.fromEntries(Object.entries(chunkTypes).sort()),
    rightsClass: "local_private_only",
  };
}

export async function convertDoclingJsonl({
  inputPath,
  outputDirectory,
  allowedOutputRoot,
  bundleId,
  revision,
  documentRef,
  sourceRef,
  sourceTitle,
  owner,
  version,
  displayUpdatedAt,
  generatedAt,
  headingPrefix = [],
  dryRun = false,
  force = false,
}) {
  const inputStats = await stat(inputPath);
  if (!inputStats.isFile()) throw new Error("docling_input_not_file");
  if (inputStats.size > MAX_DOCLING_BYTES) throw new Error("docling_input_too_large");
  if (!safeBundleId.test(bundleId)) throw new Error("invalid_bundle_id");
  if (!safeRevision.test(revision)) throw new Error("invalid_revision");
  if (!/^source:[a-z0-9][a-z0-9-]*$/.test(sourceRef)) {
    throw new Error("invalid_source_ref");
  }
  generatedSchema.parse({ by: "process:smartfaqs-docling-okf", at: generatedAt });

  const input = await readFile(inputPath, "utf8");
  const lines = input.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length > MAX_DOCLING_ROWS) throw new Error("docling_row_limit_exceeded");
  const rows = lines.map((line, index) => {
    try {
      return doclingRowSchema.parse(JSON.parse(line));
    } catch (error) {
      throw new Error(`invalid_docling_row:${index + 1}`, { cause: error });
    }
  });
  const selectedRows = rows.filter((row) =>
    startsWithPath(headingPathFor(row), headingPrefix),
  );
  const evidenceRows = selectedRows.filter(
    (row) => row.chunk_type !== "heading_only" && row.text.trim(),
  );
  if (evidenceRows.length === 0) throw new Error("no_docling_evidence_selected");

  const sectionNodes = new Map();
  selectedRows.forEach((row, ordinal) => {
    const headings = headingPathFor(row);
    const rowOrder = row.chunk_index ?? ordinal;
    headings.forEach((heading, index) => {
      const sectionPath = headings.slice(0, index + 1);
      const key = sectionPath.join("\u001f");
      const existing = sectionNodes.get(key) ?? {
        key,
        sectionPath,
        sourceOrder: rowOrder,
        page: null,
        headingRecordCount: 0,
      };
      existing.sourceOrder = Math.min(existing.sourceOrder, rowOrder);
      if (Number.isInteger(row.page_start) && row.page_start > 0) {
        existing.page =
          existing.page === null
            ? row.page_start
            : Math.min(existing.page, row.page_start);
      }
      if (row.chunk_type === "heading_only" && index === headings.length - 1) {
        existing.headingRecordCount += 1;
      }
      sectionNodes.set(key, existing);
    });
  });

  const summary = doclingSummary(rows, selectedRows, evidenceRows, sectionNodes);
  if (dryRun) return summary;
  if (!outputDirectory) throw new Error("output_directory_required");
  if (!allowedOutputRoot) throw new Error("allowed_output_root_required");

  const outputRoot = path.resolve(outputDirectory);
  const allowedRoot = path.resolve(allowedOutputRoot);
  await mkdir(allowedRoot, { recursive: true });
  if ((await lstat(allowedRoot)).isSymbolicLink()) {
    throw new Error("allowed_output_root_symlink_forbidden");
  }
  if (outputRoot === allowedRoot) throw new Error("output_directory_must_be_child");
  assertInside(allowedRoot, outputRoot, "output_directory");
  const parent = path.dirname(outputRoot);
  let existingParent = parent;
  while (true) {
    try {
      await lstat(existingParent);
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      existingParent = path.dirname(existingParent);
    }
  }
  const realAllowedRoot = await realpath(allowedRoot);
  assertInside(realAllowedRoot, await realpath(existingParent), "output_directory");
  await mkdir(parent, { recursive: true });
  assertInside(realAllowedRoot, await realpath(parent), "output_directory");
  const sourceSlug = slug(sourceRef.replace(/^source:/, ""));
  const files = new Map();
  const indexEntries = new Map();
  const directoryTitles = new Map([[sourceSlug, sourceTitle]]);

  function addIndexEntry(directory, entry) {
    const current = indexEntries.get(directory) || { directories: new Map(), documents: [] };
    if (entry.kind === "directory") current.directories.set(entry.name, entry.title);
    else current.documents.push(entry);
    indexEntries.set(directory, current);
  }

  const rootMetadata = { okf_version: OKF_VERSION };
  files.set("index.md", `${frontmatterBlock(rootMetadata)}\n# ${sourceTitle} knowledge bundle\n\n* [Bundle metadata](bundle.md)\n* [${sourceTitle}](${sourceSlug}/)\n`);
  files.set(
    GENERATED_BUNDLE_MARKER_FILE,
    `${JSON.stringify({ schemaVersion: GENERATED_BUNDLE_MARKER }, null, 2)}\n`,
  );
  files.set(
    "bundle.md",
    conceptMarkdown(
      {
        type: "Knowledge Bundle",
        title: `${sourceTitle} local bundle`,
        description: "Locally generated OKF bundle from bounded Docling JSONL chunks.",
        status: "draft",
        generated: { by: "process:smartfaqs-docling-okf", at: generatedAt },
        smartfaqs: {
          profile_version: PROFILE_VERSION,
          role: "bundle",
          bundle_id: bundleId,
          revision,
          rights_class: "local_private_only",
        },
      },
      `${sourceTitle} local bundle`,
      "This bundle is local-only until source rights, provenance, and review state are explicitly approved.",
    ),
  );

  const sourceDirectory = sourceSlug;
  files.set(
    `${sourceDirectory}/source.md`,
    conceptMarkdown(
      {
        type: "Knowledge Source",
        title: sourceTitle,
        description: "Document source converted from Docling JSONL for local evaluation.",
        resource: `urn:smartfaqs:document:${slug(documentRef)}`,
        status: "draft",
        generated: { by: "process:smartfaqs-docling-okf", at: generatedAt },
        smartfaqs: {
          profile_version: PROFILE_VERSION,
          role: "source",
          stable_id: sourceRef,
          source_ref: sourceRef,
          owner,
          version,
          display_updated_at: displayUpdatedAt,
          display_order: 1,
          accent: "green",
          rights_class: "local_private_only",
        },
      },
      sourceTitle,
      "This source remains local-only and draft until its rights and review state are approved.",
    ),
  );
  addIndexEntry(sourceDirectory, {
    kind: "document",
    name: "source.md",
    title: sourceTitle,
    description: "Source metadata and local-use boundary.",
  });

  const sectionDirectoryByKey = new Map();
  const sectionNodesInOrder = [...sectionNodes.values()].sort(
    (left, right) =>
      left.sectionPath.length - right.sectionPath.length ||
      left.sourceOrder - right.sourceOrder ||
      left.key.localeCompare(right.key),
  );
  for (const sectionNode of sectionNodesInOrder) {
    let currentDirectory = sourceDirectory;
    sectionNode.sectionPath.forEach((heading) => {
      const sectionSlug = slug(heading);
      addIndexEntry(currentDirectory, {
        kind: "directory",
        name: sectionSlug,
        title: heading,
      });
      currentDirectory = `${currentDirectory}/${sectionSlug}`;
      const existingTitle = directoryTitles.get(currentDirectory);
      if (existingTitle && existingTitle !== heading) {
        throw new Error("section_slug_collision");
      }
      directoryTitles.set(currentDirectory, heading);
    });

    const title = sectionNode.sectionPath.at(-1);
    const stableId = `section:${slug(documentRef)}-${digest(
      `${sourceRef}\0${sectionNode.key}`,
      16,
    )}`;
    const keywords = Array.from(
      new Set(
        sectionNode.sectionPath
          .flatMap((heading) => slug(heading).split("-"))
          .filter((word) => word.length > 1)
          .map((word) => word.slice(0, 60)),
      ),
    ).slice(0, 32);
    const metadata = {
      type: "Document Section",
      title,
      description: `Source heading ${title}.`,
      status: "draft",
      generated: { by: "process:smartfaqs-docling-okf", at: generatedAt },
      sources: [
        {
          id: slug(documentRef),
          resource: `/${sourceDirectory}/source.md`,
          title: sourceTitle,
          author: "process:docling-lab",
        },
      ],
      smartfaqs: {
        profile_version: PROFILE_VERSION,
        role: "section",
        stable_id: stableId,
        source_ref: sourceRef,
        section_path: sectionNode.sectionPath,
        depth: sectionNode.sectionPath.length,
        source_order: sectionNode.sourceOrder,
        structural_origin:
          sectionNode.headingRecordCount > 0
            ? "explicit_heading"
            : "inferred_from_heading_path",
        heading_record_count: sectionNode.headingRecordCount,
        page: sectionNode.page,
        keywords: keywords.length ? keywords : ["section"],
      },
    };
    files.set(`${currentDirectory}/section.md`, conceptMarkdown(metadata, title, ""));
    addIndexEntry(currentDirectory, {
      kind: "document",
      name: "section.md",
      title,
      description: metadata.description,
    });
    sectionDirectoryByKey.set(sectionNode.key, currentDirectory);
  }

  const usedRefs = new Map();
  evidenceRows.forEach((row, ordinal) => {
    const headings = headingPathFor(row);
    const currentDirectory = sectionDirectoryByKey.get(headings.join("\u001f"));
    if (!currentDirectory) throw new Error("evidence_section_directory_missing");

    const kind = row.chunk_type === "table" ? "table" : "text";
    const identityMaterial = row.semantic_span_hash || row.text;
    const baseRef = `chunk:${slug(documentRef)}-${digest(`${headings.join("/")}\0${identityMaterial}`)}`;
    const occurrence = (usedRefs.get(baseRef) || 0) + 1;
    usedRefs.set(baseRef, occurrence);
    const stableId = occurrence === 1 ? baseRef : `${baseRef}-${occurrence}`;
    const order = row.chunk_index_in_section ?? row.chunk_index ?? ordinal;
    const fileName = `${String(order).padStart(4, "0")}-${kind}-${digest(stableId, 8)}.md`;
    const sectionLabel = headings.join(" > ");
    const section = sectionLabel.length <= 300 ? sectionLabel : headings.at(-1);
    const title = `${headings.at(-1)} ${kind} ${order + 1}`;
    const keywords = Array.from(
      new Set(
        headings
          .flatMap((heading) => slug(heading).split("-"))
          .filter((word) => word.length > 1)
          .map((word) => word.slice(0, 60)),
      ),
    ).slice(0, 32);
    const metadata = {
      type: "Evidence",
      title: title.slice(0, 160),
      description: `Bounded ${kind} evidence in ${section}.`,
      status: "draft",
      generated: { by: "process:smartfaqs-docling-okf", at: generatedAt },
      sources: [
        {
          id: slug(documentRef),
          resource: `/${sourceDirectory}/source.md`,
          title: sourceTitle,
          author: "process:docling-lab",
        },
      ],
      smartfaqs: {
        profile_version: PROFILE_VERSION,
        role: "evidence",
        stable_id: stableId,
        source_ref: sourceRef,
        section,
        page: row.page_start ?? null,
        kind,
        keywords: keywords.length ? keywords : ["evidence"],
      },
    };
    const relativePath = `${currentDirectory}/${fileName}`;
    const body = kind === "table" ? normalizeDoclingTable(row.text) : row.text;
    files.set(relativePath, conceptMarkdown(metadata, title, body));
    addIndexEntry(currentDirectory, {
      kind: "document",
      name: fileName,
      title,
      description: metadata.description,
    });
  });

  for (const [directory, entries] of indexEntries) {
    const directoryTitle = directoryTitles.get(directory) || "Knowledge section";
    files.set(
      `${directory}/index.md`,
      indexMarkdown(
        directoryTitle,
        [...entries.directories.entries()].sort(([left], [right]) => left.localeCompare(right)),
        entries.documents.sort((left, right) => left.name.localeCompare(right.name)),
      ),
    );
  }

  const outputStats = await lstat(outputRoot)
    .catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
  if (outputStats?.isSymbolicLink()) throw new Error("output_directory_symlink_forbidden");
  const outputExists = outputStats !== null;
  if (outputExists && !force) throw new Error("output_directory_exists");
  if (outputExists && force) {
    const marker = await readFile(
      path.join(outputRoot, GENERATED_BUNDLE_MARKER_FILE),
      "utf8",
    ).catch(() => "");
    let markerIsValid = false;
    try {
      markerIsValid = JSON.parse(marker).schemaVersion === GENERATED_BUNDLE_MARKER;
    } catch {
      markerIsValid = false;
    }
    if (!markerIsValid) throw new Error("refusing_to_replace_unowned_directory");
  }
  const markdownFiles = [...files].filter(([name]) => name.endsWith(".md"));
  if (markdownFiles.length > MAX_BUNDLE_FILES) throw new Error("bundle_file_limit_exceeded");
  if (markdownFiles.some(([, contents]) => Buffer.byteLength(contents) > MAX_MARKDOWN_BYTES)) {
    throw new Error("markdown_file_too_large");
  }
  const temporaryRoot = await mkdtemp(path.join(parent, ".smartfaqs-okf-tmp-"));
  try {
    for (const [relativePath, contents] of files) {
      const destination = path.join(temporaryRoot, relativePath);
      assertInside(temporaryRoot, destination, "generated_path");
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, contents, "utf8");
    }
    await compileOkfCatalog(temporaryRoot, { publicOnly: false });
    const backupRoot = outputExists
      ? path.join(parent, `.${path.basename(outputRoot)}.backup-${randomUUID()}`)
      : null;
    if (backupRoot) await rename(outputRoot, backupRoot);
    try {
      await rename(temporaryRoot, outputRoot);
    } catch (error) {
      if (backupRoot) await rename(backupRoot, outputRoot);
      throw error;
    }
    if (backupRoot) await rm(backupRoot, { recursive: true });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  return summary;
}
