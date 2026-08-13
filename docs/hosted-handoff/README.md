# Hosted RPG MCP Handoff Packet

**Working product name:** RPG MCP Hosted  
**Repository:** mnehmos.rpg.mcp  
**Packet status:** Design handoff  
**Date:** 2026-08-06  
**Implementation status:** Documentation only; this packet intentionally contains no source-code changes.

## Purpose

This packet turns the repository audit into an executable product and engineering brief for a hosted, subscription-based, text-first fantasy roleplaying game.

The player is a single human user. The language model acts as dungeon master, world, narrator, and non-player characters. The server remains authoritative for rules, dice, state, inventory, health, spells, and consequences.

## Read in this order

1. [Status and immediate decisions](STATUS.md)
2. [Game design document](GDD.md)
3. [Target architecture](ARCHITECTURE.md)
4. [Architecture decision records](ADRs.md)
5. [Open5e rules transcription plan](RULESET-TRANSCRIPTION.md)
6. [Delivery workflow](WORKFLOW.md)
7. [Roadmap and backlog](ROADMAP.md)
8. [Risk register](RISK-REGISTER.md)
9. [Release checklist](RELEASE-CHECKLIST.md)
10. [MCP control-plane setup](MCP-CONTROL-PLANE.md)

## Executive decision

The existing repository should remain the rules and MCP foundation. The hosted product should be a new, narrow application boundary around it:

- One Railway web service.
- Clerk for identity.
- Stripe for subscription checkout and billing portal.
- A tenant-scoped hosted campaign store.
- A simple browser chat adventure.
- Existing MCP transports retained for local and compatible clients.
- Open5e used during development to look up and transcribe rules, not called at runtime.

## Important boundary

Open5e is a research source for the shipped ruleset. The production service must not depend on the Open5e API, an Open5e MCP process, or live content lookups during a player turn. Rules are transcribed, normalized, reviewed, and stored in engine-native data structures.

## Existing repository references

These documents remain useful background:

- [Codebase architecture analysis](../ARCHITECTURE-CODEBASE-ANALYSIS.md)
- [Cloud migration plan](../CLOUD-MIGRATION-PLAN.md)
- [Unified ownership ADR](../ADR-005-unified-ownership-architecture.md)
- [Execution priorities](../EXECUTION-PRIORITIES-unified-ownership.md)

The older cloud plan is broader than this launch packet. It describes a future platform with Postgres, Redis, multiplayer, and a full VTT. This packet narrows the first product to the smallest paid player experience.

## External references

- [Open5e API documentation](https://open5e.com/api-docs)
- [Open5e legal information](https://open5e.com/legal/)
- [Clerk session tokens](https://clerk.com/docs/guides/sessions/session-tokens)
- [Clerk backend request authentication](https://clerk.com/docs/reference/backend/authenticate-request)
- [Stripe Checkout Sessions](https://docs.stripe.com/api/checkout/sessions/create)
- [Stripe webhooks](https://docs.stripe.com/webhooks?lang=node)
- [Railway Node.js guide](https://docs.railway.com/guides/nodejs)
- [Railway healthchecks](https://docs.railway.com/reference/healthchecks)
