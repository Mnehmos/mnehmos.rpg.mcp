# Hosted Product Architecture

## 1. Architectural intent

The hosted application should be a narrow product boundary around the existing RPG engine. The current MCP server remains useful, but its global state and broad tool surface must not be exposed directly to paid browser users.

~~~text
Browser
  → Hosted HTTP application
      → Auth and entitlement middleware
      → Hosted game facade
          → Tenant-scoped campaign store
          → Server-authoritative rules services
          → DM narration provider
      → Static web assets

Local MCP clients
  → Existing MCP adapter and transports
      → Shared domain services as they become safe to reuse
~~~

Open5e is a development-time research source only:

~~~text
Open5e MCP during development
  → reviewed transcription
  → engine-native rules data
  → production gameplay
~~~

There is no Open5e request in the player turn path.

## 2. Repository boundary

### Keep

- Existing dice and combat logic.
- Existing spell, condition, character, inventory, and world concepts.
- Existing MCP registry for local compatibility.
- Existing test fixtures that describe engine behavior.

### Isolate

- Global database access.
- Legacy direct repository calls from handlers.
- Module-level world, combat, and session state.
- Experimental or unused legacy surfaces.
- Local-only desktop and older browser clients.

### Add as a separate hosted boundary

- Authenticated HTTP routes.
- Clerk request context.
- Stripe entitlement service.
- Hosted campaign and message store.
- DM turn orchestration.
- Browser UI.
- Deployment health and operational endpoints.

## 3. Tenant model

The campaign is the primary aggregate. A user owns one or more campaigns. Multiplayer can be added later through campaign membership without changing the ownership concept.

~~~text
Clerk user
  └─ hosted entitlement
  └─ campaigns
       └─ character
       └─ messages
       └─ rules events
       └─ scene state
~~~

Every hosted request gets a verified user ID from Clerk. Client-supplied user IDs, campaign owners, and entitlement status are never trusted.

## 4. Hosted data model

The initial hosted store may use SQLite on a Railway volume, but it should be a separate database file from the legacy RPG database.

### hosted_users

- Internal ID.
- Clerk user ID.
- Display name.
- Created and updated timestamps.

### hosted_entitlements

- Clerk user ID.
- Stripe customer ID.
- Stripe subscription ID.
- Price ID.
- Status.
- Current period end.
- Last verified event ID.
- Updated timestamp.

### hosted_campaigns

- Campaign ID.
- Owner Clerk user ID.
- Name.
- Status.
- Current scene.
- Serialized aggregate state where appropriate.
- Created, updated, and last-played timestamps.

### hosted_characters

- Character ID.
- Campaign ID.
- Owner Clerk user ID.
- Name.
- Class and ancestry.
- Ability scores.
- Level.
- HP and AC.
- Spell slots.
- Conditions.
- Inventory reference.

### hosted_messages

- Message ID.
- Campaign ID.
- Owner Clerk user ID.
- Role: player, DM, system, or rules.
- Content.
- Created timestamp.

### hosted_events

- Event ID.
- Campaign ID.
- Owner Clerk user ID.
- Event type.
- Input summary.
- Authoritative result.
- Ruleset ID.
- Seed or roll evidence where applicable.
- Created timestamp.

All hosted queries must include the authenticated owner boundary and campaign ID.

## 5. HTTP surface

The initial route set should be small:

### Public

- GET / — landing page.
- GET /health — deployment health.
- POST /stripe/webhook — Stripe signature-verified webhook.

### Authenticated

- GET /api/me — identity and entitlement summary.
- GET /api/campaign — active campaign summary.
- POST /api/campaign — create campaign and character.
- GET /api/campaign/transcript — load recent messages.
- POST /api/campaign/message — submit one player action.
- GET /api/character — load character sheet.
- POST /api/billing/checkout — create Stripe Checkout Session.
- POST /api/billing/portal — create Stripe customer portal session.

No hosted route should expose the entire MCP registry.

## 6. DM turn pipeline

~~~text
1. Authenticate Clerk session.
2. Check entitlement and usage allowance.
3. Load campaign using owner ID and campaign ID.
4. Store the player message.
5. Interpret the message into a candidate action.
6. Validate the action against current state and ruleset.
7. Roll and apply the authoritative event.
8. Persist the event and resulting aggregate state.
9. Ask the LLM for narration using only authoritative facts.
10. Store and return the DM response.
~~~

If the LLM fails after step 8, the event remains valid and the player can retry narration without repeating the action.

## 7. LLM boundary

The LLM receives:

- Current scene.
- Character summary.
- Recent transcript.
- Available authoritative facts.
- Ruleset identifier.
- The resolved event.

The LLM does not receive direct database access or unrestricted mutation tools.

For the first version, the LLM may be narration-first while deterministic action interpretation handles the most common actions. Structured tool calling can be added after the hosted boundary is stable.

## 8. Authentication and billing flow

### Authentication

1. Browser signs in through Clerk.
2. Browser sends the Clerk session cookie or bearer token.
3. Backend validates the session.
4. Backend creates request context containing the verified Clerk user ID.

### Checkout

1. Authenticated user requests checkout.
2. Backend creates a Stripe subscription Checkout Session.
3. Clerk user ID is stored in Stripe metadata or client reference data.
4. Browser redirects to Stripe.
5. Webhook verifies the event and updates hosted entitlement.
6. Game access is granted from local entitlement state.

### Cancellation

Subscription status changes arrive through Stripe webhooks. The browser return URL is informational only.

## 9. Deployment shape

### Railway

- One web service for the private beta.
- One persistent volume mounted at a narrow data path.
- Node 20.18.1, matching the repository baseline.
- Service binds to 0.0.0.0 and Railway PORT.
- Health endpoint returns success without authentication.
- Logs include request ID, user-safe event type, campaign ID hash or internal ID, and latency; never secrets or full private prompts.

### Namecheap

Namecheap remains the registrar and DNS provider. The application domain points to Railway. TLS and application routing remain Railway responsibilities.

### Environment categories

Public browser configuration:

- Clerk publishable key.
- Public application URL.

Server-only configuration:

- Clerk secret key.
- Stripe secret key.
- Stripe webhook secret.
- Stripe price ID.
- LLM provider key.
- Hosted database path.

## 10. Failure handling

- Database write succeeds before narration call.
- LLM timeout returns a recoverable “the DM is gathering its thoughts” state.
- Stripe webhook handling is idempotent.
- Duplicate player submissions use an idempotency key.
- Health checks do not depend on the LLM, Stripe, or Open5e.
- Backups are tested by restoring a copy, not merely by checking that a file exists.

## 11. Verification strategy

### Unit tests

- Rules calculations.
- Action interpretation.
- Ownership predicates.
- Entitlement transitions.
- Stripe event idempotency.
- Open5e transcription fixtures.

### Integration tests

- Two users and two campaigns.
- Checkout webhook to entitlement.
- Campaign creation and resume.
- Action persistence followed by narration failure.
- Database restart and restore.

### Browser tests

- Sign in.
- Subscribe in test mode.
- Create character.
- Submit action.
- Observe roll evidence.
- Refresh and resume.
- Cancel subscription and verify access state.

## 12. Migration rule

Do not route hosted HTTP requests through the current consolidated handlers until those handlers accept explicit request context and enforce campaign ownership. A compatibility facade may call existing pure engine services, but it must not inherit the global default session.
