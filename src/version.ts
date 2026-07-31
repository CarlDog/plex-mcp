// Single source of truth for the server's reported version. Keep this in
// lockstep with package.json's "version" field — tests/version-sync.test.ts
// enforces it, so bumping one without the other fails the suite in the
// same commit instead of shipping a stale version in the MCP initialize
// response.
export const SERVER_VERSION = "0.7.1";
