# Delivery and Workflow Management

## 1. Operating principle

Build one playable vertical slice at a time. Every slice must cross the browser, hosted API, persistence, rules, DM response, and verification boundaries before the next major feature begins.

Do not manage this project as a collection of disconnected frontend, backend, and rules tasks.

## 2. Work tracking

Use GitHub issues and pull requests as the source of delivery truth.

Recommended labels:

- area:product
- area:rules
- area:hosted-api
- area:frontend
- area:auth
- area:billing
- area:ops
- area:mcp
- priority:p0
- priority:p1
- priority:p2
- type:adr
- type:bug
- type:feature
- type:research
- type:security
- blocked

Recommended board columns:

~~~text
Inbox → Ready → In progress → Review → Verification → Done
                         ↘ Blocked
~~~

The board should contain outcomes, not vague activity. “Build backend” is not a work item. “A subscriber can create and resume one campaign” is.

## 3. Work item types

### Epic

A user-visible capability spanning multiple vertical slices.

### Story

A narrow player or operator outcome.

### Rules task

A transcription, normalization, or engine behavior change with a source fixture.

### ADR

A decision with meaningful architectural or product consequences.

### Bug

A deviation from an accepted behavior.

### Research

An uncertainty with a time box and an explicit output.

## 4. Definition of Ready

An issue may enter Ready when it has:

- User or operator outcome.
- Scope and non-scope.
- Acceptance criteria.
- Relevant ADR or explicit statement that none is needed.
- Data/privacy impact.
- Verification plan.
- Known dependencies.
- Owner.

## 5. Definition of Done

A work item is Done only when:

- The acceptance criteria pass.
- Focused tests or checks exist.
- Ownership and authorization are tested where relevant.
- Error behavior is defined.
- Logs and metrics do not leak secrets or private prompts.
- Documentation is updated.
- The change is reviewed.
- The relevant staging path has been exercised.

For rules work, Done additionally requires:

- Source document recorded.
- Ruleset version recorded.
- Transcription fixture added.
- Ambiguities resolved or explicitly deferred.

For billing work, Done additionally requires:

- Stripe test-mode event exercised.
- Webhook signature verification tested.
- Duplicate event behavior tested.
- Entitlement transition documented.

## 6. Branch and pull request workflow

Recommended branch names:

- feature/hosted-campaign-loop
- feature/stripe-entitlements
- rules/srd-2014-goblin
- fix/tenant-campaign-scope
- docs/adr-hosted-tenancy

Each pull request should include:

- Problem statement.
- User-visible outcome.
- Scope and non-scope.
- Tests run.
- Screenshots or request examples for UI/API work.
- Data migration and rollback notes.
- Security/privacy notes.
- Follow-up issues.

Do not merge a hosted feature that is only locally tested if it changes auth, billing, tenancy, or persistence behavior.

## 7. Vertical slice sequence

### Slice 1: private shell

Outcome: an authenticated user reaches the hosted application and sees their own empty campaign state.

Verification:

- Clerk session.
- User boundary.
- Health endpoint.
- Two-account isolation.

### Slice 2: character and campaign

Outcome: a subscribed user creates one character and resumes it after refresh.

Verification:

- Entitlement.
- Persistence.
- Ownership.
- Browser refresh.

### Slice 3: first action

Outcome: a player submits a freeform action and receives a stored DM response.

Verification:

- Idempotency.
- Message persistence.
- LLM failure recovery.

### Slice 4: first rule

Outcome: the player makes an inspectable ability check.

Verification:

- Seed or roll evidence.
- Server authority.
- Transcript rendering.

### Slice 5: first combat

Outcome: the player can attack a goblin and see authoritative hit, damage, and HP changes.

Verification:

- Combat fixture.
- Event replay.
- No client-controlled HP.

### Slice 6: paid launch

Outcome: a real test-mode subscriber can subscribe, play, cancel, and resume according to entitlement.

Verification:

- Checkout.
- Webhook.
- Portal.
- Cancellation.
- Support runbook.

## 8. Verification ladder

Use the smallest sufficient verification at each stage:

1. TypeScript build.
2. Focused unit tests.
3. Focused integration tests.
4. Browser smoke test.
5. Staging deployment.
6. Test-mode Stripe flow.
7. Two-account tenancy test.
8. Release checklist.

Do not call a local unit test a production-readiness result.

## 9. Change control

An ADR is required when a change affects:

- Tenant boundary.
- Ruleset version.
- LLM authority.
- Billing entitlement.
- Persistence format.
- Public API contract.
- Deployment topology.
- User privacy or content licensing.

Small implementation choices should remain in the pull request rather than creating unnecessary ADRs.

## 10. Incident workflow

For a user-impacting incident:

1. Record timestamp and affected surface.
2. Preserve request/event IDs.
3. Stop the unsafe path if necessary.
4. Determine whether state or entitlement is at risk.
5. Restore or replay from authoritative events.
6. Communicate user impact honestly.
7. Create a corrective issue.
8. Add a regression test or operational check.

Never repair campaign state by editing production rows without an auditable event or backup.
