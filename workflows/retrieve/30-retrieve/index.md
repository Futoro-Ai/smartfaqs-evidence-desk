# 30 Retrieve

## Input

Selected-source concepts and normalized query terms.

## Action

Match terms deterministically against concept titles, section labels, bounded
content, keywords, and table headers/cells. Stop words are removed. No network,
database, model, embedding service, or hidden browser content is consulted.

## Output

Only positive-scoring candidates, before the result limit is applied.
