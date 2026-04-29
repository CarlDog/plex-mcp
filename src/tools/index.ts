// Tool registration orchestration. Each domain (discovery, sessions,
// playback, ...) lives in its own module. The createServer factory in
// src/index.ts calls registerTools which fans out to each registrar.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PlexClient } from "../plex.js";
import { registerDiscoveryTools } from "./discovery.js";
import { registerPlaybackTools } from "./playback.js";
import { registerSessionsTools } from "./sessions.js";

export function registerTools(server: McpServer, plex: PlexClient): void {
  registerDiscoveryTools(server, plex);
  registerSessionsTools(server, plex);
  registerPlaybackTools(server, plex);
}
