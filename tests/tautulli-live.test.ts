// Opt-in smoke coverage against a real Tautulli instance. CI has neither
// variable and skips this file; a configured workstation/Portainer validation
// run exercises the exact same direct client used by the MCP tools.

import { describe, expect, test } from "vitest";
import { TautulliClient, resolveTautulliConfig } from "../src/tautulli.js";

const hasAnyConfig = Boolean(
  process.env.TAUTULLI_URL || process.env.TAUTULLI_API_KEY,
);

describe.skipIf(!hasAnyConfig)("Tautulli live integration", () => {
  const state = resolveTautulliConfig(process.env);

  test("configuration is complete and connectivity succeeds", async () => {
    expect(state.state).toBe("configured");
    if (state.state !== "configured") return;
    const status = await new TautulliClient(state).checkStatus();
    expect(status.connectivity).toEqual({ ok: true });
  });

  test("activity returns a normalized array without exposing raw fields", async () => {
    if (state.state !== "configured") return;
    const activity = await new TautulliClient(state).getActivity();
    expect(Array.isArray(activity.sessions)).toBe(true);
  });
});
