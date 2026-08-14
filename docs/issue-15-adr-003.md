## ADR-003: Domain Service/Facade Boundary

### Status
Accepted (phased boundary)

### Context
Consolidated MCP handlers currently include direct persistence access patterns (e.g., direct DB/repository calls).

### Problem
Transport-layer handlers directly coupling to DB lifecycle/persistence details increases test friction and architectural rigidity.

### Decision
Introduce **domain service/facade interfaces** between MCP handlers and repositories:
- Server/tool handlers depend on service interfaces
- Services coordinate domain operations and repository calls
- Storage layer owns DB lifecycle and repository implementation details

The first migration covers the inventory, world, and consolidated combat
handlers through `src/server/domain-services.ts`. The facade is injectable via
`runWithDomainServices`, and production resolution still uses the verified
tenant-scoped database from storage. Remaining handlers migrate as they are
changed; new handlers must not open databases or construct repositories.

### Consequences
**Positive**
- Improved separation of concerns
- Better testability via service mocks
- Cleaner boundaries for future transport/runtime changes

**Trade-offs**
- Additional abstraction layer and wiring
- Requires phased migration to avoid regressions

### Acceptance Criteria
- [x] Combat, world, and inventory handlers route through service facades first
- [x] Consolidated handlers in those domains no longer call `getDb()` directly
- [x] Unit tests can inject a facade without changing storage globals
- [x] Architecture docs updated with boundary contracts

### Source
Architecture analysis: `docs/ARCHITECTURE-CODEBASE-ANALYSIS.md`
