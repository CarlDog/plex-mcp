# Tautulli integration ADR

The implemented cross-repository plan is maintained in Plex Companion:

- [Canonical Tautulli integration plan](https://github.com/CarlDog/plex-companion/blob/main/docs/plans/tautulli-integration.md)
- Local sibling checkout: `../../plex-companion/docs/plans/tautulli-integration.md`

Plex Companion owns the canonical document because its standalone-operation
requirement determines the architecture. Plex MCP's work package is a direct,
optional Tautulli HTTP client plus four read-only `plex_tautulli_*` tools. Plex
Companion does not call Plex MCP for Tautulli data. Portainer configuration and
live verification remain pending.

This pointer intentionally does not duplicate the implementation plan. Update
the canonical document and this pointer together if repository ownership or the
cross-repository boundary changes.
