# 30 Retrieve

## Input

Selected-source concepts and normalized query terms.

## Action

Match terms deterministically against evidence titles, bounded content,
keywords, table headers/cells, and the evidence concept's section ancestry.
Heading matches boost descendant chunks so structural context can improve
retrieval without being mistaken for substantive evidence. Stop words are
removed. No network, database, model, embedding service, or hidden browser
content is consulted.

## Output

Only positive-scoring candidates, before the result limit is applied.
