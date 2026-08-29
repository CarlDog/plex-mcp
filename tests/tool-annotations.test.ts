// REQUIRED ENFORCEMENT TEST — fleet standard MCP-T01.
//
// Every tool must declare MCP annotations, and they must be internally
// consistent. This is the mechanism behind MCP-P02: a convention that's
// only written down (not enforced) gets forgotten on the next tool added,
// and the failure is invisible until a client skips a confirmation prompt
// it should have shown — which is exactly what happened to
// plex_split_item / plex_merge_items / plex_apply_match before this test
// existed (see src/tools/helpers.ts's DESTRUCTIVE_ANNOTATIONS /
// DESTRUCTIVE_IDEMPOTENT_ANNOTATIONS comments).

import { describe, expect, test } from "vitest";
import type { PlexClient } from "../src/plex.js";
import { registerTools } from "../src/tools/index.js";
import { CaptureServer } from "./_test_utils.js";

// Tools whose own descriptions document that the operation is not cleanly
// reversible — an explicit list rather than a verb-matching heuristic,
// since this domain's destructive tools (split/merge/apply_match) aren't
// named with an obvious destructive verb the way delete/remove are.
const KNOWN_IRREVERSIBLE_TOOLS = [
  "plex_delete_playlist",
  "plex_split_item",
  "plex_merge_items",
  "plex_apply_match",
];

function captureAll(): CaptureServer {
  const server = new CaptureServer();
  registerTools(server as never, {} as PlexClient, {} as never);
  return server;
}

describe("tool annotations", () => {
  const { tools } = captureAll();

  test("at least one tool is registered (guards against a silent no-op)", () => {
    expect(tools.length).toBeGreaterThan(0);
  });

  test("every tool declares an annotations object", () => {
    const missing = tools
      .filter((t) => !t.config.annotations)
      .map((t) => t.name);
    expect(missing).toEqual([]);
  });

  test("every tool declares a title and a description", () => {
    const incomplete = tools
      .filter((t) => !t.config.title || !t.config.description)
      .map((t) => t.name);
    expect(incomplete).toEqual([]);
  });

  test("non-read tools declare destructiveHint explicitly", () => {
    // Undefined destructiveHint on a write tool means the client has to
    // guess. Writes must say so either way — false is a valid, deliberate
    // answer.
    const unspecified = tools
      .filter((t) => t.config.annotations?.readOnlyHint !== true)
      .filter((t) => t.config.annotations?.destructiveHint === undefined)
      .map((t) => t.name);
    expect(unspecified).toEqual([]);
  });

  test("a tool is never both readOnlyHint and destructiveHint", () => {
    // Contradictory hints are worse than absent ones: a client that trusts
    // readOnlyHint will skip its confirmation prompt entirely.
    const contradictory = tools
      .filter(
        (t) =>
          t.config.annotations?.destructiveHint === true &&
          t.config.annotations?.readOnlyHint === true,
      )
      .map((t) => t.name);
    expect(contradictory).toEqual([]);
  });

  test("every registered known-irreversible tool is marked destructiveHint: true", () => {
    const found = tools.filter((t) =>
      KNOWN_IRREVERSIBLE_TOOLS.includes(t.name),
    );
    // If a listed tool got renamed or removed, that's a stale list, not a
    // passing test — fail loudly rather than vacuously.
    expect(found.map((t) => t.name).sort()).toEqual(
      [...KNOWN_IRREVERSIBLE_TOOLS].sort(),
    );
    const wrong = found
      .filter((t) => t.config.annotations?.destructiveHint !== true)
      .map((t) => t.name);
    expect(wrong).toEqual([]);
  });
});
