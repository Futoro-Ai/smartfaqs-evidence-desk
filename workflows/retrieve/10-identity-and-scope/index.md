# 10 Identity and Scope

## Input

A source reference returned by `list_knowledge_sources`.

## Action

Resolve the reference against the generated OKF catalog. The public demo has no
accounts or tenants, so source selection is the complete authorization scope.
Production use with private data would require authenticated tenant and resource
authorization before this stage.

## Output

One selected source label and version. A source change clears staged citations,
review state, and packet state in the visible interface.
