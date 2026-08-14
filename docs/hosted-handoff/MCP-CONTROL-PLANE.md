# MCP Control Plane Setup

**Status:** Configured for the local developer account on 2026-08-06

## Purpose

These MCP servers help an operator and coding agent configure the hosted product. They are not part of the RPG game runtime and are not exposed to players.

## Configured servers

| Server | Transport | Purpose | Current setup |
|---|---|---|---|
| Railway | Local stdio through `railway mcp` | Projects, services, environments, variables, domains, deployments, logs | Installed in user-global Codex configuration |
| Clerk | Remote Streamable HTTP | Current Clerk SDK snippets and implementation guidance | Registered at `https://mcp.clerk.com/mcp` |
| Stripe | Remote Streamable HTTP with OAuth | Stripe API/documentation and billing setup guidance | Registered at `https://mcp.stripe.com` |

## Local verification

- Railway CLI version: 5.30.4.
- Railway CLI account authentication is present.
- Railway MCP entry was installed using `railway mcp install --agent codex`.
- Clerk CLI version: 3.0.0.
- Stripe CLI version: 1.45.1.
- The existing Codex configuration uses a model reasoning value that the Clerk installer does not currently parse. The Clerk and Stripe entries were therefore added without changing that preference.
- The repository working tree was not modified by the MCP registration. The entries are user-global in `C:\Users\mnehm\.codex\config.toml`.

## Activation

Restart the Codex client so it reloads the user-global MCP configuration. The current session may not discover newly registered servers until restart.

After restart, verify each server separately:

1. Ask Railway for the current project/service status in a non-production environment.
2. Ask Clerk for the server-side authentication pattern for the hosted Node service.
3. Ask Stripe for the subscription Checkout and webhook implementation checklist in test mode.

Do not begin with a destructive request. Confirm that the tools are visible and authenticated first.

## Safety rules

- Use Railway MCP against a development or staging environment until deployment is explicitly approved.
- Review and manually confirm redeployments, staged deploy acceptance, variable changes, domain changes, and destructive operations.
- Use Stripe OAuth or a restricted Stripe key. Never put a secret key in repository configuration, browser assets, or prompts.
- Keep Stripe sandbox and live-mode work separate.
- Treat Clerk MCP as an implementation-reference tool; it does not replace server-side Clerk session verification.
- These MCP servers must not be made available to the RPG player or passed into the DM prompt.

## Control-plane versus runtime

~~~text
Operator/Codex
  ├─ Railway MCP → hosting control plane
  ├─ Clerk MCP   → auth implementation guidance
  └─ Stripe MCP  → billing implementation and account operations

Player browser
  └─ Hosted RPG application only

Game turn
  └─ Engine-native rules and transcribed content only
~~~

The Open5e MCP remains a development-time research tool and is intentionally separate from this infrastructure control plane.

## Official references

- [Railway MCP server](https://docs.railway.com/ai/mcp-server)
- [Clerk MCP server](https://clerk.com/docs/guides/ai/mcp/clerk-mcp-server)
- [Stripe MCP](https://docs.stripe.com/mcp)
