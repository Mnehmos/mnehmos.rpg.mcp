# Hosted Release Checklist

## Product

- [ ] Product name, domain, pricing, trial, refund, and support policy approved.
- [ ] Landing page explains the product in one screen.
- [ ] Player can understand what is included in the subscription.
- [ ] First adventure has an intentional opening and ending.
- [ ] Non-goals are not accidentally presented as supported features.

## Rules and content

- [ ] Ruleset identifier is fixed.
- [ ] Every shipped rules record has source and review metadata.
- [ ] 2014 and 2024 content are not mixed.
- [ ] Goblin, fighter, core checks, attacks, damage, rests, and initial spells have fixtures.
- [ ] Conditions in the first adventure have explicit behavior.
- [ ] Attribution and licensing review is complete.

## Authentication and tenancy

- [ ] Clerk production instance is configured.
- [ ] Backend validates the session server-side.
- [ ] Client-supplied user IDs are ignored.
- [ ] Campaign reads and writes require verified ownership.
- [ ] Two test users cannot access one another's campaign, transcript, character, or events.
- [ ] Sign-out and expired-session behavior are tested.

## Billing

- [ ] Stripe production price is configured.
- [ ] Checkout is created server-side.
- [ ] Stripe webhook signature is verified against the raw body.
- [ ] Webhook event handling is idempotent.
- [ ] Completed checkout grants entitlement only after webhook processing.
- [ ] Failed payment, cancellation, and expiration states are tested.
- [ ] Customer portal works.
- [ ] Browser return URL does not grant entitlement by itself.

## Game loop

- [ ] Character creation works.
- [ ] Campaign creation works.
- [ ] Campaign resume works after refresh and restart.
- [ ] Player message is persisted once.
- [ ] Rules event is persisted before narration.
- [ ] LLM failure does not repeat a mechanical action.
- [ ] Roll evidence is visible to the player.
- [ ] Server, not browser, controls HP, inventory, spells, and outcomes.

## Security

- [ ] No secret keys appear in browser assets.
- [ ] No OpenAI or other model key is sent to the browser.
- [ ] No Open5e request is required to play.
- [ ] Request body and prompt logging are privacy-reviewed.
- [ ] Rate limiting exists on auth, billing, and player-turn routes.
- [ ] Error responses do not expose stack traces or private state.
- [ ] Webhook and player endpoints have separate validation paths.

## Operations

- [ ] Railway service binds to 0.0.0.0 and uses the assigned PORT.
- [ ] Health endpoint returns success without external dependencies.
- [ ] Persistent volume is mounted at the intended path.
- [ ] Database backup is created.
- [ ] Backup restore has been performed successfully.
- [ ] Logs include request correlation information.
- [ ] LLM latency, errors, and usage are observable.
- [ ] Stripe webhook failures are observable and replayable.
- [ ] Namecheap DNS points to the verified Railway deployment.
- [ ] TLS works on the public domain.

## Release decision

- [ ] All Critical items pass.
- [ ] No unresolved P0 risk has an unknown owner.
- [ ] Staging smoke test passes with two accounts.
- [ ] Product owner approves the launch candidate.
- [ ] Rollback owner and procedure are documented.
