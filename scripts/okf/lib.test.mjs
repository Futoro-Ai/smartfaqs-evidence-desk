import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

const publishFault = vi.hoisted(() => ({ failOnce: false }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    rename: async (from, to) => {
      if (
        publishFault.failOnce &&
        String(from).includes(".smartfaqs-okf-tmp-") &&
        String(to).endsWith("/bundle")
      ) {
        publishFault.failOnce = false;
        throw new Error("publish_failed");
      }
      return actual.rename(from, to);
    },
  };
});

import {
  compileOkfCatalog,
  convertDoclingJsonl,
  extractMarkdownTable,
  loadOkfBundle,
} from "./lib.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

function converterOptions(root, inputPath, overrides = {}) {
  return {
    inputPath,
    outputDirectory: path.join(root, "bundle"),
    allowedOutputRoot: root,
    bundleId: "local-docling-test",
    revision: "fixture-1",
    documentRef: "fixture-doc",
    sourceRef: "source:fixture-doc",
    sourceTitle: "Fixture Document",
    owner: "Test Maintainer",
    version: "1",
    displayUpdatedAt: "September 2, 2026",
    generatedAt: "2026-09-02T12:00:00Z",
    headingPrefix: ["5 Employee Benefits", "510 Leave"],
    ...overrides,
  };
}

async function writeDoclingFixture(root) {
  const rows = [
    {
      text: "511 General",
      chunk_id: "private-heading-id",
      chunk_index: 0,
      chunk_type: "heading_only",
      heading_path_v2: ["5 Employee Benefits", "510 Leave", "511 General"],
    },
    {
      text: "A bounded fictional leave rule.",
      chunk_id: "private-prose-id",
      doc_id: "private-document-id",
      chunk_index: 1,
      chunk_index_in_section: 0,
      chunk_type: "prose",
      heading_path_v2: ["5 Employee Benefits", "510 Leave", "511 General"],
      semantic_span_hash: "private-semantic-span",
      page_start: null,
    },
    {
      text: "| Service | Hours |\n| --- | --- |\n| 5 years | 104 |",
      chunk_id: "private-table-id",
      chunk_index: 2,
      chunk_index_in_section: 1,
      chunk_type: "table",
      heading_path_v2: ["5 Employee Benefits", "510 Leave", "512 Annual Leave"],
      semantic_span_hash: "private-table-span",
      page_start: 18,
    },
    {
      text: "Out-of-scope content",
      chunk_index: 3,
      chunk_type: "prose",
      heading_path_v2: ["6 Programs"],
    },
  ];
  const inputPath = path.join(root, "chunks.jsonl");
  await writeFile(inputPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  return inputPath;
}

describe("SmartFAQs OKF profile", () => {
  it("compiles the public bundle into the fixed runtime catalog", async () => {
    const catalog = await compileOkfCatalog(
      path.join(repositoryRoot, "knowledge/northstar"),
    );

    expect(catalog).toMatchObject({
      schemaVersion: "smartfaqs-okf-catalog.v1",
      okfVersion: "0.2",
      bundleId: "northstar-demo",
      revision: "2026.3",
    });
    expect(catalog.sources).toHaveLength(3);
    expect(catalog.sections).toHaveLength(10);
    expect(catalog.chunks).toHaveLength(10);
    expect(
      catalog.sections.find(
        (section) => section.ref === "section:employee-handbook-time-away",
      ),
    ).toMatchObject({
      sectionPath: ["4 Time Away"],
      rollup: {
        directSectionCount: 3,
        descendantEvidenceCount: 4,
        tableCount: 1,
      },
    });
    expect(
      catalog.chunks.find((chunk) => chunk.ref === "chunk:leave-accrual-table"),
    ).toMatchObject({
      conceptRef:
        "northstar-demo@2026.3/employee-handbook/04-time-away/04-02-annual-leave/annual-leave-schedule",
      sectionRef: "section:employee-handbook-annual-leave",
      sectionPath: ["4 Time Away", "4.2 Annual Leave"],
      kind: "table",
      table: { headers: ["Completed service", "Annual hours", "Equivalent days"] },
    });
    expect(
      catalog.chunks.find((chunk) => chunk.ref === "chunk:leave-accrual-method"),
    ).toMatchObject({
      answerQuestions: ["How often is vacation time added to my balance?"],
    });
  });

  it("parses a bounded Markdown table including escaped pipes", () => {
    const table = extractMarkdownTable(
      "# Example\n\n| Label | Value |\n| --- | ---: |\n| A \\| B | 4 |",
    );
    expect(table.headers).toEqual(["Label", "Value"]);
    expect(table.rows).toEqual([["A | B", "4"]]);
    const literalBackslash = extractMarkdownTable(
      "| Label | Value |\n| --- | --- |\n| Path | C:\\temp |",
    );
    expect(literalBackslash.rows).toEqual([["Path", "C:\\temp"]]);
  });

  it("rejects frontmatter on nested progressive-disclosure indexes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "okf-index-test-"));
    await convertDoclingJsonl(
      converterOptions(root, await writeDoclingFixture(root)),
    );
    const nestedIndex = path.join(root, "bundle/fixture-doc/index.md");
    const current = await readFile(nestedIndex, "utf8");
    await writeFile(nestedIndex, `---\ntype: Invalid\n---\n${current}`);

    await expect(loadOkfBundle(path.join(root, "bundle"))).rejects.toThrow(
      "nested_index_frontmatter_not_allowed",
    );
  });
});

describe("Docling JSONL conversion", () => {
  it("returns a redacted metadata-only dry-run summary", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "docling-dry-run-"));
    const inputPath = await writeDoclingFixture(root);
    const outputDirectory = path.join(root, "must-not-exist");
    const summary = await convertDoclingJsonl(
      converterOptions(root, inputPath, { outputDirectory, dryRun: true }),
    );
    const serialized = JSON.stringify(summary);

    expect(summary).toMatchObject({
      inputRowCount: 4,
      selectedRowCount: 3,
      evidenceDocumentCount: 2,
      headingOnlyRecordCount: 1,
      sectionConceptCount: 4,
      explicitSectionCount: 1,
      inferredSectionCount: 3,
      pageMetadataCount: 1,
      rightsClass: "local_private_only",
    });
    expect(serialized).not.toContain("private-");
    expect(serialized).not.toContain("bounded fictional");
    await expect(readFile(path.join(outputDirectory, "index.md"), "utf8")).rejects.toThrow();
  });

  it("folders chunks by heading path without copying private identifiers", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "docling-write-"));
    const inputPath = await writeDoclingFixture(root);
    const options = converterOptions(root, inputPath);
    await convertDoclingJsonl(options);

    const bundle = await loadOkfBundle(options.outputDirectory);
    const catalog = await compileOkfCatalog(options.outputDirectory, {
      publicOnly: false,
    });
    const serializedConcepts = JSON.stringify(bundle.concepts);

    expect(catalog.sections).toHaveLength(4);
    expect(catalog.chunks).toHaveLength(2);
    expect(
      catalog.sections.find(
        (section) => section.label === "511 General",
      ),
    ).toMatchObject({
      structuralOrigin: "explicit_heading",
      headingRecordCount: 1,
      rollup: { descendantEvidenceCount: 1 },
    });
    expect(
      catalog.sections.find(
        (section) => section.label === "510 Leave",
      ),
    ).toMatchObject({
      structuralOrigin: "inferred_from_heading_path",
      rollup: { descendantEvidenceCount: 2 },
    });
    expect(catalog.chunks.some((chunk) => chunk.kind === "table")).toBe(true);
    expect(
      catalog.chunks.every((chunk) =>
        chunk.conceptRef.includes("5-employee-benefits/510-leave/"),
      ),
    ).toBe(true);
    expect(serializedConcepts).not.toContain("private-heading-id");
    expect(serializedConcepts).not.toContain("private-prose-id");
    expect(serializedConcepts).not.toContain("private-document-id");
  });

  it("preserves a heading-only leaf as navigation even without evidence", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "docling-heading-only-"));
    const inputPath = path.join(root, "chunks.jsonl");
    await writeFile(
      inputPath,
      [
        {
          text: "599 Navigation Only",
          chunk_type: "heading_only",
          heading_path_v2: [
            "5 Employee Benefits",
            "510 Leave",
            "599 Navigation Only",
          ],
        },
        {
          text: "Substantive evidence in a sibling section.",
          chunk_type: "prose",
          heading_path_v2: [
            "5 Employee Benefits",
            "510 Leave",
            "511 Evidence",
          ],
        },
      ]
        .map((row) => JSON.stringify(row))
        .join("\n"),
    );
    const options = converterOptions(root, inputPath);
    await convertDoclingJsonl(options);
    const catalog = await compileOkfCatalog(options.outputDirectory, {
      publicOnly: false,
    });

    expect(
      catalog.sections.find(
        (section) => section.label === "599 Navigation Only",
      ),
    ).toMatchObject({
      structuralOrigin: "explicit_heading",
      headingRecordCount: 1,
      rollup: { descendantEvidenceCount: 0 },
    });
  });

  it("keeps deep heading ancestry when the display label exceeds the profile limit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "docling-deep-heading-"));
    const inputPath = path.join(root, "chunks.jsonl");
    const headings = [
      "6 Employee Relations",
      `620 ${"A".repeat(190)}`,
      `621 ${"B".repeat(190)}`,
    ];
    await writeFile(
      inputPath,
      `${JSON.stringify({ text: "Bounded evidence", chunk_type: "prose", heading_path_v2: headings })}\n`,
    );

    const options = converterOptions(root, inputPath, { headingPrefix: [] });
    await convertDoclingJsonl(options);
    const catalog = await compileOkfCatalog(options.outputDirectory, {
      publicOnly: false,
    });

    expect(catalog.chunks[0]).toMatchObject({
      section: headings.at(-1),
      sectionPath: headings,
    });
    expect(catalog.chunks[0].label.length).toBeLessThanOrEqual(160);
    expect(catalog.sections.map((section) => section.label)).toContain(headings.at(-1));
    expect(headings.at(-1).length).toBeLessThanOrEqual(240);
    expect(catalog.sections).toHaveLength(3);
  });

  it("preserves headerless Docling grids as structured table rows", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "docling-headerless-table-"));
    const inputPath = path.join(root, "chunks.jsonl");
    await writeFile(
      inputPath,
      `${JSON.stringify({
        text: "| Award | 500 |\n| Limit | 4 |",
        chunk_type: "table",
        heading_path_v2: ["5 Employee Benefits", "510 Leave"],
      })}\n`,
    );

    const options = converterOptions(root, inputPath);
    await convertDoclingJsonl(options);
    const catalog = await compileOkfCatalog(options.outputDirectory, {
      publicOnly: false,
    });
    expect(catalog.chunks[0].table).toEqual({
      headers: ["Column 1", "Column 2"],
      rows: [["Award", "500"], ["Limit", "4"]],
    });
  });

  it("rejects headerless Docling grids with inconsistent row widths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "docling-ragged-table-"));
    const inputPath = path.join(root, "chunks.jsonl");
    await writeFile(
      inputPath,
      `${JSON.stringify({
        text: "| Award | 500 |\n| Limit | 4 | 2026 |",
        chunk_type: "table",
        heading_path_v2: ["5 Employee Benefits", "510 Leave"],
      })}\n`,
    );

    await expect(convertDoclingJsonl(converterOptions(root, inputPath))).rejects.toThrow(
      "table_not_found:",
    );
  });

  it("requires the complete section concept ancestry", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "docling-section-parent-"));
    const inputPath = await writeDoclingFixture(root);
    const options = converterOptions(root, inputPath);
    await convertDoclingJsonl(options);
    await rm(
      path.join(
        options.outputDirectory,
        "fixture-doc/5-employee-benefits/section.md",
      ),
    );

    await expect(
      compileOkfCatalog(options.outputDirectory, { publicOnly: false }),
    ).rejects.toThrow("section_parent_concept_missing");
  });

  it("prevents local-private Docling output from becoming a public catalog", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "docling-rights-"));
    const inputPath = await writeDoclingFixture(root);
    const options = converterOptions(root, inputPath);
    await convertDoclingJsonl(options);

    await expect(compileOkfCatalog(options.outputDirectory)).rejects.toThrow(
      "public_catalog_requires_synthetic_public_demo_bundle",
    );
  });

  it("validates the complete SmartFAQs profile before publishing output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "docling-profile-"));
    const inputPath = await writeDoclingFixture(root);
    const options = converterOptions(root, inputPath, { owner: "x".repeat(121) });

    await expect(convertDoclingJsonl(options)).rejects.toThrow(
      "invalid_smartfaqs_profile:fixture-doc/source.md",
    );
    await expect(
      readFile(path.join(options.outputDirectory, "index.md"), "utf8"),
    ).rejects.toThrow();
  });

  it("replaces only converter-owned output when force is explicit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "docling-force-"));
    const inputPath = await writeDoclingFixture(root);
    const options = converterOptions(root, inputPath);
    await mkdir(options.outputDirectory);
    await writeFile(path.join(options.outputDirectory, "keep.txt"), "keep");

    await expect(
      convertDoclingJsonl({ ...options, force: true }),
    ).rejects.toThrow("refusing_to_replace_unowned_directory");
    expect(await readFile(path.join(options.outputDirectory, "keep.txt"), "utf8")).toBe(
      "keep",
    );

    const ownedOptions = { ...options, outputDirectory: path.join(root, "owned") };
    await convertDoclingJsonl(ownedOptions);
    await expect(
      convertDoclingJsonl({ ...ownedOptions, force: true }),
    ).resolves.toMatchObject({ evidenceDocumentCount: 2 });
    await expect(convertDoclingJsonl({
      ...ownedOptions,
      owner: "x".repeat(121),
      force: true,
    })).rejects.toThrow("invalid_smartfaqs_profile");
    await expect(readFile(path.join(ownedOptions.outputDirectory, "index.md"), "utf8"))
      .resolves.toContain("Fixture Document");
  });

  it("restores the previous bundle when force publication fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "docling-force-rollback-"));
    const inputPath = await writeDoclingFixture(root);
    const options = converterOptions(root, inputPath);
    await convertDoclingJsonl(options);
    const previousIndex = await readFile(path.join(options.outputDirectory, "index.md"), "utf8");

    publishFault.failOnce = true;
    try {
      await expect(convertDoclingJsonl({ ...options, force: true })).rejects.toThrow(
        "publish_failed",
      );
    } finally {
      publishFault.failOnce = false;
    }
    expect(await readFile(path.join(options.outputDirectory, "index.md"), "utf8")).toBe(
      previousIndex,
    );
  });

  it("keeps private conversion inside the assigned output root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "docling-boundary-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "docling-outside-"));
    const inputPath = await writeDoclingFixture(root);
    const options = converterOptions(root, inputPath);
    await expect(convertDoclingJsonl({
      ...options, outputDirectory: path.join(outside, "bundle"),
    })).rejects.toThrow("output_directory_outside_root");
    await symlink(outside, path.join(root, "link"));
    await expect(convertDoclingJsonl({
      ...options, outputDirectory: path.join(root, "link", "bundle"),
    })).rejects.toThrow("output_directory_outside_root");
    expect(await readdir(outside)).toEqual([]);
  });

  it("rejects section and evidence provenance outside their source", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "docling-provenance-"));
    const inputPath = await writeDoclingFixture(root);
    const options = converterOptions(root, inputPath);
    await convertDoclingJsonl(options);
    const bundle = await loadOkfBundle(options.outputDirectory);
    const section = bundle.concepts.find((concept) =>
      concept.metadata.type === "Document Section");
    const sectionPath = path.join(options.outputDirectory, section.relativePath);
    const sectionText = await readFile(sectionPath, "utf8");
    expect(sectionText).toContain("resource: /fixture-doc/source.md");
    await writeFile(sectionPath, sectionText.replace(
      "resource: /fixture-doc/source.md", "resource: /wrong/source.md"));
    await expect(compileOkfCatalog(options.outputDirectory, { publicOnly: false }))
      .rejects.toThrow("section_source_provenance_mismatch");

    await writeFile(sectionPath, sectionText);
    const evidence = bundle.concepts.find((concept) =>
      concept.metadata.type === "Evidence");
    const evidencePath = path.join(options.outputDirectory, evidence.relativePath);
    const evidenceText = await readFile(evidencePath, "utf8");
    expect(evidenceText).toContain("resource: /fixture-doc/source.md");
    await writeFile(evidencePath, evidenceText.replace(
      "resource: /fixture-doc/source.md",
      "resource: /fixture-doc/source.md\n  - resource: /wrong/source.md",
    ));
    await expect(compileOkfCatalog(options.outputDirectory, { publicOnly: false }))
      .rejects.toThrow("evidence_source_provenance_mismatch");
  });

  it("rejects generated bundles beyond the file bound before writing files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "docling-many-headings-"));
    const inputPath = path.join(root, "chunks.jsonl");
    const rows = Array.from({ length: 5_001 }, (_, index) => ({
      text: `Heading ${index}`,
      chunk_type: "heading_only",
      heading_path_v2: [`Heading ${index}`],
    }));
    rows.push({ text: "Bounded fact", chunk_type: "prose", heading_path_v2: ["Fact"] });
    await writeFile(inputPath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
    await expect(convertDoclingJsonl(converterOptions(root, inputPath, {
      headingPrefix: [],
    }))).rejects.toThrow("bundle_file_limit_exceeded");
    expect(await readdir(root)).toEqual(["chunks.jsonl"]);
  });

  it("sanitizes hostile headings into bounded relative paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "docling-path-"));
    const inputPath = path.join(root, "chunks.jsonl");
    await writeFile(
      inputPath,
      `${JSON.stringify({
        text: "Safe body",
        chunk_index: 0,
        chunk_type: "prose",
        heading_path_v2: ["../../outside", "511 General"],
      })}\n`,
    );
    const options = converterOptions(root, inputPath, { headingPrefix: [] });
    await convertDoclingJsonl(options);
    const bundle = await loadOkfBundle(options.outputDirectory);

    expect(bundle.concepts.some((concept) => concept.conceptId.includes("outside"))).toBe(true);
    await expect(readFile(path.join(root, "outside"), "utf8")).rejects.toThrow();
  });

  it("fails closed when distinct section headings normalize to one folder", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "docling-collision-"));
    const inputPath = path.join(root, "chunks.jsonl");
    await writeFile(
      inputPath,
      [
        { text: "First", chunk_type: "prose", heading_path_v2: ["A+B"] },
        { text: "Second", chunk_type: "prose", heading_path_v2: ["A B"] },
      ]
        .map((row) => JSON.stringify(row))
        .join("\n"),
    );

    await expect(
      convertDoclingJsonl(
        converterOptions(root, inputPath, { headingPrefix: [] }),
      ),
    ).rejects.toThrow("section_slug_collision");
  });

  it("fails closed on malformed JSONL without echoing its content", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "docling-invalid-"));
    const inputPath = path.join(root, "chunks.jsonl");
    await writeFile(inputPath, "{secret invalid json\n");

    await expect(
      convertDoclingJsonl(
        converterOptions(root, inputPath, { dryRun: true }),
      ),
    ).rejects.toThrow("invalid_docling_row:1");
  });
});
