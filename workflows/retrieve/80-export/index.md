# 80 Export

## Output

A compact `evidence-packet.v1` containing source/evidence labels, counts,
answer presence, decision state, and the synthetic-public-data boundary.

## Exclusions

Do not include raw evidence bodies, answer text, filesystem paths, environment
variables, credentials, database identifiers, or hidden approval state. Agent
tools may export only a pending packet; a human-prepared packet may include the
visible review decision.
