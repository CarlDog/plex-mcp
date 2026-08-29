import { describeTransportError } from "./errors.js";
import { log } from "./log.js";

const DEFAULT_TAUTULLI_TIMEOUT_MS = 10_000;
const MAX_ERROR_CHARS = 300;

type Env = Record<string, string | undefined>;

export type TautulliConfigState =
  | {
      state: "disabled";
      configured: false;
      missingConfig: [];
    }
  | {
      state: "misconfigured";
      configured: false;
      missingConfig: string[];
      error: string;
    }
  | {
      state: "configured";
      configured: true;
      missingConfig: [];
      endpoint: URL;
      apiKey: string;
      timeoutMs: number;
    };

export type TautulliStatus =
  | {
      state: "disabled";
      configured: false;
      apiKeyConfigured: false;
      missingConfig: [];
      connectivity: null;
    }
  | {
      state: "misconfigured";
      configured: false;
      apiKeyConfigured: boolean;
      missingConfig: string[];
      connectivity: { ok: false; error: string };
    }
  | {
      state: "configured";
      configured: true;
      apiKeyConfigured: true;
      missingConfig: [];
      connectivity: { ok: true } | { ok: false; error: string };
    };

export type TautulliActivitySession = {
  sessionKey?: string;
  ratingKey?: string;
  mediaType?: string;
  title?: string;
  fullTitle?: string;
  showTitle?: string;
  season?: number;
  episode?: number;
  year?: number;
  user?: string;
  player?: string;
  platform?: string;
  device?: string;
  state?: string;
  progressPercent?: number;
  transcodeDecision?: string;
  videoDecision?: string;
  audioDecision?: string;
  subtitleDecision?: string;
};

export type TautulliActivity = {
  streamCount: number;
  totalBandwidthKbps?: number;
  lanBandwidthKbps?: number;
  wanBandwidthKbps?: number;
  sessions: TautulliActivitySession[];
};

export type TautulliHistoryArgs = {
  offset?: number;
  limit?: number;
  user?: string;
  userId?: number;
  ratingKey?: string;
  mediaType?: "movie" | "episode" | "track" | "live";
  startDate?: string;
};

export type TautulliHistoryItem = {
  rowId?: number;
  ratingKey?: string;
  mediaType?: string;
  title?: string;
  fullTitle?: string;
  showTitle?: string;
  season?: number;
  episode?: number;
  year?: number;
  user?: string;
  player?: string;
  platform?: string;
  startedAt?: number;
  stoppedAt?: number;
  durationSeconds?: number;
  watchedSeconds?: number;
  progressPercent?: number;
  transcodeDecision?: string;
};

export type TautulliHistory = {
  offset: number;
  limit: number;
  total: number;
  filteredTotal: number;
  items: TautulliHistoryItem[];
};

export type TautulliWatchTime = {
  sectionId: string;
  periods: Array<{
    queryDays: number;
    totalPlays: number;
    totalTimeSeconds: number;
  }>;
};

function raw(env: Env, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function misconfigured(
  missingConfig: string[],
  error: string,
): TautulliConfigState {
  return {
    state: "misconfigured",
    configured: false,
    missingConfig,
    error,
  };
}

/**
 * Resolve the optional Tautulli configuration without making an optional
 * integration capable of crash-looping the otherwise healthy Plex server.
 */
export function resolveTautulliConfig(
  env: Env = process.env,
): TautulliConfigState {
  const urlValue = raw(env, "TAUTULLI_URL");
  const apiKey = raw(env, "TAUTULLI_API_KEY");

  if (!urlValue && !apiKey) {
    return { state: "disabled", configured: false, missingConfig: [] };
  }

  const missingConfig: string[] = [];
  if (!urlValue) missingConfig.push("TAUTULLI_URL");
  if (!apiKey) missingConfig.push("TAUTULLI_API_KEY");
  if (missingConfig.length > 0) {
    return misconfigured(
      missingConfig,
      `Tautulli configuration is incomplete (missing: ${missingConfig.join(", ")})`,
    );
  }

  let webRoot: URL;
  try {
    webRoot = new URL(urlValue as string);
  } catch {
    return misconfigured([], "TAUTULLI_URL must be a valid absolute URL");
  }
  if (webRoot.protocol !== "http:" && webRoot.protocol !== "https:") {
    return misconfigured([], "TAUTULLI_URL must use http: or https:");
  }
  if (webRoot.username || webRoot.password) {
    return misconfigured([], "TAUTULLI_URL must not contain URL credentials");
  }
  if (webRoot.search || webRoot.hash) {
    return misconfigured(
      [],
      "TAUTULLI_URL must not contain a query string or fragment",
    );
  }

  const timeoutValue = raw(env, "TAUTULLI_TIMEOUT_MS");
  if (timeoutValue !== undefined && !/^\d+$/.test(timeoutValue)) {
    return misconfigured([], "TAUTULLI_TIMEOUT_MS must be a positive integer");
  }
  const timeoutMs = timeoutValue
    ? Number.parseInt(timeoutValue, 10)
    : DEFAULT_TAUTULLI_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    return misconfigured([], "TAUTULLI_TIMEOUT_MS must be a positive integer");
  }

  const endpoint = new URL(webRoot.toString());
  endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, "")}/api/v2`;

  return {
    state: "configured",
    configured: true,
    missingConfig: [],
    endpoint,
    apiKey: apiKey as string,
    timeoutMs,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function integerValue(value: unknown): number | undefined {
  const parsed = numberValue(value);
  return parsed === undefined ? undefined : Math.trunc(parsed);
}

function sanitizeError(
  message: string,
  config: Extract<TautulliConfigState, { state: "configured" }>,
): string {
  let out = message;
  for (const secret of [config.apiKey, config.endpoint.toString()]) {
    if (secret) out = out.split(secret).join("[redacted]");
  }
  return out.slice(0, MAX_ERROR_CHARS);
}

export class TautulliClient {
  constructor(
    private readonly config: TautulliConfigState,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async checkStatus(): Promise<TautulliStatus> {
    if (this.config.state === "disabled") {
      return {
        state: "disabled",
        configured: false,
        apiKeyConfigured: false,
        missingConfig: [],
        connectivity: null,
      };
    }
    if (this.config.state === "misconfigured") {
      return {
        state: "misconfigured",
        configured: false,
        apiKeyConfigured:
          !this.config.missingConfig.includes("TAUTULLI_API_KEY"),
        missingConfig: this.config.missingConfig,
        connectivity: { ok: false, error: this.config.error },
      };
    }
    try {
      await this.request("get_server_info");
      return {
        state: "configured",
        configured: true,
        apiKeyConfigured: true,
        missingConfig: [],
        connectivity: { ok: true },
      };
    } catch (err) {
      return {
        state: "configured",
        configured: true,
        apiKeyConfigured: true,
        missingConfig: [],
        connectivity: { ok: false, error: String(err) },
      };
    }
  }

  async getActivity(): Promise<TautulliActivity> {
    const data = asRecord(await this.request("get_activity")) ?? {};
    const sessions = Array.isArray(data.sessions) ? data.sessions : [];
    return {
      streamCount: integerValue(data.stream_count) ?? sessions.length,
      totalBandwidthKbps: numberValue(data.total_bandwidth),
      lanBandwidthKbps: numberValue(data.lan_bandwidth),
      wanBandwidthKbps: numberValue(data.wan_bandwidth),
      sessions: sessions.flatMap((entry) => {
        const row = asRecord(entry);
        if (!row) return [];
        return [
          {
            sessionKey: stringValue(row.session_key),
            ratingKey: stringValue(row.rating_key),
            mediaType: stringValue(row.media_type),
            title: stringValue(row.title),
            fullTitle: stringValue(row.full_title),
            showTitle: stringValue(row.grandparent_title),
            season: integerValue(row.parent_media_index ?? row.parent_index),
            episode: integerValue(row.media_index ?? row.index),
            year: integerValue(row.year),
            user: stringValue(row.friendly_name ?? row.username),
            player: stringValue(row.player),
            platform: stringValue(row.platform),
            device: stringValue(row.device),
            state: stringValue(row.state),
            progressPercent: numberValue(row.progress_percent),
            transcodeDecision: stringValue(row.transcode_decision),
            videoDecision: stringValue(row.video_decision),
            audioDecision: stringValue(row.audio_decision),
            subtitleDecision: stringValue(row.subtitle_decision),
          },
        ];
      }),
    };
  }

  async getHistory(args: TautulliHistoryArgs = {}): Promise<TautulliHistory> {
    const offset = args.offset ?? 0;
    const limit = args.limit ?? 50;
    const params: Record<string, string | number> = {
      start: offset,
      length: limit,
    };
    if (args.user !== undefined) params.user = args.user;
    if (args.userId !== undefined) params.user_id = args.userId;
    if (args.ratingKey !== undefined) params.rating_key = args.ratingKey;
    if (args.mediaType !== undefined) params.media_type = args.mediaType;
    if (args.startDate !== undefined) params.start_date = args.startDate;

    const data = asRecord(await this.request("get_history", params)) ?? {};
    const rows = Array.isArray(data.data) ? data.data : [];
    return {
      offset,
      limit,
      total: integerValue(data.recordsTotal) ?? rows.length,
      filteredTotal: integerValue(data.recordsFiltered) ?? rows.length,
      items: rows.flatMap((entry) => {
        const row = asRecord(entry);
        if (!row) return [];
        return [
          {
            rowId: integerValue(row.row_id),
            ratingKey: stringValue(row.rating_key),
            mediaType: stringValue(row.media_type),
            title: stringValue(row.title),
            fullTitle: stringValue(row.full_title),
            showTitle: stringValue(row.grandparent_title),
            season: integerValue(row.parent_media_index ?? row.parent_index),
            episode: integerValue(row.media_index ?? row.index),
            year: integerValue(row.year),
            user: stringValue(row.friendly_name ?? row.user),
            player: stringValue(row.player),
            platform: stringValue(row.platform),
            startedAt: integerValue(row.started),
            stoppedAt: integerValue(row.stopped),
            durationSeconds: numberValue(row.duration),
            watchedSeconds: numberValue(row.play_duration),
            progressPercent: numberValue(row.percent_complete),
            transcodeDecision: stringValue(row.transcode_decision),
          },
        ];
      }),
    };
  }

  async getLibraryWatchTimeStats(
    sectionId: string,
    queryDays: number[],
  ): Promise<TautulliWatchTime> {
    const data = await this.request("get_library_watch_time_stats", {
      section_id: sectionId,
      query_days: queryDays.join(","),
    });
    const rows = Array.isArray(data) ? data : [];
    return {
      sectionId,
      periods: rows.flatMap((entry) => {
        const row = asRecord(entry);
        if (!row) return [];
        const days = integerValue(row.query_days);
        if (days === undefined) return [];
        return [
          {
            queryDays: days,
            totalPlays: integerValue(row.total_plays) ?? 0,
            totalTimeSeconds: numberValue(row.total_time) ?? 0,
          },
        ];
      }),
    };
  }

  private configured(): Extract<TautulliConfigState, { state: "configured" }> {
    if (this.config.state === "disabled") {
      throw new Error(
        "Tautulli is not configured (set TAUTULLI_URL and TAUTULLI_API_KEY)",
      );
    }
    if (this.config.state === "misconfigured") {
      throw new Error(this.config.error);
    }
    return this.config;
  }

  private async request(
    command: string,
    params: Record<string, string | number> = {},
  ): Promise<unknown> {
    const config = this.configured();
    const url = new URL(config.endpoint.toString());
    url.searchParams.set("apikey", config.apiKey);
    url.searchParams.set("cmd", command);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }

    const start = Date.now();
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (err) {
      const detail = sanitizeError(describeTransportError(err), config);
      // The original fetch error may retain the complete query URL, including
      // Tautulli's apikey parameter. Attaching it as `cause` would preserve a
      // secret-bearing object beyond this redaction boundary.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(`Tautulli ${command} request failed: ${detail}`);
    }
    if (!response.ok) {
      const statusText = sanitizeError(response.statusText, config);
      throw new Error(
        `Tautulli ${command} returned HTTP ${response.status} ${statusText}`.trim(),
      );
    }

    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Tautulli ${command} returned malformed JSON`);
    }
    const envelope = asRecord(asRecord(parsed)?.response);
    if (!envelope) {
      throw new Error(`Tautulli ${command} returned no response envelope`);
    }
    if (envelope.result !== "success") {
      const upstream = stringValue(envelope.message);
      const suffix = upstream ? `: ${sanitizeError(upstream, config)}` : "";
      throw new Error(`Tautulli ${command} failed${suffix}`);
    }

    log.debug("tautulli", "command ok", {
      command,
      ms: Date.now() - start,
    });
    return envelope.data;
  }
}
