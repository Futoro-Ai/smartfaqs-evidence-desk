# 40 Rank

## Action

Use BM25 term saturation, source-local inverse document frequency, per-field
length normalization, and fixed reviewed field weights. Score section
navigation independently. A matched section below depth one may add a
low-weight boost to no more than 20 descendants, reduced by hierarchy distance;
a broad depth-one title never blanket-boosts a document. Sort by score, then
page and source order for deterministic ties. Return no more than three sections
and the caller-requested evidence limit, which schemas cap at five.

## Known Ceiling

This is transparent lexical BM25F for a bounded demonstration corpus. It does
not claim semantic recall, learned reranking, or production-scale performance.
