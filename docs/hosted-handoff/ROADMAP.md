# Roadmap and Initial Backlog

## Phase 0: product and rules lock

### Outputs

- Product name and domain decision.
- Subscription price and trial decision.
- 2014/SRD-compatible ruleset decision.
- Initial class, ancestry, spell, equipment, and monster lists.
- Hosted API contract.
- Data ownership contract.
- ADR review and acceptance.

### Exit criteria

- No unresolved P0 product ambiguity.
- Rules transcription backlog is bounded.
- A reviewer can explain how a player turn becomes an authoritative event.

## Phase 1: private hosted shell

### Outputs

- Railway service skeleton.
- Health endpoint.
- Static landing and authenticated application shell.
- Clerk request authentication.
- Hosted user and campaign store.
- Two-account isolation tests.

### Exit criteria

- A signed-in user sees only their own state.
- Service survives restart with persistent data.
- No secrets are sent to browser assets.

## Phase 2: subscription and campaign lifecycle

### Outputs

- Stripe Checkout.
- Stripe customer portal.
- Verified and idempotent webhooks.
- Local entitlement records.
- Character creation.
- Campaign creation and resume.

### Exit criteria

- Test-mode subscription grants access.
- Cancellation updates access correctly.
- Duplicate webhook delivery is harmless.
- Unsubscribed users cannot start paid turns.

## Phase 3: DM turn loop

### Outputs

- Player message persistence.
- Deterministic action interpretation for common actions.
- Authoritative event persistence.
- DM narration provider.
- Retry behavior after narration failure.
- Transcript UI.

### Exit criteria

- A player can complete a short scene.
- Refresh does not lose history.
- A failed model request does not duplicate the mechanical event.

## Phase 4: rules and first adventure

### Outputs

- Character checks.
- Goblin encounter.
- Basic attack and damage.
- Rest.
- Conditions.
- Initial spell list.
- Opening adventure.

### Exit criteria

- One complete introductory adventure is playable.
- Rules evidence is visible.
- Rules fixtures pass.
- No live Open5e dependency exists.

## Phase 5: private launch hardening

### Outputs

- Rate limiting.
- Usage ledger.
- Backup and restore runbook.
- Error tracking.
- Support/admin diagnostics.
- Terms, privacy, attribution, and refund language.
- Domain and TLS verification.

### Exit criteria

- Release checklist passes.
- Two-account isolation passes in staging.
- Stripe test-mode lifecycle passes.
- Restore test passes.
- Operator can diagnose a failed turn without reading secrets.

## Prioritized backlog

### P0

- Define hosted API and request context.
- Define hosted schema.
- Separate hosted database path.
- Clerk authentication.
- Stripe entitlement state machine.
- Campaign creation/resume.
- Character creation.
- Player message persistence.
- Server-authoritative action event.
- DM narration and retry.
- Landing page and pricing page.
- Health endpoint.
- Staging deployment.

### P1

- Rules transcription fixtures.
- Goblin combat.
- Basic spellcasting.
- Conditions.
- Usage limits.
- Request idempotency.
- Backups and restore.
- Error tracking.
- Support export.

### P2

- Multiple campaigns.
- Campaign sharing.
- Multiplayer membership.
- Tactical scene view.
- VTT.
- Voice.
- Postgres migration.
- Redis or realtime fanout.
- Remote MCP transport for hosted clients.
