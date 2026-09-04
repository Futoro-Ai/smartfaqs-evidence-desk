# 20 Route

## Input

The selected source and a focused query.

## Action

Rank first-class section concepts with source-scoped fielded BM25 over titles,
heading ancestry, aliases, section identifiers, descriptions, and bounded
keywords. The editable `index.md` files provide human/agent progressive
disclosure; the runtime uses their validated generated catalog and derived
structural rollups.

## Output

Up to three matched navigation sections from only the selected source. Each
match identifies its descendant evidence count without returning descendant
content.
