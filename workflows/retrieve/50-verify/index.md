# 50 Verify

## Checks

- The source reference exists in the generated catalog.
- Every requested chunk belongs to that selected source.
- Every evidence item resolves to a first-class section concept in that source.
- Every evidence item has a display label and revision-qualified OKF concept
  reference.
- Section rollups contain only derived counts, available page bounds, and a
  digest of descendant references.
- Table documents parsed into a rectangular header/row structure at build time.
- Public catalog compilation accepted only stable synthetic-demo concepts.

## Stop

Fail closed on a cross-source reference, missing source, stale generated
catalog, malformed table, or rights/lifecycle violation.
