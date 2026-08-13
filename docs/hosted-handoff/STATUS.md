# Handoff Status

**Snapshot date:** 2026-08-06  
**Status:** Ready for implementation planning  
**Code changes in this packet:** None

## Audit snapshot

- The repository is a TypeScript RPG engine and MCP server, not an empty prototype.
- The working tree was clean during the audit.
- The current branch is six commits ahead of origin/main.
- The TypeScript build passed during the audit.
- The test command passed during the audit.
- The current package has no Clerk, Stripe, or HTTP web application integration.
- The current default runtime is the MCP server, not a Railway-ready browser service.
- The current SQLite and session model is global and is not safe for paid multi-user hosting.
- The existing agent layer is primarily NPC-oriented and does not yet provide the complete hosted DM turn loop.
- The sibling Open5e MCP is a separate development tool.
- The sibling open5e-api repository is a Django content/API service, not part of the RPG MCP runtime.
- The older ChatRPG browser client exposes an OpenAI key in its deployed-page model and must not be reused as a production pattern.

## Decisions made for this handoff

- Launch is text-first, not a virtual tabletop.
- Launch is single-player, with one player-owned campaign as the default model.
- The server owns rules and state; the LLM supplies interpretation and narration.
- Open5e is research-only and is not a production dependency.
- The first rules target is the 2014/SRD-compatible engine behavior already present in the repository.
- Hosted state is isolated from the legacy global RPG database.
- Clerk is the identity boundary.
- Stripe webhooks are the entitlement boundary.
- Railway is the first hosting target.
- Namecheap is registrar/DNS only.

## Decisions still requiring product-owner approval

1. Product name and domain.
2. Monthly subscription price and trial policy.
3. Whether a trial permits a fixed number of turns or requires payment before play.
4. Initial supported classes, ancestries, and spell list.
5. Primary LLM provider and maximum monthly usage allowance.
6. Whether saved campaign export is included in the first paid tier.
7. Legal review of branding, Open Game Content attribution, and marketing language.

## Immediate implementation sequence

1. Freeze the hosted API and data contracts.
2. Create a tenant-safe hosted store separate from legacy RPG state.
3. Add Clerk authentication and authenticated request context.
4. Add Stripe Checkout, portal, and verified webhook entitlement updates.
5. Deliver character creation and campaign resume.
6. Deliver the server-authoritative action/roll/narration loop.
7. Ship the landing page and subscription conversion path.
8. Deploy a private Railway staging service and run the release checklist.
