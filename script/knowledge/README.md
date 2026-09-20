# Repository knowledge

Start at `.knowledge/index.md`, select a concern/package, then inspect its source.
Source and tests always win. This is a local navigation aid, not an OKF standard
implementation, behavioral proof, or replacement for architecture/parity maps.

Run from repository root:

- `bun knowledge:init`: rebuild all documents from the current working tree.
- `bun knowledge:update`: regenerate only changed documents; retire removed packages.
- `bun knowledge:validate`: fail on malformed metadata, stale fingerprints, missing
  paths/documents, duplicate IDs, unexpected documents, or broken relationships.
- `bun knowledge:status`: show affected/unchanged knowledge and Git working changes.
- `bun knowledge:check`: same status with nonzero exit when knowledge needs attention.
- `bun knowledge:test`: run the isolated temporary-Git-repository regression suite.
- `bun knowledge:typecheck`: typecheck the tool.

## Architecture and lifecycle

`script/knowledge/catalog.ts` owns curated concern paths, relationships and concise
navigation notes. `update.ts` discovers Git-tracked and non-ignored untracked source
files, excludes secrets/output/vendor files and symlinks, reads package manifests,
and computes SHA-256 fingerprints. No source text, script command values, dependency
URLs, environment values, or credential values are copied into generated documents.

Each document's YAML frontmatter stores its paths, relationships, fingerprint and
last generation commit. Fingerprints include current working-tree contents, names,
catalog/rendering code and generated structure. Shared entrypoint definitions in the
catalog drive both index/workflow prose and their validated source paths. They detect changes across commits,
branch switches, additions, deletions and moves without relying on a clean tree or
local-only database. Commit metadata anchors the snapshot; it is not a claim that
uncommitted files equal HEAD. An unchanged document keeps its original metadata.
Git porcelain status reports both paths of renames as separate NUL-decoded records.

A package edit updates that package and overlapping concern documents. Manifest
runtime dependency edges populate related package IDs. This is conservative path
impact mapping, not transitive import or call-graph analysis. All eligible files are
hashed on each invocation; only affected documents are rewritten. Source areas are
bounded to 24 entries per package. State lives entirely in compact frontmatter.

Curated notes are explicitly marked as human review guidance. The updater does not
interpret behavior or automatically certify prose. Review notes when changing
architecture. Missing curated anchors fail before writing: edit the catalog for
moves/splits/merges, then update again. Deleted package inventory is retired safely.
Changes to the updater/catalog invalidate all documents. Generated Markdown should
not be edited directly; change the catalog or renderer. Per-file writes are atomic;
an interrupted multi-file update is detected by validation and repaired by rerunning.

## Git integration

The existing Husky pre-push hook performs an advisory knowledge check before its
existing checks. It never updates or stages files, calls a model, or blocks solely
on stale knowledge. Explicit commands inspect the working tree (not a staged-only
snapshot); regenerate after final source edits and include `.knowledge` in review.
The existing root `prepare` command installs Husky. No Git configuration is changed.

## Semantic enrichment and troubleshooting

No LLM provider is required or implemented: deterministic package facts and curated
navigation are useful offline. Future semantic enrichment must be an explicit,
provider-independent command with opt-in configuration and separate review; never
send source to a model from hooks. No external service or new dependency is used. The audited executable
`packages/core/src/credential.ts` is explicitly allowed for fingerprinting only;
credential-value files, other secret-like files, ignored files and symlinks remain
excluded. Its source text is never emitted into knowledge.

For stale/edited documents, run update. For missing anchors, review the source move
and fix the catalog. For malformed/obsolete generated documents, inspect changes
before rebuilding with init. Unknown Markdown files are reported, never deleted.
A checkout needs Git history with HEAD and Bun; a shallow clone works because
fingerprints do not require historical objects. Excluded files intentionally do
not trigger updates. Do not place secrets in source names, manifest package names,
or catalog prose; those are navigation metadata and are emitted.
