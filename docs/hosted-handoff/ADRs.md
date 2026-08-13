# Architecture Decision Records

These decisions are proposed for the hosted product handoff. They do not silently ratify or replace existing repository ADRs. A maintainer should mark each record Accepted, Rejected, or Superseded during implementation kickoff.

## ADR-H01: Launch as a text-first single-player web game

**Status:** Proposed  
**Date:** 2026-08-06

### Context

The engine contains more simulation surface than a first subscription product needs. A full VTT would introduce map rendering, token state, multiplayer synchronization, and a larger frontend before the core DM loop is validated.

### Decision

Launch with a browser narrative log, freeform action composer, character status panel, and server-side rules resolution. Support one player-owned campaign by default.

### Consequences

- Faster path to a usable paid product.
- The core value proposition is measurable.
- Existing map and spatial code remain available for later work.
- Tactical players may find the first release intentionally lightweight.

### Rejected alternatives

- Full PixiJS/Three.js VTT at launch.
- Multiplayer-first architecture.
- Rebuilding the existing Tauri client as the web frontend.

## ADR-H02: Open5e is research-only

**Status:** Proposed  
**Date:** 2026-08-06

### Context

The local Open5e MCP is useful for looking up monsters, classes, spells, equipment, and source documents. It is not the RPG engine and should not become a live gameplay dependency.

### Decision

Use Open5e MCP during development to verify and transcribe a deliberately selected ruleset. Store reviewed, engine-native data in the repository. Do not ship an Open5e adapter, Open5e API client, live cache, or MCP subprocess in the hosted request path.

### Consequences

- Gameplay remains available if Open5e is unavailable.
- Runtime behavior is deterministic and version-controlled.
- Rules updates require an intentional transcription review.
- The project owns the responsibility of recording source and license attribution.

### Rejected alternatives

- Fetching monster and spell definitions on every turn.
- Letting the LLM query Open5e directly during play.
- Mixing Open5e 2014 and 2024 records based on search defaults.

## ADR-H03: Pin the first ruleset to the 2014/SRD-compatible engine behavior

**Status:** Proposed  
**Date:** 2026-08-06

### Context

The current engine already models familiar 2014-style concepts such as spell slots and existing class progression. Open5e can return multiple content versions for similar names.

### Decision

The first shipped ruleset is explicitly identified as 2014/SRD-compatible. Every transcribed record carries its source document, slug, and review date. A future 2024 ruleset is a separate compatibility target, not an automatic replacement.

### Consequences

- Fewer hidden rules conflicts.
- Tests can assert precise source fixtures.
- Future rulesets require explicit adapters or separate data namespaces.

## ADR-H04: The server is authoritative for mechanics

**Status:** Proposed  
**Date:** 2026-08-06

### Context

The LLM is good at language, interpretation, and narrative, but it is not a reliable state machine. Letting it decide outcomes would undermine player trust and make support/debugging difficult.

### Decision

The server interprets candidate actions, applies rules, rolls dice, persists an event, and passes the result to the LLM for narration.

### Consequences

- Players can inspect outcomes.
- Events can be replayed and audited.
- LLM provider changes do not change mechanical history.
- The action interpreter and rules facade become important test surfaces.

## ADR-H05: Web and MCP are separate adapters over a constrained domain boundary

**Status:** Proposed  
**Date:** 2026-08-06

### Context

The existing MCP registry is broad and currently coupled to global storage and module-level state. A browser product needs a smaller authenticated API.

### Decision

Retain MCP as a compatibility adapter. Add a hosted HTTP adapter that calls explicit domain services. Do not expose the entire MCP registry through HTTP.

### Consequences

- Existing MCP users are not needlessly broken.
- Hosted authorization can be designed around player actions.
- Domain facades must be extracted before broad reuse is safe.

## ADR-H06: Hosted state is isolated from legacy global SQLite state

**Status:** Proposed  
**Date:** 2026-08-06

### Context

The current database singleton, default session, and direct handler queries are not a safe multi-user foundation. Retrofitting ownership into every existing table is larger than the first product slice.

### Decision

Use a separate hosted database file and hosted tables keyed by verified user ID and campaign ID. Reuse pure rules services where safe; do not reuse global state implicitly.

### Consequences

- The private beta can ship with a clear isolation boundary.
- Existing local MCP behavior remains stable.
- Some data duplication exists until a later domain migration.
- A future Postgres migration can target the hosted schema independently.

## ADR-H07: Clerk is identity; Stripe webhooks are entitlement

**Status:** Proposed  
**Date:** 2026-08-06

### Context

Authentication and payment state have different sources of truth. The browser must not be trusted to report either one.

### Decision

Clerk verifies identity and supplies the user ID. Stripe Checkout creates subscriptions. Verified, idempotent Stripe webhooks update the local entitlement record. The browser return URL never grants access by itself.

### Consequences

- Authentication and billing responsibilities are clear.
- Webhook replay and delayed events must be handled.
- Test mode and production mode need separate configuration.

## ADR-H08: Railway first; SQLite volume for private beta

**Status:** Proposed  
**Date:** 2026-08-06

### Context

The user already uses Railway. Postgres and Redis would increase operational complexity before demand is known.

### Decision

Deploy one Railway service with a persistent volume and a separate hosted SQLite database for the private beta. Define migration triggers for Postgres rather than pre-building the migration.

### Migration triggers

- More than one application instance is required.
- Database locking becomes visible in user-facing latency.
- Restore testing cannot meet the recovery target.
- Campaign volume or analytics needs exceed the single-volume model.

## ADR-H09: No live Open5e content in production

**Status:** Proposed  
**Date:** 2026-08-06

### Context

Live content requests create availability, version drift, attribution, and latency risks. They also make a player's outcome depend on an external service.

### Decision

Production uses only reviewed rules data shipped with the engine. Open5e is not in health checks, gameplay requests, or DM tools.

## ADR-H10: Defer multiplayer and the VTT

**Status:** Proposed  
**Date:** 2026-08-06

### Context

Multiplayer and tactical maps change the aggregate, realtime, authorization, and frontend requirements substantially.

### Decision

Treat multiplayer campaigns and tactical visualization as post-MVP epics. Preserve campaign ownership and event boundaries so they can be added later.
