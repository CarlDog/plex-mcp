import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "./log.js";

export interface PlexConfig {
  url: string;
  token: string;
}

interface PlexResponse<T> {
  MediaContainer?: T & { size?: number };
}

// Plex's internal numeric type code for a collection, at the section
// "/all" listing level. Confirmed against python-plexapi's SEARCHTYPES
// dict (plexapi/utils.py) — 'collection': 18.
const PLEX_TYPE_COLLECTION = 18;

/**
 * Parse a positive-integer env var, falling back to `defaultValue` for
 * unset, empty-string, non-numeric, or non-positive values. Some MCP
 * hosts inject "" for a blank config field rather than leaving it
 * unset — plain `?? default` lets that through, and parseInt("") is
 * NaN, so every downstream comparison would silently no-op. A
 * non-positive value is just as invalid as NaN for a byte cap or a
 * timeout: `AbortSignal.timeout(0)` fires immediately and
 * `AbortSignal.timeout(-1)` throws a raw RangeError rather than
 * producing a usable timeout, so it's treated the same as unset
 * rather than propagating a confusing runtime exception.
 */
function resolveIntEnv(raw: string | undefined, defaultValue: number): number {
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isNaN(parsed) || parsed <= 0 ? defaultValue : parsed;
}

const DEFAULT_IMAGE_MAX_BYTES = 4194304;

export function resolveImageMaxBytes(raw: string | undefined): number {
  return resolveIntEnv(raw, DEFAULT_IMAGE_MAX_BYTES);
}

const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
const MAX_RETRY_AFTER_MS = 30_000;
const MAX_RETRIES_ON_429 = 2;
const DEFAULT_RETRY_BACKOFF_MS = 1_000;

export function resolveFetchTimeoutMs(raw: string | undefined): number {
  return resolveIntEnv(raw, DEFAULT_FETCH_TIMEOUT_MS);
}

/**
 * Parse a Retry-After header (seconds, or an HTTP-date per RFC 9110)
 * into milliseconds, bounded to MAX_RETRY_AFTER_MS. An unbounded wait on
 * a large Retry-After would stall the whole request queue behind one
 * call (MCP-F02) — bounding it means we give up and surface the 429
 * as an error instead of hanging indefinitely.
 */
export function parseRetryAfterMs(header: string | null): number {
  if (!header) return DEFAULT_RETRY_BACKOFF_MS;
  const seconds = Number.parseInt(header, 10);
  if (!Number.isNaN(seconds)) {
    return Math.min(Math.max(seconds, 0) * 1000, MAX_RETRY_AFTER_MS);
  }
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) {
    return Math.min(Math.max(dateMs - Date.now(), 0), MAX_RETRY_AFTER_MS);
  }
  return DEFAULT_RETRY_BACKOFF_MS;
}

// A server log bundle can be far larger than an image (research: a
// multi-file ZIP of PMS's own log history) — separate, larger default
// cap and a separate, longer fetch timeout than the metadata-call
// defaults above.
const DEFAULT_LOG_MAX_BYTES = 52_428_800; // 50 MiB
const DEFAULT_LOG_FETCH_TIMEOUT_MS = 120_000; // 2 min

export function resolveLogMaxBytes(raw: string | undefined): number {
  return resolveIntEnv(raw, DEFAULT_LOG_MAX_BYTES);
}

export function resolveLogFetchTimeoutMs(raw: string | undefined): number {
  return resolveIntEnv(raw, DEFAULT_LOG_FETCH_TIMEOUT_MS);
}

/**
 * Validate that `filename` is a safe basename (no path separators, no
 * traversal sequences, no leading dot) before it's used to construct a
 * disk path. Defense against an LLM tricked into passing
 * "../../etc/passwd" or similar. Shared by saveImage/downloadLogs so
 * this path-traversal guard can't drift between the two disk-writing
 * call sites.
 */
function assertSafeBasename(filename: string, context: string): void {
  if (
    filename.includes("/") ||
    filename.includes("\\") ||
    filename.includes("..") ||
    filename.startsWith(".")
  ) {
    throw new Error(
      `${context}: filename must be a basename (no '/', '\\', '..', or leading '.'); got ${JSON.stringify(filename)}`,
    );
  }
}

/**
 * Ensure `baseDir` exists (creating it if necessary), throwing a clear
 * operator-actionable error naming `envVarName` on failure. Called
 * before the network fetch in saveImage/downloadLogs so a bad
 * save-dir config fails fast instead of only after a potentially
 * large transfer completes.
 */
function ensureSaveDir(
  baseDir: string,
  context: string,
  envVarName: string,
): void {
  try {
    mkdirSync(baseDir, { recursive: true });
  } catch (err) {
    throw new Error(
      `${context}: could not create save dir ${baseDir}: ${(err as Error).message}. Set ${envVarName} to a writable path.`,
      { cause: err },
    );
  }
}

/**
 * Write `bytes` to `<baseDir>/<filename>`, wrapping fs errors with an
 * operator-actionable message. Caller must already have validated the
 * filename and ensured baseDir exists (assertSafeBasename/ensureSaveDir).
 */
function writeBytesToPath(
  baseDir: string,
  filename: string,
  bytes: Uint8Array,
  context: string,
): string {
  const path = join(baseDir, filename);
  try {
    writeFileSync(path, bytes);
  } catch (err) {
    throw new Error(
      `${context}: could not write ${path}: ${(err as Error).message}`,
      { cause: err },
    );
  }
  return path;
}

export class PlexClient {
  private machineIdentifier: string | undefined;

  constructor(private readonly config: PlexConfig) {}

  /**
   * Get this Plex server's machineIdentifier (cached after first call).
   * Needed for constructing the `server://...` URIs that playlist
   * mutation endpoints (`POST /playlists`, `PUT /playlists/{id}/items`)
   * require.
   */
  async getMachineIdentifier(): Promise<string> {
    if (this.machineIdentifier) return this.machineIdentifier;
    const data = await this.request<{ machineIdentifier?: string }>(
      "/identity",
    );
    const id = data.MediaContainer?.machineIdentifier;
    if (!id) {
      throw new Error("Plex /identity did not return machineIdentifier");
    }
    this.machineIdentifier = id;
    return id;
  }

  /**
   * Build a `server://...` URI for a metadata item, suitable for
   * Plex's `uri=` query param (used by playlist create/add).
   */
  async metadataUri(ratingKey: string): Promise<string> {
    const machineId = await this.getMachineIdentifier();
    return `server://${machineId}/com.plexapp.plugins.library/library/metadata/${ratingKey}`;
  }

  async listPlaylists(): Promise<unknown[]> {
    const data = await this.request<{ Metadata?: unknown[] }>("/playlists");
    return data.MediaContainer?.Metadata ?? [];
  }

  async getPlaylistItems(playlistId: string): Promise<unknown[]> {
    const data = await this.request<{ Metadata?: unknown[] }>(
      `/playlists/${playlistId}/items`,
    );
    return data.MediaContainer?.Metadata ?? [];
  }

  async createPlaylist(args: {
    title: string;
    type: "video" | "audio" | "photo";
    ratingKey: string;
  }): Promise<unknown> {
    const uri = await this.metadataUri(args.ratingKey);
    const data = await this.request<{ Metadata?: unknown[] }>(
      "/playlists",
      {
        title: args.title,
        type: args.type,
        smart: "0",
        uri,
      },
      undefined,
      "POST",
    );
    return data.MediaContainer?.Metadata?.[0];
  }

  async addToPlaylist(playlistId: string, ratingKey: string): Promise<void> {
    const uri = await this.metadataUri(ratingKey);
    await this.requestNoContent(
      `/playlists/${playlistId}/items`,
      { uri },
      "PUT",
    );
  }

  async removeFromPlaylist(
    playlistId: string,
    playlistItemId: string,
  ): Promise<void> {
    await this.requestNoContent(
      `/playlists/${playlistId}/items/${playlistItemId}`,
      {},
      "DELETE",
    );
  }

  async deletePlaylist(playlistId: string): Promise<void> {
    await this.requestNoContent(`/playlists/${playlistId}`, {}, "DELETE");
  }

  /**
   * fetch() with a bound timeout (MCP-F01) and bounded 429 retry
   * honoring Retry-After (MCP-F02). A hung/half-open Plex server would
   * otherwise block a tool call indefinitely — every call site routes
   * through this one chokepoint rather than calling fetch() directly.
   *
   * `timeoutMsOverride` lets a call site with a different latency
   * profile (e.g. downloadLogs' multi-file ZIP generation+transfer) use
   * its own timeout instead of the metadata-call default.
   */
  private async fetchWithTimeoutAndRetry(
    url: URL,
    init: RequestInit,
    timeoutMsOverride?: number,
  ): Promise<Response> {
    const timeoutMs =
      timeoutMsOverride ??
      resolveFetchTimeoutMs(process.env.MCP_FETCH_TIMEOUT_MS);
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status !== 429 || attempt >= MAX_RETRIES_ON_429) {
        return res;
      }
      const waitMs = parseRetryAfterMs(res.headers.get("retry-after"));
      log.warn("plex", "429 rate limited, retrying", {
        url: url.pathname,
        attempt: attempt + 1,
        waitMs,
      });
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  /**
   * Shared request/error-handling contract for request()/requestNoContent():
   * build the URL, fetch through the timeout+retry chokepoint, log +
   * throw on network or HTTP failure, log on success, and return the
   * raw Response. Callers own body handling — request() JSON-parses it,
   * requestNoContent() discards it — since that's their only real
   * difference. Extracted so the error-message/logging contract can't
   * drift between the two (phase-end audit finding, 2026-08-03).
   */
  private async sendRequest(
    path: string,
    params: Record<string, string>,
    headers: Record<string, string>,
    method: "GET" | "POST" | "PUT" | "DELETE",
  ): Promise<Response> {
    const url = new URL(path, this.config.url);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
    const start = Date.now();
    log.debug("plex", "request", { method, path });
    let res: Response;
    try {
      res = await this.fetchWithTimeoutAndRetry(url, {
        method,
        headers: { "X-Plex-Token": this.config.token, ...headers },
      });
    } catch (err) {
      log.error("plex", "network error", {
        method,
        path,
        ms: Date.now() - start,
        msg: (err as Error).message,
      });
      throw err;
    }
    const ms = Date.now() - start;
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.warn("plex", "http error", {
        method,
        path,
        status: res.status,
        ms,
      });
      throw new Error(
        `Plex ${res.status} ${res.statusText} for ${method} ${path}: ${body.slice(0, 200)}`,
      );
    }
    log.debug("plex", "ok", { method, path, status: res.status, ms });
    return res;
  }

  private async request<T>(
    path: string,
    params: Record<string, string> = {},
    headers: Record<string, string> = {},
    method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  ): Promise<PlexResponse<T>> {
    const res = await this.sendRequest(
      path,
      params,
      { Accept: "application/json", ...headers },
      method,
    );
    // Plex sometimes returns empty bodies even for non-GET. Guard
    // against parse errors by reading text first and returning an
    // empty PlexResponse if unparseable.
    const text = await res.text();
    if (!text) return {} as PlexResponse<T>;
    try {
      return JSON.parse(text) as PlexResponse<T>;
    } catch {
      return {} as PlexResponse<T>;
    }
  }

  private async requestNoContent(
    path: string,
    params: Record<string, string> = {},
    method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  ): Promise<void> {
    await this.sendRequest(path, params, {}, method);
  }

  async hubs(): Promise<unknown[]> {
    const data = await this.request<{ Hub?: unknown[] }>("/hubs");
    return data.MediaContainer?.Hub ?? [];
  }

  async sectionHubs(sectionId: string): Promise<unknown[]> {
    const data = await this.request<{ Hub?: unknown[] }>(
      `/hubs/sections/${sectionId}`,
    );
    return data.MediaContainer?.Hub ?? [];
  }

  /**
   * Plex's "related" hubs for a single item — typically grouped by
   * provenance ("More with this director", "From this collection").
   * The response shape is a list of hubs, each containing items.
   */
  async related(ratingKey: string): Promise<unknown[]> {
    const data = await this.request<{ Hub?: unknown[] }>(
      `/library/metadata/${ratingKey}/related`,
    );
    return data.MediaContainer?.Hub ?? [];
  }

  /**
   * Plex's algorithmic "similar" items for a single item. Flat list,
   * not hub-grouped.
   */
  async similar(ratingKey: string): Promise<unknown[]> {
    const data = await this.request<{ Metadata?: unknown[] }>(
      `/library/metadata/${ratingKey}/similar`,
    );
    return data.MediaContainer?.Metadata ?? [];
  }

  async listLibraries(): Promise<unknown[]> {
    const data = await this.request<{ Directory?: unknown[] }>(
      "/library/sections",
    );
    return data.MediaContainer?.Directory ?? [];
  }

  async search(query: string): Promise<unknown[]> {
    const data = await this.request<{ Metadata?: unknown[] }>("/search", {
      query,
    });
    return data.MediaContainer?.Metadata ?? [];
  }

  /**
   * Plex's richer hub-based search. Unlike search() (plain GET /search),
   * this surfaces collections and external/online metadata matches —
   * an exact collection title returns [] from plain search but a real
   * hit here. Response is Hub-grouped (same shape as hubs()/
   * sectionHubs()/related()), not a flat Metadata[] list, since Plex
   * buckets results by type (movies, shows, collections, etc.).
   */
  async hubSearch(
    query: string,
    options: { sectionId?: string; limit?: number } = {},
  ): Promise<unknown[]> {
    const params: Record<string, string> = {
      query,
      includeCollections: "1",
      includeExternalMedia: "1",
    };
    if (options.sectionId !== undefined) params.sectionId = options.sectionId;
    if (options.limit !== undefined) params.limit = String(options.limit);
    const data = await this.request<{ Hub?: unknown[] }>(
      "/hubs/search",
      params,
    );
    return data.MediaContainer?.Hub ?? [];
  }

  async recentlyAdded(sectionId?: string): Promise<unknown[]> {
    const path = sectionId
      ? `/library/sections/${sectionId}/recentlyAdded`
      : "/library/recentlyAdded";
    const data = await this.request<{ Metadata?: unknown[] }>(path);
    return data.MediaContainer?.Metadata ?? [];
  }

  async onDeck(): Promise<unknown[]> {
    const data = await this.request<{ Metadata?: unknown[] }>(
      "/library/onDeck",
    );
    return data.MediaContainer?.Metadata ?? [];
  }

  async getItem(
    ratingKey: string,
    options: { fields?: string[]; minimal?: boolean } = {},
  ): Promise<unknown> {
    const data = await this.request<{ Metadata?: unknown[] }>(
      `/library/metadata/${ratingKey}`,
    );
    const item = data.MediaContainer?.Metadata?.[0] as
      Record<string, unknown> | undefined;
    if (!item) return undefined;

    // Explicit field projection beats minimal mode if both are set.
    if (options.fields && options.fields.length > 0) {
      const projected: Record<string, unknown> = {};
      for (const key of options.fields) {
        if (key in item) projected[key] = item[key];
      }
      return projected;
    }

    // Curated drop-list for minimal mode. These are the heavyweights:
    // Role[] alone is typically 80%+ of an item's payload on movies
    // with deep casts. Audio/video Stream[] entries inside each
    // Media.Part add another ~3KB per file. UltraBlurColors is purely
    // cosmetic. The kept fields cover the operational use cases (file
    // path, GUID, locked-field state, title/year/edition, viewed
    // state) plus subtitle track discovery (kept, not dropped — see
    // below): language/codec/id and the hearingImpaired (SDH) flag are
    // cheap and useful, unlike the audio/video entries' per-frame
    // codec detail that's the actual bulk cost.
    if (options.minimal) {
      const DROP_TOP_LEVEL = new Set([
        "Role",
        "Director",
        "Writer",
        "Producer",
        "Image",
        "UltraBlurColors",
        "Country",
        "Style",
        "Mood",
      ]);
      // Plex's Stream.streamType: 1 = video, 2 = audio, 3 = subtitle.
      // Confirmed against python-plexapi's SubtitleStream.STREAMTYPE = 3
      // and a live plex_now_playing capture showing video/audio entries
      // as 1/2.
      const SUBTITLE_STREAM_TYPE = 3;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(item)) {
        if (DROP_TOP_LEVEL.has(k)) continue;
        if (k === "Media" && Array.isArray(v)) {
          out[k] = (v as Array<Record<string, unknown>>).map((media) => {
            const trimmedMedia: Record<string, unknown> = {};
            for (const [mk, mv] of Object.entries(media)) {
              if (mk === "Part" && Array.isArray(mv)) {
                trimmedMedia[mk] = (mv as Array<Record<string, unknown>>).map(
                  (part) => {
                    const trimmedPart: Record<string, unknown> = {};
                    for (const [pk, pv] of Object.entries(part)) {
                      if (pk === "Stream") {
                        trimmedPart[pk] = (
                          pv as Array<Record<string, unknown>>
                        ).filter((s) => s.streamType === SUBTITLE_STREAM_TYPE);
                        continue;
                      }
                      trimmedPart[pk] = pv;
                    }
                    return trimmedPart;
                  },
                );
              } else {
                trimmedMedia[mk] = mv;
              }
            }
            return trimmedMedia;
          });
        } else {
          out[k] = v;
        }
      }
      return out;
    }

    return item;
  }

  async getChildren(ratingKey: string): Promise<unknown[]> {
    const data = await this.request<{ Metadata?: unknown[] }>(
      `/library/metadata/${ratingKey}/children`,
    );
    return data.MediaContainer?.Metadata ?? [];
  }

  async nowPlaying(): Promise<unknown[]> {
    const data = await this.request<{ Metadata?: unknown[] }>(
      "/status/sessions",
    );
    return data.MediaContainer?.Metadata ?? [];
  }

  async history(
    options: { offset?: number; limit?: number; sectionId?: string } = {},
  ): Promise<{
    total: number;
    offset: number;
    size: number;
    items: unknown[];
  }> {
    // Plex needs BOTH X-Plex-Container-Start and X-Plex-Container-Size
    // present — sending only Size is silently ignored. Always send both.
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 50;
    const params: Record<string, string> = { sort: "viewedAt:desc" };
    const headers: Record<string, string> = {
      "X-Plex-Container-Start": String(offset),
      "X-Plex-Container-Size": String(limit),
    };
    if (options.sectionId !== undefined) {
      params.librarySectionID = options.sectionId;
    }
    const data = await this.request<{
      Metadata?: unknown[];
      totalSize?: number;
    }>("/status/sessions/history/all", params, headers);
    const items = data.MediaContainer?.Metadata ?? [];
    return {
      total: data.MediaContainer?.totalSize ?? items.length,
      offset,
      size: items.length,
      items,
    };
  }

  async browse(
    sectionId: string,
    options: {
      offset?: number;
      limit?: number;
      type?: number;
      fields?: string[];
      collection?: string;
    } = {},
  ): Promise<{
    total: number;
    offset: number;
    size: number;
    items: unknown[];
  }> {
    // Plex needs BOTH X-Plex-Container-Start and X-Plex-Container-Size
    // present — sending only Size is silently ignored. Always send both.
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 50;
    const params: Record<string, string> = {};
    const headers: Record<string, string> = {
      "X-Plex-Container-Start": String(offset),
      "X-Plex-Container-Size": String(limit),
    };
    if (options.type !== undefined) {
      params.type = String(options.type);
    }
    // Matches by the collection's tag/title (e.g. "James Bond"), not a
    // ratingKey — collection is a "tag"-type filter field in Plex's own
    // filtering system, same family as genre/director/studio.
    if (options.collection !== undefined) {
      params.collection = options.collection;
    }
    const data = await this.request<{
      Metadata?: unknown[];
      totalSize?: number;
    }>(`/library/sections/${sectionId}/all`, params, headers);
    let items: unknown[] = data.MediaContainer?.Metadata ?? [];
    // Sparse projection: if `fields` is provided, filter each item's
    // keys to just those listed. Reduces response size ~20× on
    // populated sections where the default per-item payload (~4KB
    // including summary/images/colors/genres/etc.) overwhelms an
    // LLM context. Done client-side because Plex's API has no
    // projection parameter — server still sends the full payload,
    // but the agent never sees the rest.
    if (options.fields && options.fields.length > 0) {
      const keys = options.fields;
      items = (items as Array<Record<string, unknown>>).map((item) => {
        const projected: Record<string, unknown> = {};
        for (const key of keys) {
          if (key in item) projected[key] = item[key];
        }
        return projected;
      });
    }
    return {
      total: data.MediaContainer?.totalSize ?? items.length,
      offset,
      size: items.length,
      items,
    };
  }

  /**
   * List collections in a library section. There is no dedicated
   * "/collections" list endpoint — cross-validated against
   * python-plexapi (LibrarySection.collections() calls search(libtype=
   * 'collection'), which resolves to this exact same /all endpoint with
   * a type filter). Thin wrapper over browse(): collections are just
   * another Plex "type" (18) at the section-listing level, same
   * endpoint plex_browse already hits.
   */
  async listCollections(
    sectionId: string,
    options: { offset?: number; limit?: number; fields?: string[] } = {},
  ): Promise<{
    total: number;
    offset: number;
    size: number;
    items: unknown[];
  }> {
    return this.browse(sectionId, { ...options, type: PLEX_TYPE_COLLECTION });
  }

  async markWatched(ratingKey: string): Promise<void> {
    await this.requestNoContent("/:/scrobble", {
      key: ratingKey,
      identifier: "com.plexapp.plugins.library",
    });
  }

  async markUnwatched(ratingKey: string): Promise<void> {
    await this.requestNoContent("/:/unscrobble", {
      key: ratingKey,
      identifier: "com.plexapp.plugins.library",
    });
  }

  /**
   * Tell Plex to re-pull metadata for an item from its currently-bound
   * agent. Useful when poster/summary/etc. are stale, or after fixing
   * a match. Empty 200 response — uses requestNoContent.
   *
   * `force=true` bypasses the agent's cache and does a deep refresh.
   */
  async refreshMetadata(
    ratingKey: string,
    options: { force?: boolean } = {},
  ): Promise<void> {
    const params: Record<string, string> = {};
    if (options.force) params.force = "1";
    await this.requestNoContent(
      `/library/metadata/${ratingKey}/refresh`,
      params,
      "PUT",
    );
  }

  /**
   * List candidate matches that Plex's metadata agent considers for an
   * item. Read-only. Pass title/year/agent/language to override what
   * Plex auto-searches with — useful when the filename-derived title
   * isn't matching anything.
   *
   * Returns the SearchResult array with shape:
   *   [{ name, year, guid, score, lifespanEnded?, summary?, ... }]
   */
  async getMatches(
    ratingKey: string,
    options: {
      agent?: string;
      language?: string;
      title?: string;
      year?: number;
    } = {},
  ): Promise<unknown[]> {
    const params: Record<string, string> = { manual: "1" };
    if (options.agent) params.agent = options.agent;
    if (options.language) params.language = options.language;
    if (options.title) params.title = options.title;
    if (options.year !== undefined) params.year = String(options.year);
    const data = await this.request<{ SearchResult?: unknown[] }>(
      `/library/metadata/${ratingKey}/matches`,
      params,
    );
    return data.MediaContainer?.SearchResult ?? [];
  }

  /**
   * Apply a specific match to an item, overwriting the current agent
   * binding. `guid` and `name` come from a `getMatches` SearchResult
   * entry. Empty 200 response.
   *
   * NOT reversible cleanly — re-applying a different match overwrites
   * again, but the original "no match" / agents.none state can't be
   * restored without unmatch (not yet exposed).
   */
  async applyMatch(
    ratingKey: string,
    guid: string,
    name: string,
  ): Promise<void> {
    await this.requestNoContent(
      `/library/metadata/${ratingKey}/match`,
      { guid, name },
      "PUT",
    );
  }

  /**
   * Edit user-settable scalar metadata fields on an item.
   *
   * Each provided field is written as `<key>.value=<v>` plus
   * `<key>.locked=<0|1>`. `lock=true` (default) is critical — without
   * it, the next metadata refresh from the bound agent wipes the
   * override. Set `lock=false` only when you want the change to be
   * transient.
   *
   * Keys are passed as Plex camelCase names (`titleSort`,
   * `originallyAvailableAt`, `contentRating`, etc.) — the tool layer
   * handles the snake_case translation.
   *
   * Empty 200 response. Fields not passed are untouched (existing
   * lock state preserved).
   */
  async editMetadata(
    ratingKey: string,
    fields: Record<string, string | number>,
    lock = true,
  ): Promise<void> {
    const params: Record<string, string> = {};
    const lockFlag = lock ? "1" : "0";
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      params[`${key}.value`] = String(value);
      params[`${key}.locked`] = lockFlag;
    }
    if (Object.keys(params).length === 0) {
      throw new Error("editMetadata: at least one field must be provided");
    }
    await this.requestNoContent(
      `/library/metadata/${ratingKey}`,
      params,
      "PUT",
    );
  }

  /**
   * Detach an item from its current agent binding, putting it back
   * into the unmatched (`tv.plex.agents.none`) state. Empty 200.
   *
   * Recovery flow after an unmatch is the same as fixing any
   * agents.none item: plex_get_matches → plex_apply_match →
   * plex_refresh_metadata.
   *
   * Locked field values survive across unmatch (verified empirically
   * during the 2026-05-08 audit cleanup).
   */
  async unmatch(ratingKey: string): Promise<void> {
    await this.requestNoContent(
      `/library/metadata/${ratingKey}/unmatch`,
      {},
      "PUT",
    );
  }

  /**
   * Ask Plex to refresh metadata for an entire library section. The
   * refresh runs asynchronously on the server; the HTTP call returns
   * immediately. Useful after bulk filesystem changes that the
   * built-in auto-scan hasn't picked up.
   *
   * `force=true` does a deep refresh (re-evaluates every item; slow,
   * server-load-heavy). Default false runs an incremental scan.
   */
  async refreshSection(
    sectionId: string,
    options: { force?: boolean } = {},
  ): Promise<void> {
    const params: Record<string, string> = {};
    if (options.force) params.force = "1";
    await this.requestNoContent(
      `/library/sections/${sectionId}/refresh`,
      params,
    );
  }

  /**
   * Split a Plex item back into its constituent media variants as N
   * separate items. All-or-nothing — there's no `mediaIds[]` granularity
   * on Plex's API; whatever Media variants the item currently has
   * become separate items.
   *
   * Use case: Plex auto-grouped legitimately-separate releases into
   * one item (e.g. the audit's WWE SummerSlam Night 2 case where 11
   * files spanning two nights were collapsed into a single ratingKey).
   *
   * Reversible via `mergeItems(thisRatingKey, [splitOffRatingKeys])`
   * — but discovering the new ratingKeys after split requires
   * browsing the section. Empty 200 response.
   *
   * Not covered by an automated round-trip test: destructive, and
   * post-split rk discovery is fiddly. Verify manually against real
   * use cases.
   */
  async splitItem(ratingKey: string): Promise<void> {
    await this.requestNoContent(
      `/library/metadata/${ratingKey}/split`,
      {},
      "PUT",
    );
  }

  /**
   * Fetch an image (same resolution as getImageBytes) and write it
   * to disk under MCP_IMAGE_SAVE_DIR (default /data/images).
   *
   * Operators bind-mount the host directory they want images to
   * land in onto MCP_IMAGE_SAVE_DIR inside the container. Files
   * become reachable from outside via that bind mount.
   *
   * `filename` is a basename — no path separators, no traversal
   * sequences. Defense against an LLM that's been tricked into
   * passing "../../etc/passwd" or similar.
   */
  async saveImage(args: {
    ratingKey?: string;
    imageUrl?: string;
    imageType?: "thumb" | "art" | "banner" | "squareArt" | "clearLogo";
    maxWidth?: number;
    maxHeight?: number;
    filename: string;
  }): Promise<{ path: string; bytes_written: number; mime_type: string }> {
    if (!args.filename) {
      throw new Error("saveImage: filename is required");
    }
    assertSafeBasename(args.filename, "saveImage");
    const baseDir = process.env.MCP_IMAGE_SAVE_DIR ?? "/data/images";
    ensureSaveDir(baseDir, "saveImage", "MCP_IMAGE_SAVE_DIR");
    const { bytes, mimeType } = await this.getImageBytes({
      ratingKey: args.ratingKey,
      imageUrl: args.imageUrl,
      imageType: args.imageType,
      maxWidth: args.maxWidth,
      maxHeight: args.maxHeight,
    });
    const path = writeBytesToPath(baseDir, args.filename, bytes, "saveImage");
    log.info("plex", "image saved", {
      path,
      bytes: bytes.byteLength,
      mime: mimeType,
    });
    return {
      path,
      bytes_written: bytes.byteLength,
      mime_type: mimeType,
    };
  }

  /**
   * Download Plex Media Server's own diagnostic log bundle and save it
   * to disk (mirrors saveImage's disk-write pattern; returns a manifest,
   * not the bytes inline — a log ZIP would blow an LLM context budget).
   *
   * GET /diagnostics/logs, confirmed against python-plexapi's
   * PlexServer.downloadLogs() (same endpoint, same X-Plex-Token header
   * auth as every other call here) and independently corroborated by
   * Plex's own support docs. Response is expected to be a ZIP archive —
   * left as-is (not auto-unpacked) since neither source confirmed the
   * exact Content-Type PMS sends, and unzip-on-write adds a failure mode
   * for no clear benefit (the caller can unzip the saved file if they
   * want its contents; filesystem-mcp already has that capability).
   */
  async downloadLogs(
    args: { filename?: string } = {},
  ): Promise<{ path: string; bytes_written: number; mime_type: string }> {
    const filename = args.filename ?? `plex-logs-${Date.now()}.zip`;
    assertSafeBasename(filename, "downloadLogs");
    const baseDir = process.env.MCP_LOG_SAVE_DIR ?? "/data/logs";
    ensureSaveDir(baseDir, "downloadLogs", "MCP_LOG_SAVE_DIR");

    const url = new URL("/diagnostics/logs", this.config.url);
    const { buffer, mimeType } = await this.fetchCappedBinary(
      url,
      { "X-Plex-Token": this.config.token },
      {
        cap: resolveLogMaxBytes(process.env.MCP_LOG_MAX_BYTES),
        capEnvVarName: "MCP_LOG_MAX_BYTES",
        subject: "Plex logs bundle",
        defaultMimeType: "application/zip",
        logLabel: "logs",
        timeoutMsOverride: resolveLogFetchTimeoutMs(
          process.env.MCP_LOG_FETCH_TIMEOUT_MS,
        ),
      },
    );

    const savePath = writeBytesToPath(
      baseDir,
      filename,
      buffer,
      "downloadLogs",
    );
    log.info("plex", "logs saved", {
      path: savePath,
      bytes: buffer.byteLength,
      mime: mimeType,
    });
    return {
      path: savePath,
      bytes_written: buffer.byteLength,
      mime_type: mimeType,
    };
  }

  /**
   * Merge other Plex items INTO the target item. The target's
   * ratingKey, GUID, and metadata survive; the listed sources are
   * absorbed (their ratingKeys disappear, their Media variants
   * become Media variants of the target).
   *
   * Use case: clean up duplicates from differently-named release
   * directories (the audit's WWE Royal Rumble 2026 triplicate at
   * 206822 / 207232 / 207233). Routing through merge sidesteps the
   * apply_match hook false-positives that blocked the re-match
   * approach.
   *
   * Reversible via `splitItem(thisRatingKey)` — but the resulting
   * split items take new ratingKeys (not the originals). Empty 200.
   *
   * Not covered by an automated round-trip test: destructive on
   * shared real Plex. Verify manually against real use cases.
   */
  async mergeItems(
    intoRatingKey: string,
    sourceRatingKeys: string[],
  ): Promise<void> {
    if (sourceRatingKeys.length === 0) {
      throw new Error("mergeItems: sourceRatingKeys must be non-empty");
    }
    await this.requestNoContent(
      `/library/metadata/${intoRatingKey}/merge`,
      { ids: sourceRatingKeys.join(",") },
      "PUT",
    );
  }

  /**
   * Resolve and fetch image bytes for a Plex item. See the
   * plex_get_image tool registration for the user-facing contract.
   *
   * Resolution order:
   * 1. If `imageUrl` is given, use it directly (must be relative).
   * 2. Otherwise look up the item by `ratingKey`. Direct fields
   *    (`thumb`, `art`, `banner`) win over Image[] entries because
   *    they reflect the *selected* image; Image[] is the agent's
   *    full candidate set.
   *
   * When `maxWidth`/`maxHeight` is set, route through Plex's
   * `/photo/:/transcode` endpoint so the server resamples rather
   * than us pulling a 5 MB original.
   */
  async getImageBytes(args: {
    ratingKey?: string;
    imageUrl?: string;
    imageType?: "thumb" | "art" | "banner" | "squareArt" | "clearLogo";
    maxWidth?: number;
    maxHeight?: number;
  }): Promise<{ bytes: Buffer; mimeType: string }> {
    const relativeUrl = args.imageUrl
      ? args.imageUrl
      : await this.resolveImagePath(args.ratingKey!, args.imageType ?? "thumb");

    if (args.maxWidth || args.maxHeight) {
      // Plex's /photo/:/transcode rejects requests with width-only
      // or height-only. When only one dimension is provided, mirror
      // it to the other — Plex resamples to fit the bounding box
      // and preserves aspect ratio internally.
      const dim = String(args.maxWidth ?? args.maxHeight);
      const params: Record<string, string> = {
        url: relativeUrl,
        width: args.maxWidth ? String(args.maxWidth) : dim,
        height: args.maxHeight ? String(args.maxHeight) : dim,
        minSize: "1",
        upscale: "0",
      };
      return this.fetchBinary("/photo/:/transcode", params);
    }
    return this.fetchBinary(relativeUrl);
  }

  private async resolveImagePath(
    ratingKey: string,
    imageType: "thumb" | "art" | "banner" | "squareArt" | "clearLogo",
  ): Promise<string> {
    const item = (await this.getItem(ratingKey)) as
      | {
          thumb?: string;
          art?: string;
          banner?: string;
          Image?: Array<{ type?: string; url?: string }>;
        }
      | undefined;
    if (!item) {
      throw new Error(`Plex item not found for ratingKey=${ratingKey}`);
    }

    const directField =
      imageType === "thumb"
        ? item.thumb
        : imageType === "art"
          ? item.art
          : imageType === "banner"
            ? item.banner
            : undefined;
    if (directField) return directField;

    // Fall back to Image[] for types without a direct field, and
    // for banner when the direct field is unset.
    const imageEntryType =
      imageType === "squareArt"
        ? "clearArt"
        : imageType === "clearLogo"
          ? "clearLogo"
          : imageType === "banner"
            ? "banner"
            : imageType === "art"
              ? "background"
              : "coverPoster";
    const entry = item.Image?.find((i) => i.type === imageEntryType);
    if (entry?.url) return entry.url;

    throw new Error(
      `Plex item ${ratingKey} has no image of type "${imageType}"`,
    );
  }

  /**
   * Fetch a URL through the timeout+retry chokepoint and enforce a
   * byte cap in two stages — the content-length header (cheap, catches
   * most oversized responses before download) and the actual decoded
   * byte count (in case a server lies about or omits content-length) —
   * then resolve a MIME type from content-type. Shared by fetchBinary/
   * downloadLogs so this fetch/error/cap-check contract can't drift
   * between the two binary-fetch call sites (phase-end audit finding,
   * 2026-08-03). Callers own anything specific to their call site: URL
   * construction/safety checks, extra headers, and the cap's source.
   */
  private async fetchCappedBinary(
    url: URL,
    headers: Record<string, string>,
    opts: {
      cap: number;
      capEnvVarName: string;
      subject: string;
      defaultMimeType: string;
      logLabel: string;
      timeoutMsOverride?: number;
      advice?: string;
    },
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const {
      cap,
      capEnvVarName,
      subject,
      defaultMimeType,
      logLabel,
      timeoutMsOverride,
      advice,
    } = opts;
    const path = url.pathname;
    const start = Date.now();
    log.debug("plex", `fetch ${logLabel}`, { path });
    let res: Response;
    try {
      res = await this.fetchWithTimeoutAndRetry(
        url,
        { headers },
        timeoutMsOverride,
      );
    } catch (err) {
      log.error("plex", "network error", {
        path,
        ms: Date.now() - start,
        msg: (err as Error).message,
      });
      throw err;
    }
    const ms = Date.now() - start;
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.warn("plex", "http error", { path, status: res.status, ms });
      throw new Error(
        `Plex ${res.status} ${res.statusText} for GET ${path}: ${body.slice(0, 200)}`,
      );
    }

    const adviceSuffix = advice ? ` ${advice}` : "";
    const contentLength = res.headers.get("content-length");
    if (contentLength && Number.parseInt(contentLength, 10) > cap) {
      throw new Error(
        `${subject} is ${contentLength} bytes, exceeds ${capEnvVarName}=${cap}.${adviceSuffix}`,
      );
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > cap) {
      throw new Error(
        `${subject} is ${buffer.byteLength} bytes (no content-length header), exceeds ${capEnvVarName}=${cap}.${adviceSuffix}`,
      );
    }

    const rawType = res.headers.get("content-type") ?? defaultMimeType;
    const mimeType = rawType.split(";")[0]!.trim();
    log.debug("plex", `ok ${logLabel}`, {
      path,
      status: res.status,
      ms,
      bytes: buffer.byteLength,
      mime: mimeType,
    });
    return { buffer, mimeType };
  }

  private async fetchBinary(
    path: string,
    params: Record<string, string> = {},
  ): Promise<{ bytes: Buffer; mimeType: string }> {
    const url = new URL(path, this.config.url);
    // Same-origin choke point: `path` may originate from tool input
    // (image_url). A protocol-relative ("//host/x"), backslash
    // ("/\\host/x"), or absolute URL would resolve off-server and
    // leak X-Plex-Token to an arbitrary host. The tool layer rejects
    // those shapes too; this assertion is the defense in depth.
    if (url.origin !== new URL(this.config.url).origin) {
      throw new Error(
        `fetchBinary: refusing off-server URL (resolved host ${url.host} != Plex server); image paths must be relative to the configured Plex server`,
      );
    }
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
    const { buffer, mimeType } = await this.fetchCappedBinary(
      url,
      { "X-Plex-Token": this.config.token, Accept: "image/*" },
      {
        cap: resolveImageMaxBytes(process.env.MCP_IMAGE_MAX_BYTES),
        capEnvVarName: "MCP_IMAGE_MAX_BYTES",
        subject: `Plex image at ${path}`,
        defaultMimeType: "image/jpeg",
        logLabel: "binary",
        advice: "Pass max_width or max_height to transcode.",
      },
    );
    return { bytes: buffer, mimeType };
  }
}
