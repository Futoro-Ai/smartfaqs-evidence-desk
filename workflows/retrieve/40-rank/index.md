# 40 Rank

## Action

Give an exact keyword match a three-point boost, a section-ancestry match a
two-point boost, and a searchable-content match one point. Score section
navigation candidates separately. Sort evidence by score, then page when
available. Return no more than three sections and the caller-requested evidence
limit, which schemas cap at five.

## Known Ceiling

This is transparent lexical ranking for a small demonstration corpus. It does
not claim semantic recall, learned reranking, or production-scale performance.
