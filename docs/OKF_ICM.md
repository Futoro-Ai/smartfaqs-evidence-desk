# OKF and Interpretable Retrieval

## Implemented Scope

Evidence Desk uses an Open Knowledge Format (OKF) v0.2 bundle as the editable
source of truth and an Interpretable Context Methodology (ICM) style workspace
to document its retrieval stages. A deterministic build step validates the
bundle and creates the compact catalog consumed by the browser, WebMCP, and the
Streamable HTTP MCP endpoint.

The ICM paper calls its concrete filesystem protocol the Model Workspace
Protocol (MWP). Evidence Desk adopts that inspectable folder-and-Markdown
pattern for workflow contracts; it does not replace deterministic runtime
enforcement with prose.

This implementation deliberately separates three responsibilities:

1. **OKF** stores portable knowledge as hierarchical Markdown concepts with
   YAML frontmatter.
2. **ICM workflow folders** make scope, retrieval, verification, review, and
   export decisions inspectable.
3. **Deterministic code** enforces schemas, source scope, ranking bounds,
   rights classification, and safe output.

The app still requires no database, API key, embedding service, or external
runtime. Its public corpus is fictional and committed to this repository.

## Repository Layout

```text
knowledge/northstar/                 OKF v0.2 public synthetic bundle
  index.md                           progressive-disclosure root
  bundle.md                          bundle identity and rights class
  employee-handbook/
    index.md                         source-level directory index
    source.md                        source concept
    04-time-away/
      section.md                     first-class structural concept
      04-02-annual-leave/
        section.md                   heading metadata and identity
        annual-leave-schedule.md     evidence concept

scripts/okf/lib.mjs                 reusable parser, validator, compiler,
                                    and Docling JSONL converter
scripts/okf/compile-bundle.mjs      public catalog build/check command
scripts/okf/convert-docling.mjs     local Docling-compatible import CLI
src/data/okfCatalog.generated.json  deterministic runtime artifact
workflows/retrieve/                 inspectable retrieval workflow
```

Section numbers are preserved in folder names. Each normal `.md` file is an
OKF concept; `index.md` files provide progressive disclosure and are not
concepts. Only the root `index.md` carries `okf_version`, as required by OKF
v0.2.

Every distinct heading path is represented by a folder and a `section.md`
concept. The folder carries hierarchy, `index.md` enumerates immediate children,
and `section.md` preserves the heading's identity, order, provenance, and
structural origin. A heading inferred from descendant paths is explicitly
distinguished from a heading record observed in the source.

## SmartFAQs OKF Profile

The parser accepts unknown top-level OKF fields, as the standard requires. The
`smartfaqs` extension is strict so misspelled application fields fail the
build.

Every application concept uses:

| Field | Purpose |
| --- | --- |
| `type` | Standard OKF concept type. This app consumes `Knowledge Bundle`, `Knowledge Source`, `Document Section`, and `Evidence`. |
| `title`, `description` | Human and agent display metadata. |
| `status` | Standard OKF lifecycle state. Public compilation requires `stable`. |
| `generated` | Standard OKF producer and timestamp. |
| `sources` | Standard OKF provenance links from evidence to its source concept. |
| `smartfaqs.profile_version` | Pins this extension contract. |
| `smartfaqs.stable_id` | Stable application key that survives a file move. |
| `smartfaqs.source_ref` | Bounded source-scope key. |
| `smartfaqs.section_path` | Ordered heading ancestry for a `Document Section`. |
| `smartfaqs.structural_origin` | Whether a section was authored, observed as an explicit heading, or inferred from descendant paths. |
| `smartfaqs.heading_record_count` | Number of source heading records represented by the section concept. |
| `smartfaqs.section` | Human-readable section path. |
| `smartfaqs.page` | Optional positive page number. It remains `null` when the exporter provides none. |
| `smartfaqs.kind` | `text` or `table`. |
| `smartfaqs.keywords` | Bounded deterministic retrieval terms. |
| `smartfaqs.rights_class` | Prevents local/private material from entering the public catalog. |

The public compiler accepts only `synthetic_public_demo`. A Docling conversion
is always emitted as `local_private_only` and `draft`; no CLI argument can
silently promote it. Publication requires a separate, reviewed metadata change.

## References

Evidence has two complementary references:

- `chunk:leave-accrual-table` is the stable request key used by existing tools.
- `northstar-demo@2026.3/employee-handbook/04-time-away/04-02-annual-leave/annual-leave-schedule`
  is the bundle revision plus OKF concept path returned for inspection and
  citation.

The path identifies what was read in a specific bundle revision. The stable ID
lets an application preserve continuity if a maintainer reorganizes folders.
Neither is a database identifier.

## Build and Validation

Compile the editable bundle:

```bash
npm run okf:compile
```

Verify that the committed runtime catalog matches the Markdown source:

```bash
npm run okf:check
```

`npm run build` and `npm run check` fail when the catalog is stale. Compilation
also fails for malformed YAML, duplicate stable IDs, unknown source references,
source-provenance mismatches, invalid tables, non-stable public concepts, or a
non-public rights class.

## Docling-Compatible Import

The converter accepts newline-delimited JSON chunks that contain `text` and
either `heading_path_v2` or `heading_path`. It prefers `heading_path_v2`, uses
the heading hierarchy as folders, preserves explicit heading-only rows as
first-class section concepts, synthesizes missing parent sections, and creates
one bounded evidence concept per substantive chunk. Repeated records for the
same full heading path are represented by one section with a deterministic
record count. Tables remain Markdown tables. Unknown input fields are tolerated
but are not copied to frontmatter.

Run a metadata-only inspection first:

```bash
npm run okf:convert:docling -- \
  --input-path /private/path/document.jsonl \
  --bundle-id local-document \
  --revision inspection-1 \
  --document-ref document \
  --source-ref source:document \
  --source-title "Local document" \
  --owner "Local evaluator" \
  --version "1" \
  --display-updated-at "September 2, 2026" \
  --generated-at "2026-09-02T12:00:00Z" \
  --heading-prefix "5 Employee Benefits|510 Leave" \
  --dry-run
```

The dry run writes nothing and reports counts only. It does not print chunk
text, document IDs, chunk IDs, source references from the input, or planned
section names. It separately reports heading records, explicit sections,
inferred sections, and substantive evidence concepts.

After rights and local handling are understood, write an ignored local bundle:

```bash
npm run okf:convert:docling -- \
  --input-path /private/path/document.jsonl \
  --output-directory .local/okf/document \
  --bundle-id local-document \
  --revision inspection-1 \
  --document-ref document \
  --source-ref source:document \
  --source-title "Local document" \
  --owner "Local evaluator" \
  --version "1" \
  --display-updated-at "September 2, 2026" \
  --generated-at "2026-09-02T12:00:00Z" \
  --heading-prefix "5 Employee Benefits|510 Leave"
```

The command refuses to overwrite an existing output directory. `--force` is
available for an intentional regeneration, but it works only when the target
contains the converter's ownership marker. It will not delete an arbitrary
directory. `.local/` is ignored by Git.

## Ambrosia Adoption Boundary

`convertDoclingJsonl()` is exported from `scripts/okf/lib.mjs` and the CLI has a
stable file-based contract. A future Ambrosia integration can either import the
module in a Node worker or invoke the CLI after producing JSONL. Adoption should
preserve these controls:

- select document and heading scope before conversion;
- keep source rights and lifecycle state explicit;
- keep raw provider/database identifiers out of frontmatter;
- write to a staging directory and validate before atomic replacement;
- require separate human review before changing `draft` or
  `local_private_only`;
- never let knowledge content become workflow instructions.

This repository does not modify or contact an Ambrosia deployment.

## Retrieval Behavior

The current runtime is intentionally small. It filters to one selected source,
scores section concepts and substantive evidence separately, and boosts evidence
whose heading ancestry matches the query. Search responses include up to three
matched navigation sections plus at most five evidence results. Every evidence
result carries its bounded section path and section concept reference. A read
must present both the selected source and a matching stable chunk reference.
React escapes rendered content.

A heading-only leaf remains searchable and navigable even when it has no
descendant evidence. Its section concept can truthfully establish that the
heading exists and where it sits in the document, but it cannot substantiate a
claim about content that was not captured beneath it.

Section rollups are derived during compilation. They include direct child and
evidence counts, descendant text/table counts, an available page range, and a
digest of descendant concept references. They never concatenate descendant
text or become independent factual authority. Section concepts can establish
document organization and enrich a retrieved chunk's context; substantive
claims remain grounded in the underlying text or table concept.

This is lexical retrieval, not embedding or model-based retrieval. The OKF
bundle can later feed BM25, vector, graph, or table-aware indexes without
changing the source format, but those systems are not claimed here.

The optional SciFact harness exercises this same lexical ranker against public
evidence annotations and compares ancestry-aware scoring with an otherwise
identical no-ancestry ablation. It creates an in-memory evaluation catalog and
does not promote third-party content into the public OKF bundle. See
[Retrieval Benchmarks](BENCHMARKS.md).

## Methodology References

- [Open Knowledge Format v0.2 specification](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
- [Interpretable Context Methodology / Model Workspace Protocol paper](https://arxiv.org/abs/2603.16021)
