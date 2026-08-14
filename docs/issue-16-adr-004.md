## ADR-004: Legacy Tool Surface Strategy (Deprecate vs Compatibility Mode)

### Status
Accepted

### Context
The consolidated runtime path is active, while `src/server/tools.ts` remains as a legacy-style tool surface.

### Problem
Without explicit policy, dual surfaces increase maintenance cost and risk behavior divergence.

### Decision
Retain **compatibility mode**. The consolidated MCP tools are the only public
registration surface. `src/server/tools.ts` remains an internal adapter for
the world-map implementation until that implementation is migrated behind the
same contract, and no new public legacy tools may be added.

The supported adapter matrix is the seven world-map operations listed in
`src/server/legacy-surface-policy.ts`. Each entry maps to one
`world_map` action and is covered by a parity test. The adapter may be removed
only after the consolidated implementation no longer imports it and a staged
migration note is published.

### Consequences
**If deprecate**
- Lower long-term maintenance and less drift risk
- Requires migration communication for any dependents

**If retain compatibility**
- Better short-term backward compatibility
- Ongoing parity testing/maintenance overhead

### Acceptance Criteria
- [x] ADR finalized with selected option
- [x] README/docs updated with the decision
- [x] If retained: parity test matrix for critical workflows
- [x] If deprecated: staged removal plan and timeline

### Source
Architecture analysis: `docs/ARCHITECTURE-CODEBASE-ANALYSIS.md`
