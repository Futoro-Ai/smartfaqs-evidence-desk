# 30 Retrieve

## Input

Selected-source concepts and normalized query terms.

## Action

Normalize Unicode, punctuation, small number words, units, and conservative
plural forms, then look up complete terms in the selected source's inverted
index. Body, title, keyword, local heading, ancestor heading, alias, section
identifier, table header, row-label, and table-cell fields remain distinct.
Stop words are removed, but negation is retained. No network, database, model,
embedding service, or hidden browser content is consulted.

## Output

Only positive-scoring or bounded nested-section candidates, before the result
limit is applied. Local evaluation can retain sanitized candidate counts; the
public tool response does not expose the internal candidate pool.
