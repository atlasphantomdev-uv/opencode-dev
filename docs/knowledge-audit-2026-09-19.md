# Knowledge-system audit — 2026-09-19

Repository: `/Users/home/Projects/opencode-dev`.
Audited HEAD: `992242f7af4a30ae91404cc8485021392e8ea572`, including the existing uncommitted knowledge implementation.
All commands below ran from this repository root unless a different directory is specified.

## 1. Executive summary

**Useful navigation, but the primary claim of cheaper agent investigation is not established. Freshness validation has confirmed blind spots.**

The audit inspected the agent instructions, all five concern documents, representative package cards, source-level relationships, four realistic navigation tasks, two discovery replays, temporary Git fixtures, and two real-tree no-op updates. Three independent audit workstreams completed. Additional fresh benchmark agents could not start because of the account usage limit; their runs are not counted as evidence.

Confirmed: 44 knowledge documents total 34,677 bytes; selective consumption avoided whole-repository content searches in all four observed tasks; sampled prose was substantially accurate; normal incremental updates and no-op behavior worked. However, package cards often require another search to reach the relevant implementation, and loaded knowledge added 5.9–7.4 KB per task. No token savings or causal speedup is claimed.

Two reproduced defects undermine freshness guarantees:

1. A legitimate security implementation, `packages/core/src/credential.ts`, is excluded from fingerprints. Editing it leaves status current and validation passing.
2. Deleting `packages/app/src/entry.tsx` leaves the deleted path in index/workflow prose after a successful update and validation.

No application or knowledge implementation was changed. Recommendations below are evidence-based proposals, not completed fixes.

## 2. Agent-consumption flow

The observed pattern was index → two or three selected documents → source excerpts → targeted searches for missing links → verified source-level answer. Nobody had to read all 44 documents for a task.

### A — Explain high-level execution

Knowledge: `.knowledge/index.md` → `.knowledge/architecture.md` + `.knowledge/workflows.md`.

Predicted paths: CLI `packages/opencode/src/index.ts`, web `packages/app/src/entry.tsx`, desktop `packages/desktop/src/main`, Core `packages/core/src/session.ts` and its session directory.

Opened seven source files/excerpts:

- `packages/opencode/src/index.ts`
- `packages/opencode/src/cli/cmd/serve.ts`
- `packages/app/src/entry.tsx`
- `packages/desktop/src/main/index.ts`
- `packages/core/src/session.ts`
- `packages/core/src/session/execution/local.ts`
- `packages/core/src/session/runner/llm.ts`

Search-only excerpts additionally exposed `packages/core/src/session/execution.ts` and `packages/opencode/src/server/server.ts`.

Result: CLI registers yargs commands; serve loads Server.listen; web imports Solid render; desktop awaits Electron readiness. V2 Session.prompt admits through SessionInput before wake, unless resume:false; local execution resolves SessionStore and LocationServiceMap and invokes the runner; the runner explicitly streams the provider request. This is a source trace, not runtime parity verification or a complete trace through every UI and server adapter.

Missing navigation: index package roles, CLI/server-to-V2 assembly seam, and exact coordinator/runner leaf paths. Four bounded searches resolved the necessary subset. No broad repository content search.

### B — MCP registration and initialization

Knowledge: `.knowledge/index.md` → `.knowledge/integrations.md` + `.knowledge/module-packages-opencode.md`.

Predicted path: `packages/opencode/src/mcp/index.ts`. Migration caution was useful; the package card added little.

Opened four source files/excerpts:

- `packages/opencode/src/mcp/index.ts`
- `packages/opencode/src/config/config.ts`
- `packages/opencode/src/server/routes/instance/httpapi/handlers/mcp.ts`
- `packages/opencode/src/cli/cmd/mcp.ts`

Result: CLI addMcpToConfig edits the named mcp JSONC property; HTTP add delegates to MCP.add, which stores runtime configuration and creates a client. InstanceState initialization reads cfg.mcp, skips invalid/disabled entries and initializes enabled entries concurrently. Local uses stdio, remote tries Streamable HTTP/SSE; connection is timed and lifecycle finalizers close clients. Knowledge routed to the right owner but omitted the CLI writer, HTTP registration handler and initialization anchors.

The original investigator also guessed a nonexistent `packages/core/src/session/runner.ts`. That was an investigation mistake, not a stale knowledge path. It does not prove absence of V2 MCP support.

### C — Provider/model configuration

Knowledge: `.knowledge/index.md` → `.knowledge/configuration.md` + `.knowledge/module-packages-core.md` + `.knowledge/module-packages-opencode.md`.

Predicted paths: `packages/core/src/config.ts` and legacy `packages/opencode/src/config/config.ts`.

Opened six source files/excerpts:

- `packages/core/src/config.ts`
- `packages/opencode/src/config/config.ts`
- `packages/core/src/provider.ts` — schema/type re-export, a navigation dead end for this question
- `packages/core/src/config/plugin/provider.ts`
- `packages/core/src/plugin/internal.ts`
- `packages/opencode/src/provider/provider.ts`

Result: Core Config reads/decodes JSON/JSONC at Location opening, migrates V1 input and returns ordered documents. ConfigProviderPlugin consumes config.entries, transforms integrations/catalog and selects Config.latest(model). PluginInternal registers model/provider/external plugins before that config provider plugin. Legacy Config merges InstanceState configuration; legacy Provider reads config.get and runs plugin loading before consuming cfg.provider; cfg.model selects an explicit default. Knowledge correctly distinguished the loaders but did not identify their consumers or boot ordering. Two package-wide content searches were necessary; no whole-repository content scan.

### D — Trace prompt admission across packages

Knowledge: `.knowledge/index.md` → `.knowledge/architecture.md` + `.knowledge/module-packages-server.md`.

Predicted paths: `packages/server/src/api.ts`, `packages/server/src/handlers/session.ts`, `packages/core/src/session.ts`, and Protocol/session directories.

Opened six unique source files across eight excerpt-read operations:

- `packages/server/src/api.ts`
- `packages/protocol/src/api.ts`
- `packages/protocol/src/groups/session.ts`
- `packages/server/src/handlers/session.ts`
- `packages/core/src/session.ts`
- `packages/core/src/session/input.ts`

Search-only excerpts additionally inspected `packages/core/src/session/sql.ts` and `packages/core/src/session/projector.ts`.

Result: Protocol defines POST /api/session/:sessionID/prompt and its shared shapes. Server injects middleware and maps the request into SessionV2.prompt. Core checks retry identity, admits a durable PromptAdmitted event and then wakes execution unless resume:false. SessionProjector invokes projectAdmitted, which inserts SessionInputTable. Missing navigation: exact endpoint/group and projector leaf paths. Four targeted searches; no broad scan. Transaction/recovery correctness was not tested by this navigation task.

## 3. Behavioral benchmark

A source-file count means a unique file whose body/excerpt was opened; search-result-only files are reported separately. A search means a shell search invocation/pipeline, not every rg subprocess. Broad filename inventory and broad content scanning are distinguished. Shared knowledge is charged to each task as a standalone task; this is not a claim that files were loaded twice into the same agent context.

| Task                   | Knowledge documents | Source files opened | Search invocations | Whole-repository content scans | Verified knowledge claim groups | Incorrect/stale claims in current sample | Missing navigation hops |
| ---------------------- | ------------------: | ------------------: | -----------------: | -----------------------------: | ------------------------------: | ---------------------------------------: | ----------------------: |
| A architecture         |                   3 |  7 (+2 search-only) |                  4 |                              0 |                               6 |                               0 observed |                       3 |
| B MCP                  |                   3 |                   4 |                  4 |                              0 |                               2 |                               0 observed |                       3 |
| C configuration        |                   4 |                   6 |                  6 |                              0 |                               2 |                               0 observed |                       3 |
| D cross-package prompt |                   3 |  6 (+2 search-only) |                  4 |                              0 |                               5 |                               0 observed |                       2 |

Claim groups are defined by the results above: A verifies three entry technologies, admission-before-wake, Location runner placement and explicit provider streaming; B verifies legacy transport and auth/lifecycle ownership; C verifies separate config paths and settings-loader ownership; D verifies Protocol→Server, Server→Core, admission→projection, projection→table and admission-before-wake. Overlapping groups are not summed into a count of independent claims.

Measured knowledge input: A 6,439 bytes/116 lines; B 6,338/111; C 7,393/133; D 5,959/110. A additionally emitted 10,176 source bytes/271 lines and 6,030 search bytes/71 lines. D emitted 12,126 source bytes/308 lines and 7,345 search bytes/89 lines. Search output repeats some later excerpts, and is deliberately counted as context overhead.

B/C original source-output bytes are unavailable reliably: initial batched reads exceeded output limits. Do not treat tool token estimates as actual consumed tokens. One overly large legacy config read and incorrect filename guesses remain investigator overhead. They are not attributed to the knowledge design.

## 4. Knowledge-first versus discovery-first

The same questions were completed in a controlled local discovery replay using filename discovery and source excerpts, without loading knowledge in that replay. Prior exposure cannot be erased, so this is **not a blind cold-start experiment**. Fresh-agent attempts failed before investigation because of the account usage limit. No elapsed-time or token-savings conclusion is justified.

| Task/mode          | Knowledge files / bytes | Source bodies opened | Search pipelines | Repository-package filename inventories | Repository-wide content scans | Measured source + search output |
| ------------------ | ----------------------: | -------------------: | ---------------: | --------------------------------------: | ----------------------------: | ------------------------------- |
| B knowledge-first  |               3 / 6,338 |                    4 |                4 |                                       0 |                             0 | Not reliably captured           |
| B discovery replay |                   0 / 0 |                    4 |                3 |                                       1 |                             0 | 10,078 + 5,518 = 15,596 bytes   |
| C knowledge-first  |               4 / 7,393 |                    6 |                6 |                                       0 |                             0 | Not reliably captured           |
| C discovery replay |                   0 / 0 |                    5 |                4 |                                       1 |                             0 | 12,264 + 12,359 = 24,623 bytes  |

Discovery B had one zero-result schema search, retained in the count. Discovery C avoided the provider.ts dead end, but prior exposure can explain that difference. Both modes reached the same source-level registration/configuration relationships. Neither established exhaustive absence of other adapters or configuration sources.

Successful initial discovery pipelines:

```sh
rg --files packages | rg '/src/(.*/)?mcp(/|\.ts$)'
rg --files packages | rg '/src/.*(config/.*provider|config\.ts$|/provider\.ts$)'
```

They returned 13 and 24 path candidates respectively. The second directly surfaced config/plugin/provider.ts. These are cheap package filename inventories, not broad source-content reads. Discovery still needed source verification, as did knowledge-first.

An earlier investigator replay used incorrect glob combinations and produced 9,664 lines, with truncation. Those failed attempts are excluded from this later controlled replay and are not evidence of knowledge savings. The original audit notes retain that mistake. The table is an observed work comparison, not an equal-operator randomized benchmark.

Conclusion: knowledge helped establish ownership and migration context, but fewer source reads, fewer searches and lower total context were **not demonstrated**. Its known additional input is 6–7 KB for B/C. A better controlled future test would use matched fresh agents and predeclared answer criteria, with exact output capture in both arms.

## 5. Accuracy and staleness findings

| Classification               | Claim / finding                                           | Evidence                                                                                                                                  |
| ---------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| VERIFIED                     | CLI yargs, web Solid, desktop Electron entry paths exist  | `packages/opencode/src/index.ts:1,45`; `packages/app/src/entry.tsx:4,164`; `packages/desktop/src/main/index.ts:9,255`                     |
| VERIFIED                     | Session admission precedes conditional wake               | `packages/core/src/session.ts:360–383`                                                                                                    |
| VERIFIED                     | Local execution resolves Session/Location before running  | `packages/core/src/session/execution/local.ts:14–28`                                                                                      |
| VERIFIED                     | Protocol→Server→Core prompt relationship                  | `packages/protocol/src/groups/session.ts:205`; `packages/server/src/handlers/session.ts:140`; Core path above                             |
| VERIFIED                     | SQLite/Drizzle Session tables and projection              | `packages/core/src/session/sql.ts:140`; `packages/core/src/session/projector.ts:362`; `packages/core/src/session/input.ts:82–119`         |
| VERIFIED                     | Optional Basic auth and middleware enforcement            | `packages/server/src/auth.ts`; `packages/server/src/middleware/authorization.ts:41–54`                                                    |
| VERIFIED                     | Legacy MCP owner, transports and lifecycle                | `packages/opencode/src/mcp/index.ts:218,269,347,492,641`; CLI and HTTP paths in B                                                         |
| VERIFIED                     | Core and legacy config paths are distinct                 | Six-file trace in C; especially `packages/core/src/config/plugin/provider.ts:9–61`                                                        |
| PARTIALLY VERIFIED           | Tool/integration/plugin ownership prose                   | `packages/core/src/tool/registry.ts:40,85,106` supports registry ownership; not every plugin/integration lifecycle was traced             |
| PARTIALLY VERIFIED           | Package dependency cards                                  | Match dependencies declarations; not complete runtime/build relationships. Desktop renderer imports app/ui declared in devDependencies    |
| STALE under simulated change | Index/workflows still name deleted web entry after update | Temporary deletion of `packages/app/src/entry.tsx`; update exit 0; validate returns []                                                    |
| INCORRECT freshness result   | Credential implementation edit is called current          | `script/knowledge/update.ts:36` excludes explicit security anchor `packages/core/src/credential.ts`; status affected:none and validate [] |
| AMBIGUOUS provenance         | Valid-shaped fabricated verification commit accepted      | Replace metadata commit with 40 hexadecimal a characters; validate []; only syntax is checked                                             |

The two simulated defects are not claims that the real entry file is currently missing or the current curated prose already contradicts source. They demonstrate validation promises the implementation cannot uphold.

## 6. Context efficiency

The corpus is small enough for selective use, but size alone is not navigation value.

- Total: 44 documents, 34,677 bytes.
- Index: 4,060 bytes, 65 lines, largest document.
- Next largest: security 1,362; architecture 1,271; opencode package 1,184; workflows 1,108; integrations 1,094 bytes.
- Frontmatter plus its following blank separator: 14,759 bytes, 42.56% of corpus. Excluding that one blank newline per file: 14,715 bytes.
- Index repeats all 43 related IDs and their human-readable links. Concern documents repeat source_paths in prose. This is duplication, not source-code copying.
- Core card lists only the first 24 of 81 alphabetical source areas, stopping at git.ts: session, system-context and tool disappear from its summary. Architecture partially compensates, but the package card's selection prioritizes alphabetic order over task importance.
- Package cards mostly provide manifest facts and names, rather than purpose, used-by relationships or exact behavior anchors. A cheap filename query can supply some of the same information.

No giant generated essay or source implementation copy was found in the sampled knowledge. No token telemetry was available. Per-document measurements are in Appendix A.

## 7. Incremental, validation and privacy verification

Independent fixtures used actual temporary Git repositories. Existing tests were also run, but were not treated as proof of completeness.

| Scenario                                                | Observed result                                                                                                |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Unstaged source edit                                    | status names module-packages-example; validation stale; update changes its document                            |
| Staged source edit                                      | Same affected module; detected from current contents                                                           |
| Committed edit                                          | Existing regression passes; fingerprints survive commit transitions                                            |
| Nonignored untracked relevant file                      | Affected module detected and regenerated                                                                       |
| Rename / rename containing spaces                       | Git rename is reported; document fingerprint changes; new paths reflected                                      |
| Ordinary file deletion                                  | Existing regression detects changed inventory and removes entry candidate                                      |
| Package deletion                                        | Generated document retired, index updated; declared related ID cleared                                         |
| Package deletion status                                 | Names surviving affected documents/index, but does not explicitly name retired document in affected list       |
| Architecture anchor deletion/move                       | Missing curated anchor rejects update before writing; existing deletion test and independent move probe passed |
| Ignored file, including forced tracked ignored file     | Excluded by Git ignore check; no fingerprint effect                                                            |
| credentials.json / secret-like values                   | Excluded in generation and update; sentinel contents absent from generated output                              |
| Executable credential.ts                                | FAIL: excluded too; edit leaves all documents current                                                          |
| Malformed frontmatter, duplicate IDs, broken related ID | Existing negative tests reject these cases                                                                     |
| Hand-edited prose                                       | Expected rendering comparison rejects stale/edited output                                                      |
| Deleted hardcoded body reference                        | FAIL: index/workflows web entry survives; validate passes after update                                         |
| Fabricated well-shaped commit metadata                  | Accepted; provenance existence not checked                                                                     |
| Symlink / generated directories                         | Existing regression confirms exclusion                                                                         |
| Transitive source dependency change                     | No general dependent-document propagation; discussed below                                                     |

Real working-tree no-op checks captured SHA-256 and nanosecond mtimes of every knowledge file before/after, plus git diff --binary:

| Invocation                  | Exit | Documents rewritten | Changed hashes | Changed mtimes | Tracked Git diff stable | Elapsed wall time |
| --------------------------- | ---: | ------------------: | -------------: | -------------: | ----------------------- | ----------------: |
| First bun knowledge:update  |    0 |                0/44 |              0 |              0 | Yes                     |           0.707 s |
| Second bun knowledge:update |    0 |                0/44 |              0 |              0 | Yes                     |           0.302 s |

Timings are these two samples only; they are not benchmark distributions. No timestamp, ordering or fingerprint churn occurred.

Privacy: generated Markdown had zero matches for the tested private-key headers, OpenAI/GitHub token shapes, AWS access-ID shape and fixture sentinels. The implementation emits paths, dependency names, task names and curated notes rather than source contents, dependency URLs or command values. Test data verified secret/ignored value exclusions on both generation and update. No actual secret values were opened or printed for this audit. Pattern scans do not prove absence of every possible secret; sensitive package/file names or manually authored notes remain potential metadata channels. No external model/network enrichment was found.

## 8. Agent instruction review

`AGENTS.md:433–440` clearly says to read index first, select relevant documents, verify source/tests, review the catalog after changes and run update/validate. The shortest decisive phrases are “source wins on disagreement” and “Do not load every knowledge document by default.”

All seven requested behaviors are present. The block is only eight lines of guidance but is near the end of a 440-line instruction file, so placement may reduce visibility for an agent that truncates instructions. That is a usability risk, not observed evidence of agents ignoring it. Sampled nested AGENTS files did not contradict it. CONTRIBUTING links AGENTS. Nested app/desktop/opencode/core-tool instructions are not routed from package cards; agents still need the normal ancestor-instruction workflow.

This audit explicitly instructed agents to use knowledge first. It establishes that the flow is feasible, not that agents naturally adopt it without prompting across future tasks. The workflow phrase “Agent context starts here” is mildly ambiguous; root guidance consistently points to index first.

## 9. Weaknesses and impact limitations

1. **False freshness for credential source.** Secret-value filename exclusion also matches a security implementation explicitly listed in the catalog. Privacy policy and executable-source hashing need separate handling; do not simply allow every secret-like file.
2. **Body references bypass path validation.** Validator checks metadata source_paths; index hardcodes execution paths but fingerprints only package.json. Updating the package card does not repair the index claim. Workflows repeats the same untracked entry references.
3. **Missing behavior anchors.** B needed CLI/HTTP/init anchors; C needed config/plugin/provider.ts and plugin/internal.ts. These are concrete search costs, not a request for a general graph system.
4. **Truncated package cards omit important components.** Core's alphabetical cutoff hides its principal execution domains. “Entry candidates” is a four-path heuristic, not resolution of manifest exports/bin.
5. **Relations are not impacts.** Editing Schema source does not reconsider Client/Server cards through dependencies. This is not automatically wrong: those cards currently contain mostly manifest inventories. A full transitive source graph is low priority until claims depending on upstream semantics exist.
6. **Concrete missing runtime/build edges.** Desktop renderer `packages/desktop/src/renderer/index.tsx:17,32,33` imports app/ui, but its card has related:[] because the packages are devDependencies. Client's generation dependencies on Core/Server/codegen are similarly absent. Explicitly labeled build/bundled-runtime edges would be useful; merging all devDependencies into runtime would be inaccurate.
7. **Architecture document mapping gap.** No topic observes docs/architecture, despite directing readers there. A change to docs/architecture/v1-v2-parity.md invalidates no knowledge document. That directory is currently pre-existing untracked user content, so automatically making it a mandatory anchor would require a deliberate repository decision.
8. **Retirement/provenance limitations.** Status omits names of retired documents. A deleted workspace dependency can silently drop from the related inventory while the surviving package manifest still declares it. A fabricated valid-shaped commit is accepted; shallow history makes unconditional object-existence checks unsuitable.

Overall impact improvements: exact anchors and credential/index fixes are important; selective build/runtime relationships are useful; a universal transitive/AST graph is currently unnecessary. No vector database, embeddings, provider API or new dependency is justified by these results.

## 10. Prioritized improvements

### P0 — critical correctness

None demonstrated. The audited system does not execute application behavior, and the audit found no exposed secret value or production outage. The freshness defects below still require correction before advertising comprehensive integrity validation.

### P1 — directly supported correctness and high-value navigation

- Preserve actual secret-value exclusion while fingerprinting known executable credential source; add the missed-source regression.
- Make entry/body references explicit validated dependencies, and either update deterministic references or fail on a deleted anchor. Add the demonstrated deleted-web-entry regression.
- Add a few exact MCP registration/init and provider config consumer/boot anchors to the appropriate topic notes. This is a small curation proposal; benchmark it before wider redesign.

### P2 — optional optimization / clearer limits

- Prefer important source areas over an alphabetical first-24 list, with selected package purpose and used-by information.
- Reduce duplicate routing metadata in agent-visible index and repeated source-path lists.
- Label useful bundled-runtime/build edges, surface applicable nested AGENTS, and clarify retirement/provenance status.
- Decide whether architecture maps should be formal observed inputs.
- Repeat B/C with matched fresh agents and complete output telemetry. Current evidence does not support a percentage savings claim.

## 11. Changes made and verification

No implementation changes were made during the audit. Added only this report. Application source, tooling, generated knowledge, hooks and instructions were left unchanged during the audit. Pre-existing local edits were preserved. Temporary Git repositories/scripts/logs were created under /tmp; no real-tree source mutations were used.

Passing checks, exact working directory `/Users/home/Projects/opencode-dev`:

```sh
bun knowledge:test
bun knowledge:typecheck
bun knowledge:validate
bun knowledge:check
bun run eslint script/knowledge/*.ts
bun run oxlint script/knowledge
bun run prettier --check script/knowledge package.json
```

Tests: 5 pass, 0 fail, 25 assertions. Test wrapper executes bun test in `/Users/home/Projects/opencode-dev/script/knowledge`; typecheck wrapper runs the package typecheck command in that same directory. ESLint passes with the existing `.eslintignore` unsupported warning; oxlint has zero warnings/errors. No unrelated application suites were run for this read-only audit.

Independent reproductions, same root working directory:

```sh
bun /tmp/knowledge-audit.ts
bun /tmp/knowledge-audit-extra.ts > /tmp/knowledge-audit-extra.log
bun /tmp/knowledge-audit-status.ts > /tmp/knowledge-audit-status.log
```

Audit evidence files retained locally: `/tmp/knowledge-audit-A.json`, `/tmp/knowledge-audit-D.json`, `/tmp/knowledge-discovery-B.json`, `/tmp/knowledge-discovery-C.json`, `/tmp/knowledge-audit-noop.json`, `/tmp/knowledge-audit-sizes.json`, `/tmp/knowledge-audit-privacy.json`, and the reproduction logs above. These contain the command ledger/measurements; A/D and discovery ledgers also retain the exact source excerpts read. They are temporary evidence, not additional agent context or knowledge documents.

Verification failures classified: none in existing test/typecheck/lint commands; two independently reproduced integrity defects; one provenance limitation; investigator filename/output mistakes explicitly disclosed; fresh-agent comparison blocked by account usage limits. No application correctness or V1/V2 parity conclusion is inferred from knowledge validation.

## 12. Final evidence and answers

The completed attachment repeated the same audit scope and supplied the full final-report requirements. The previous investigations were retained rather than repeating repository discovery. Current-state revalidation confirmed the same 44 documents / 34,677 bytes and reproduced both freshness defects. Existing test/typecheck/validation/check commands were rerun successfully; two further updates again preserved every document hash/mtime and the tracked Git diff.

Exact revalidation commands, working directory `/Users/home/Projects/opencode-dev`:

| Command                                                                      | Result                                                                          |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `bun knowledge:test`                                                         | Exit 0; 5 pass, 0 fail, 25 assertions                                           |
| `bun knowledge:typecheck`                                                    | Exit 0; package typecheck passes                                                |
| `bun knowledge:validate`                                                     | Exit 0; 44 documents valid under current checks                                 |
| `bun knowledge:check`                                                        | Exit 0; affected:none, unchanged:44                                             |
| `bun knowledge:update` (twice)                                               | Each exit 0; 0/44 rewritten; SHA-256, mtimes and tracked diff stable            |
| `bun /tmp/knowledge-audit-extra.ts > /tmp/knowledge-audit-extra-recheck.log` | Exit 0; missed credential edit and surviving deleted entry reference reproduced |

The reproduction exits successfully because it records the observed defects; this is not a claim that those behaviors meet the integrity requirements. Formatter/linter results and exact commands are listed in section 11. The only repository write in this follow-up is this report update.

| Final question                                           | Evidence-based answer                                                                                                                                                                                                             |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does knowledge materially reduce repository exploration? | Not demonstrated. All four knowledge-first tasks avoided repository-wide content scans, but discovery replays did too; B/C needed comparable source reads and less navigation input. The replay is not a blind causal comparison. |
| Do agents consume it selectively?                        | Yes in the instructed trials: 3–4 of 44 documents per task. Natural unprompted adoption was not measured.                                                                                                                         |
| Does it preserve source verification?                    | Yes in these trials: agents read implementation paths before answering. No behavioral claim was accepted solely because validation passed.                                                                                        |
| Is the index an effective router?                        | Partially. It directs readers to owners and concerns, but package roles and exact MCP/configuration behavior anchors remain too shallow to eliminate follow-up searches.                                                          |
| Are path-based impact blind spots measurable?            | Yes. A credential implementation edit is invisible; a deleted web entry survives in prose after update. Runtime/build dependency omissions and missing architecture-document inputs add narrower limitations.                     |
| What should improve next?                                | Fix the two reproduced integrity defects with regressions, then add the demonstrated MCP/configuration anchors and measure again. Do not introduce a new graph platform or claim token savings from the present evidence.         |

## Appendix A — every knowledge document

Bytes are UTF-8 filesystem sizes; lines are splitlines counts. Paths are relative to the repository root above.

| Path                                                  | Bytes | Lines |
| ----------------------------------------------------- | ----: | ----: |
| `.knowledge/architecture.md`                          |  1271 |    25 |
| `.knowledge/configuration.md`                         |  1078 |    28 |
| `.knowledge/index.md`                                 |  4060 |    65 |
| `.knowledge/integrations.md`                          |  1094 |    26 |
| `.knowledge/module-github.md`                         |   435 |    20 |
| `.knowledge/module-packages-app.md`                   |  1091 |    20 |
| `.knowledge/module-packages-cli.md`                   |   650 |    20 |
| `.knowledge/module-packages-client.md`                |   596 |    20 |
| `.knowledge/module-packages-codemode.md`              |   587 |    20 |
| `.knowledge/module-packages-console-app.md`           |   826 |    20 |
| `.knowledge/module-packages-console-core.md`          |   995 |    20 |
| `.knowledge/module-packages-console-function.md`      |   672 |    20 |
| `.knowledge/module-packages-console-mail.md`          |   467 |    20 |
| `.knowledge/module-packages-console-resource.md`      |   484 |    20 |
| `.knowledge/module-packages-console-support.md`       |   612 |    20 |
| `.knowledge/module-packages-core.md`                  |  1071 |    20 |
| `.knowledge/module-packages-desktop.md`               |   587 |    20 |
| `.knowledge/module-packages-effect-drizzle-sqlite.md` |   593 |    20 |
| `.knowledge/module-packages-effect-sqlite-node.md`    |   519 |    20 |
| `.knowledge/module-packages-enterprise.md`            |   702 |    20 |
| `.knowledge/module-packages-function.md`              |   471 |    20 |
| `.knowledge/module-packages-http-recorder.md`         |   680 |    20 |
| `.knowledge/module-packages-httpapi-codegen.md`       |   510 |    20 |
| `.knowledge/module-packages-llm.md`                   |   629 |    20 |
| `.knowledge/module-packages-opencode.md`              |  1184 |    20 |
| `.knowledge/module-packages-plugin.md`                |   558 |    20 |
| `.knowledge/module-packages-protocol.md`              |   526 |    20 |
| `.knowledge/module-packages-schema.md`                |   858 |    20 |
| `.knowledge/module-packages-script.md`                |   454 |    20 |
| `.knowledge/module-packages-sdk-js.md`                |   537 |    20 |
| `.knowledge/module-packages-sdk-next.md`              |   615 |    20 |
| `.knowledge/module-packages-server.md`                |   628 |    20 |
| `.knowledge/module-packages-session-ui.md`            |   655 |    20 |
| `.knowledge/module-packages-slack.md`                 |   486 |    20 |
| `.knowledge/module-packages-stats-app.md`             |   694 |    20 |
| `.knowledge/module-packages-stats-core.md`            |   756 |    20 |
| `.knowledge/module-packages-stats-server.md`          |   591 |    20 |
| `.knowledge/module-packages-storybook.md`             |   468 |    20 |
| `.knowledge/module-packages-tui.md`                   |   849 |    20 |
| `.knowledge/module-packages-ui.md`                    |   563 |    20 |
| `.knowledge/module-packages-web.md`                   |   546 |    20 |
| `.knowledge/module-sdks-vscode.md`                    |   559 |    20 |
| `.knowledge/security.md`                              |  1362 |    28 |
| `.knowledge/workflows.md`                             |  1108 |    26 |

## Appendix B — post-audit remediation

Sections 5, 9 and 12 describe the tree as audited. Both reproduced freshness defects and the two
demonstrated anchor gaps were remediated afterwards in `script/knowledge/update.ts`,
`script/knowledge/catalog.ts` and `script/knowledge/update.test.ts`. The audit findings above remain
the historical record; this appendix records the fixes and their verification. No application source
was changed.

| Audit finding                                             | Fix                                                                                                                                                                        | Regression                                                                                                                                                                                                                                                    |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Credential implementation excluded from fingerprints (#1) | `eligible()` allows exactly `packages/core/src/credential.ts` to be hashed while the secret-value filename/extension rules stay in force; contents are still never emitted | Sentinels in `credential.ts`, `credentials.json`, `secrets.ts` and `.env.local`: the implementation edit makes `check` exit 1 with `security.md`/`module-packages-core.md` stale, the value files stay undiscovered and neither sentinel reaches any document |
| Deleted web entry survives in index/workflow prose (#2)   | `update`/`init` refuse to write when any catalog anchor path is absent, and validation reports `missing source <path>; review catalog`                                     | Delete and move of each advertised entry (`packages/opencode/src/index.ts`, `packages/app/src/entry.tsx`, `packages/desktop/src/main/index.ts`) fail before writing and leave every existing document byte-identical                                          |
| Missing MCP registration/init anchors                     | `integrations` topic paths plus curated notes name `cli/cmd/mcp.ts`, the HTTP MCP handler, `mcp/index.ts` and `MCP.add`                                                    | Anchor deletion is reported by validation and blocks `update`                                                                                                                                                                                                 |
| Missing provider config consumer/boot anchors             | `configuration` topic paths plus curated notes name `config/plugin/provider.ts` and `plugin/internal.ts`                                                                   | Same                                                                                                                                                                                                                                                          |

Verification, exact working directory `/Users/home/Projects/opencode-dev`:

```sh
bun knowledge:test          # 15 pass, 0 fail, 124 assertions
bun knowledge:typecheck     # exit 0
bun knowledge:validate      # Knowledge valid (44 documents)
bun knowledge:check         # affected: none, unchanged: 44
bun run eslint script/knowledge/*.ts
bun run oxlint script/knowledge
bun run prettier --check script/knowledge package.json
```

Current size: 44 documents, 36,481 bytes (`index.md` 65 lines); the increase over 34,677 bytes is the
added validated anchors and note text. Unchanged from the audit: the knowledge-first-versus-discovery
measurement conclusions (no token-savings claim), the P2 items (important-over-alphabetical source
areas, deduplicated routing metadata, labeled build/runtime edges, `docs/architecture` observation,
matched fresh-agent re-benchmark), and the provenance limitations in section 9.8.
