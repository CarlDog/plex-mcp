// REQUIRED ENFORCEMENT TEST — fleet standard MCP-T02.
//
// Every tool name must carry the plex_ prefix, be lower_snake_case, and be
// unique. The property already holds across all 31 registered tools; this
// keeps it from silently regressing as tools are added.

import { describe, expect, test } from "vitest";
import type { PlexClient } from "../src/plex.js";
import { registerTools } from "../src/tools/index.js";
import { CaptureServer } from "./_test_utils.js";

function captureAll(): CaptureServer {
  const server = new CaptureServer();
  registerTools(server as never, {} as PlexClient, {} as never);
  return server;
}

describe("tool naming", () => {
  const { tools } = captureAll();

  test("at least one tool is registered", () => {
    expect(tools.length).toBeGreaterThan(0);
  });

  test("every tool name starts with plex_", () => {
    const bad = tools
      .filter((t) => !t.name.startsWith("plex_"))
      .map((t) => t.name);
    expect(bad).toEqual([]);
  });

  test("tool names are lower_snake_case", () => {
    const bad = tools
      .filter((t) => !/^[a-z][a-z0-9_]*$/.test(t.name))
      .map((t) => t.name);
    expect(bad).toEqual([]);
  });

  test("tool names are unique", () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const t of tools) {
      if (seen.has(t.name)) dupes.push(t.name);
      seen.add(t.name);
    }
    expect(dupes).toEqual([]);
  });
});
