# Risk Register

| ID | Risk | Severity | Signal | Mitigation | Owner |
|---|---|---:|---|---|---|
| R-01 | Cross-user campaign or character access | Critical | A user can load an ID they do not own | Separate hosted store; verified user and campaign predicates; two-account tests | TBD |
| R-02 | LLM invents mechanical outcomes | High | Transcript disagrees with event state | Server-authoritative event pipeline; narration receives resolved facts only | TBD |
| R-03 | Ruleset version drift | High | Same name resolves to different source/version | Pin 2014-compatible ruleset; source and slug recorded per transcribed record | TBD |
| R-04 | Stripe return URL grants access incorrectly | High | User can play before webhook entitlement | Grant only from verified idempotent webhook state | TBD |
| R-05 | Duplicate player action | High | One action causes two attacks or spends | Client/request idempotency key and event uniqueness | TBD |
| R-06 | Narration failure after mechanical success | Medium | Player retries and repeats an action | Persist event before narration; retry narration separately | TBD |
| R-07 | SQLite loss or corruption | High | Volume unavailable or restore fails | Separate hosted file, WAL discipline, scheduled backups, restore drills | TBD |
| R-08 | LLM cost runaway | High | Cost per active user exceeds plan margin | Usage ledger, per-turn budget, max output, provider timeout, alerts | TBD |
| R-09 | Prompt injection or malicious player text | Medium | DM reveals system instructions or ignores rules | Treat player text as untrusted; strict narration contract; no secret context | TBD |
| R-10 | Secrets exposed in browser | Critical | Key appears in page source or network payload | Server-only keys; production asset scan; no direct browser model calls | TBD |
| R-11 | Scope expands into a VTT before retention is known | High | Map/multiplayer work blocks first playable loop | ADR-H01 and P0/P1/P2 backlog discipline | Product |
| R-12 | Content licensing or attribution error | High | Source or license cannot be traced | Record source metadata; legal review before public launch | TBD |
| R-13 | Open5e availability becomes a runtime dependency | Medium | Gameplay fails when Open5e is unavailable | Research-only policy; ship transcribed data | TBD |
| R-14 | Provider outage or slow response | Medium | DM latency or timeout rate rises | Retry narration only; provider abstraction; user-safe fallback | TBD |
| R-15 | MCP and hosted behavior diverge | Medium | Same action resolves differently by transport | Shared domain services and cross-adapter fixtures | TBD |
| R-16 | Domain/DNS misconfiguration | Medium | Railway service healthy but public domain fails | Validate Railway URL first; then Namecheap DNS; document rollback | Ops |

## Risk review cadence

Review P0 and Critical risks at every release candidate. Close a risk only when the mitigation is tested, not merely documented.
