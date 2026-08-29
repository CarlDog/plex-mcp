import { describe, expect, test, vi } from "vitest";
import { TautulliClient, resolveTautulliConfig } from "../src/tautulli.js";

function success(data: unknown): Response {
  return new Response(
    JSON.stringify({ response: { result: "success", message: null, data } }),
    { status: 200 },
  );
}

function configured(fetchImpl: typeof fetch): TautulliClient {
  return new TautulliClient(
    resolveTautulliConfig({
      TAUTULLI_URL: "http://tautulli.test:8181/root",
      TAUTULLI_API_KEY: "super-secret-key",
      TAUTULLI_TIMEOUT_MS: "1234",
    }),
    fetchImpl,
  );
}

describe("resolveTautulliConfig", () => {
  test("is disabled when URL and key are absent or blank", () => {
    expect(resolveTautulliConfig({}).state).toBe("disabled");
    expect(
      resolveTautulliConfig({ TAUTULLI_URL: " ", TAUTULLI_API_KEY: "" }).state,
    ).toBe("disabled");
  });

  test("reports partial configuration without throwing", () => {
    const state = resolveTautulliConfig({
      TAUTULLI_URL: "http://tautulli.test:8181",
    });
    expect(state.state).toBe("misconfigured");
    expect(state.missingConfig).toEqual(["TAUTULLI_API_KEY"]);
  });

  test("rejects unsafe or malformed URL shapes fail-soft", () => {
    for (const value of [
      "not-a-url",
      "file:///tmp/tautulli",
      "http://user:pass@tautulli.test:8181",
      "http://tautulli.test:8181?apikey=oops",
    ]) {
      expect(
        resolveTautulliConfig({
          TAUTULLI_URL: value,
          TAUTULLI_API_KEY: "key",
        }).state,
      ).toBe("misconfigured");
    }
  });

  test("appends api/v2 after an optional HTTP root", () => {
    const state = resolveTautulliConfig({
      TAUTULLI_URL: "http://tautulli.test:8181/root/",
      TAUTULLI_API_KEY: "key",
    });
    expect(state.state).toBe("configured");
    if (state.state === "configured") {
      expect(state.endpoint.toString()).toBe(
        "http://tautulli.test:8181/root/api/v2",
      );
      expect(state.timeoutMs).toBe(10_000);
    }
  });

  test("invalid timeout is a diagnostic state, not an exception", () => {
    for (const value of ["0", "-1", "1.5", "nope"]) {
      expect(
        resolveTautulliConfig({
          TAUTULLI_URL: "http://tautulli.test:8181",
          TAUTULLI_API_KEY: "key",
          TAUTULLI_TIMEOUT_MS: value,
        }).state,
      ).toBe("misconfigured");
    }
  });
});

describe("TautulliClient", () => {
  test("builds a bounded authenticated query without putting the key in headers", async () => {
    let capturedUrl: URL | undefined;
    let capturedInit: RequestInit | undefined;
    const fetchImpl = vi.fn(async (input: string | URL | Request, init) => {
      capturedUrl = new URL(String(input));
      capturedInit = init;
      return success({ pms_name: "Plex" });
    }) as unknown as typeof fetch;

    const status = await configured(fetchImpl).checkStatus();
    expect(status.connectivity).toEqual({ ok: true });
    expect(capturedUrl?.pathname).toBe("/root/api/v2");
    expect(capturedUrl?.searchParams.get("cmd")).toBe("get_server_info");
    expect(capturedUrl?.searchParams.get("apikey")).toBe("super-secret-key");
    expect(new Headers(capturedInit?.headers).get("authorization")).toBeNull();
    expect(capturedInit?.signal).toBeInstanceOf(AbortSignal);
  });

  test("normalizes activity through an allowlist", async () => {
    const client = configured(
      vi.fn(async () =>
        success({
          stream_count: "1",
          total_bandwidth: "9000",
          sessions: [
            {
              session_key: "44",
              rating_key: "123",
              media_type: "episode",
              full_title: "Show - Episode",
              friendly_name: "Viewer",
              player: "Living Room",
              progress_percent: "52.5",
              transcode_decision: "transcode",
              email: "private@example.test",
              ip_address: "10.0.0.1",
              ip_address_public: "203.0.113.1",
              machine_id: "machine-secret",
              file: "/private/media/file.mkv",
            },
          ],
        }),
      ) as unknown as typeof fetch,
    );

    const result = await client.getActivity();
    expect(result.streamCount).toBe(1);
    expect(result.sessions[0]).toMatchObject({
      sessionKey: "44",
      ratingKey: "123",
      user: "Viewer",
      progressPercent: 52.5,
    });
    const serialized = JSON.stringify(result);
    for (const secret of [
      "private@example.test",
      "10.0.0.1",
      "203.0.113.1",
      "machine-secret",
      "/private/media/file.mkv",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  test("maps history filters and normalizes paged output", async () => {
    let capturedUrl: URL | undefined;
    const client = configured(
      vi.fn(async (input: string | URL | Request) => {
        capturedUrl = new URL(String(input));
        return success({
          recordsTotal: "8",
          recordsFiltered: "1",
          data: [
            {
              row_id: "9",
              rating_key: "77",
              full_title: "Movie (2025)",
              friendly_name: "Viewer",
              started: "100",
              stopped: "200",
              ip_address: "10.0.0.8",
              file: "/media/movie.mkv",
            },
          ],
        });
      }) as unknown as typeof fetch,
    );

    const result = await client.getHistory({
      offset: 5,
      limit: 10,
      userId: 42,
      ratingKey: "77",
      mediaType: "movie",
      startDate: "2026-08-29",
    });
    expect(capturedUrl?.searchParams.get("start")).toBe("5");
    expect(capturedUrl?.searchParams.get("length")).toBe("10");
    expect(capturedUrl?.searchParams.get("user_id")).toBe("42");
    expect(result).toMatchObject({ total: 8, filteredTotal: 1 });
    expect(JSON.stringify(result)).not.toContain("10.0.0.8");
    expect(JSON.stringify(result)).not.toContain("/media/movie.mkv");
  });

  test("normalizes watch-time periods", async () => {
    const client = configured(
      vi.fn(async () =>
        success([
          { query_days: 7, total_plays: 3, total_time: 3600 },
          { query_days: "0", total_plays: "10", total_time: "7200" },
        ]),
      ) as unknown as typeof fetch,
    );
    await expect(client.getLibraryWatchTimeStats("2", [7, 0])).resolves.toEqual(
      {
        sectionId: "2",
        periods: [
          { queryDays: 7, totalPlays: 3, totalTimeSeconds: 3600 },
          { queryDays: 0, totalPlays: 10, totalTimeSeconds: 7200 },
        ],
      },
    );
  });

  test("sanitizes API key and endpoint from transport errors", async () => {
    const client = configured(
      vi.fn(async () => {
        throw new Error(
          "failed http://tautulli.test:8181/root/api/v2?apikey=super-secret-key",
        );
      }) as unknown as typeof fetch,
    );
    const status = await client.checkStatus();
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain("super-secret-key");
    expect(serialized).not.toContain("http://tautulli.test:8181/root/api/v2");
  });

  test("surfaces malformed JSON and Tautulli error envelopes", async () => {
    const malformed = configured(
      vi.fn(
        async () => new Response("nope", { status: 200 }),
      ) as unknown as typeof fetch,
    );
    await expect(malformed.getActivity()).rejects.toThrow(/malformed JSON/);

    const rejected = configured(
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              response: {
                result: "error",
                message: "Invalid apikey super-secret-key",
                data: null,
              },
            }),
            { status: 200 },
          ),
      ) as unknown as typeof fetch,
    );
    await expect(rejected.getActivity()).rejects.toThrow(/\[redacted\]/);
  });

  test("sanitizes non-2xx status text before exposing it", async () => {
    const client = configured(
      vi.fn(
        async () =>
          new Response(null, {
            status: 401,
            statusText: "Invalid apikey super-secret-key",
          }),
      ) as unknown as typeof fetch,
    );
    const status = await client.checkStatus();
    const serialized = JSON.stringify(status);
    expect(serialized).toContain("[redacted]");
    expect(serialized).not.toContain("super-secret-key");
  });

  test("disabled and partial states are explicit and network-free", async () => {
    const fetchImpl = vi.fn();
    const disabled = new TautulliClient(
      resolveTautulliConfig({}),
      fetchImpl as unknown as typeof fetch,
    );
    await expect(disabled.checkStatus()).resolves.toMatchObject({
      state: "disabled",
      connectivity: null,
    });
    await expect(disabled.getActivity()).rejects.toThrow(/not configured/);

    const partial = new TautulliClient(
      resolveTautulliConfig({ TAUTULLI_API_KEY: "key" }),
      fetchImpl as unknown as typeof fetch,
    );
    await expect(partial.checkStatus()).resolves.toMatchObject({
      state: "misconfigured",
      missingConfig: ["TAUTULLI_URL"],
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
