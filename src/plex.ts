import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, parse } from "node:path";
import { describeTransportError } from "./errors.js";
import { log } from "./log.js";
import { annotateSubtitleStream } from "./subtitle.js";

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

export type PlexExternalIdSource = "imdb" | "tmdb" | "tvdb";

const EXTERNAL_ID_SCAN_PAGE_SIZE = 200;
const DEFAULT_EXTERNAL_ID_SCAN_MAX_ITEMS = 10_000;
const MAX_EXTERNAL_ID_SCAN_ITEMS = 50_000;
const EXTERNAL_ID_RESULT_FIELDS = [
  "ratingKey",
  "key",
  "guid",
  "Guid",
  "type",
  "title",
  "year",
  "originallyAvailableAt",
  "librarySectionID",
  "librarySectionTitle",
  "parentRatingKey",
  "parentTitle",
  "grandparentRatingKey",
  "grandparentTitle",
  "index",
  "parentIndex",
];

export function itemHasExternalGuid(
  item: unknown,
  targetGuid: string,
): boolean {
  if (typeof item !== "object" || item === null) return false;
  const guids = (item as { Guid?: unknown }).Guid;
  if (!Array.isArray(guids)) return false;
  return guids.some(
    (guid) =>
      typeof guid === "object" &&
      guid !== null &&
      (guid as { id?: unknown }).id === targetGuid,
  );
}

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

export const PLEX_PRIMARY_LOG_FILENAME = "Plex Media Server.log";

export type PlexLogFallbackReason = `plex_http_${number}` | "transport_error";

export function classifyPlexLogFallback(
  err: unknown,
): PlexLogFallbackReason | null {
  const message = describeTransportError(err);
  const status = message.match(/^Plex (\d{3})\b/u)?.[1];
  if (status) {
    const code = Number.parseInt(status, 10);
    return code >= 500 && code <= 599 ? `plex_http_${code}` : null;
  }
  return /(?:fetch failed|abort|timeout|timed out|ECONN|ENOTFOUND|EAI_AGAIN|UND_ERR)/iu.test(
    message,
  )
    ? "transport_error"
    : null;
}

export function resolveFallbackLogFilename(
  requested: string | undefined,
  now = Date.now(),
): string {
  if (!requested) return `plex-server-log-${now}.log`;
  assertSafeBasename(requested, "downloadLogs");
  const parsed = parse(requested);
  return parsed.ext.toLowerCase() === ".log"
    ? requested
    : `${parsed.name}.fallback.log`;
}

export function readPrimaryPlexLog(
  sourceDir: string,
  maxBytes: number,
): Buffer {
  const sourcePath = join(sourceDir, PLEX_PRIMARY_LOG_FILENAME);
  try {
    const stat = lstatSync(sourcePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error("source is not a regular non-symlink file");
    }
    if (stat.size > maxBytes) {
      throw new Error(
        `source is ${stat.size} bytes, exceeds MCP_LOG_MAX_BYTES=${maxBytes}`,
      );
    }
    const buffer = readFileSync(sourcePath);
    if (buffer.byteLength > maxBytes) {
      throw new Error(
        `source grew to ${buffer.byteLength} bytes while reading, exceeds MCP_LOG_MAX_BYTES=${maxBytes}`,
      );
    }
    return buffer;
  } catch (err) {
    throw new Error(
      `Plex filesystem log fallback could not read ${sourcePath}: ${describeTransportError(err)}. Verify HOST_PLEX_LOG_SOURCE_DIR is mounted read-only and MCP_PLEX_LOG_SOURCE_DIR points to that mount.`,
      { cause: err },
    );
  }
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
    body?: Buffer,
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
        ...(body ? { body: body as BodyInit } : {}),
      });
    } catch (err) {
      const message = describeTransportError(err);
      log.error("plex", "network error", {
        method,
        path,
        ms: Date.now() - start,
        msg: message,
      });
      throw err instanceof Error && message !== err.message
        ? new Error(message, { cause: err })
        : err;
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
    body?: Buffer,
  ): Promise<void> {
    await this.sendRequest(path, params, {}, method, body);
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

  /**
   * "On deck" items — server-wide, or scoped to one library section.
   *
   * `GET /library/onDeck` (server-wide) or `GET
   * /library/sections/{sectionId}/onDeck` (section-scoped), confirmed
   * against `LukasParke/plex-api-spec`'s `getOnDeckForSection` operation
   * (python-plexapi doesn't model this endpoint at all).
   */
  async onDeck(sectionId?: string): Promise<unknown[]> {
    const path = sectionId
      ? `/library/sections/${sectionId}/onDeck`
      : "/library/onDeck";
    const data = await this.request<{ Metadata?: unknown[] }>(path);
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
    // below): language/codec/id and a normalized hearingImpaired flag
    // are cheap and useful, unlike the audio/video entries' per-frame
    // codec detail that's the actual bulk cost. Current Plex payloads
    // mark SDH in title/display metadata rather than a native boolean,
    // so minimal mode derives the stable field explicitly.
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
                        trimmedPart[pk] = (pv as Array<Record<string, unknown>>)
                          .filter((s) => s.streamType === SUBTITLE_STREAM_TYPE)
                          .map(annotateSubtitleStream);
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
      includeGuids?: boolean;
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
    if (options.includeGuids) {
      params.includeGuids = "1";
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
   * Resolve a provider ID by scanning one library section's paged listing.
   * Plex exposes IMDb/TMDB/TVDB IDs as child Guid[] entries when
   * includeGuids=1; its `guid=` filter only matches the primary Plex GUID on
   * tested servers, so this deliberately compares child GUIDs client-side.
   *
   * The scan is bounded and returns every exact match within the scanned
   * range. Callers must inspect `complete`/`truncated` before treating an empty
   * result as authoritative.
   */
  async findByExternalId(
    sectionId: string,
    source: PlexExternalIdSource,
    externalId: string,
    options: { type?: number; maxItems?: number } = {},
  ): Promise<{
    sectionId: string;
    source: PlexExternalIdSource;
    externalId: string;
    targetGuid: string;
    scanned: number;
    total: number;
    complete: boolean;
    truncated: boolean;
    matches: unknown[];
  }> {
    const normalizedExternalId = externalId.trim().toLowerCase();
    const targetGuid = `${source}://${normalizedExternalId}`;
    const requestedMaxItems = options.maxItems;
    const maxItems =
      requestedMaxItems !== undefined &&
      Number.isFinite(requestedMaxItems) &&
      requestedMaxItems > 0
        ? Math.min(Math.trunc(requestedMaxItems), MAX_EXTERNAL_ID_SCAN_ITEMS)
        : DEFAULT_EXTERNAL_ID_SCAN_MAX_ITEMS;
    const matches: unknown[] = [];
    let scanned = 0;
    let total = 0;

    while (scanned < maxItems) {
      const page = await this.browse(sectionId, {
        offset: scanned,
        limit: Math.min(EXTERNAL_ID_SCAN_PAGE_SIZE, maxItems - scanned),
        type: options.type,
        includeGuids: true,
        fields: EXTERNAL_ID_RESULT_FIELDS,
      });
      total = page.total;
      for (const item of page.items) {
        if (itemHasExternalGuid(item, targetGuid)) matches.push(item);
      }
      scanned += page.size;
      if (page.size === 0 || scanned >= total) break;
    }

    const complete = scanned >= total;
    return {
      sectionId,
      source,
      externalId: normalizedExternalId,
      targetGuid,
      scanned,
      total,
      complete,
      truncated: !complete,
      matches,
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
   * Set (or clear) an item's user star rating.
   *
   * `PUT /:/rate?key={ratingKey}&identifier=com.plexapp.plugins.library
   * &rating={rating}` — confirmed against python-plexapi's
   * `RatingMixin.rate()` (`plexapi/mixins/rating.py`). Rating is 0-10;
   * Plex displays it out of 5 stars (7.0 = 3.5 stars). Omitting `rating`
   * clears it — Plex's convention for "no rating" is the literal value
   * `-1`, which is what python-plexapi sends when its own `rating`
   * argument is omitted.
   */
  async rateItem(ratingKey: string, rating?: number): Promise<void> {
    const value = rating === undefined ? -1 : rating;
    await this.requestNoContent(
      "/:/rate",
      {
        key: ratingKey,
        identifier: "com.plexapp.plugins.library",
        rating: String(value),
      },
      "PUT",
    );
  }

  /**
   * Remove an item from the Continue Watching hub without touching its
   * watch progress. `PUT /actions/removeFromContinueWatching?ratingKey=
   * {ratingKey}` — captured live from Plex Web itself (DevTools network
   * capture, 2026-08-29), not from docs: the real param is `ratingKey`,
   * not `key` as `LukasParke/plex-api-spec` documents it (that mismatch
   * is exactly why an earlier attempt against the documented shape got a
   * blanket 400 no matter what was tried). No `identifier=` param and no
   * client-identity headers needed — confirmed by the capture. Verified
   * the item's `viewOffset`/`lastViewedAt` are unaffected; this only
   * flips a "hidden from Continue Watching" flag that clears again the
   * next time the item is resumed. Empty 200 response.
   */
  async removeFromContinueWatching(ratingKey: string): Promise<void> {
    await this.requestNoContent(
      "/actions/removeFromContinueWatching",
      { ratingKey },
      "PUT",
    );
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
  async downloadLogs(args: { filename?: string } = {}): Promise<{
    path: string;
    bytes_written: number;
    mime_type: string;
    source: "plex_api" | "filesystem_fallback";
    fallback_reason: PlexLogFallbackReason | null;
  }> {
    const filename = args.filename ?? `plex-logs-${Date.now()}.zip`;
    assertSafeBasename(filename, "downloadLogs");
    const baseDir = process.env.MCP_LOG_SAVE_DIR ?? "/data/logs";
    ensureSaveDir(baseDir, "downloadLogs", "MCP_LOG_SAVE_DIR");

    const url = new URL("/diagnostics/logs", this.config.url);
    const cap = resolveLogMaxBytes(process.env.MCP_LOG_MAX_BYTES);
    let buffer: Buffer;
    let mimeType: string;
    let outputFilename = filename;
    let source: "plex_api" | "filesystem_fallback" = "plex_api";
    let fallbackReason: PlexLogFallbackReason | null = null;
    try {
      const apiResult = await this.fetchCappedBinary(
        url,
        { "X-Plex-Token": this.config.token },
        {
          cap,
          capEnvVarName: "MCP_LOG_MAX_BYTES",
          subject: "Plex logs bundle",
          defaultMimeType: "application/zip",
          logLabel: "logs",
          timeoutMsOverride: resolveLogFetchTimeoutMs(
            process.env.MCP_LOG_FETCH_TIMEOUT_MS,
          ),
        },
      );
      buffer = apiResult.buffer;
      mimeType = apiResult.mimeType;
    } catch (err) {
      fallbackReason = classifyPlexLogFallback(err);
      if (!fallbackReason) throw err;

      const sourceDir = process.env.MCP_PLEX_LOG_SOURCE_DIR ?? "/plex-logs";
      buffer = readPrimaryPlexLog(sourceDir, cap);
      mimeType = "text/plain";
      outputFilename = resolveFallbackLogFilename(args.filename);
      source = "filesystem_fallback";
      log.warn("plex", "log API unavailable; using filesystem fallback", {
        reason: fallbackReason,
        bytes: buffer.byteLength,
      });
    }

    const savePath = writeBytesToPath(
      baseDir,
      outputFilename,
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
      source,
      fallback_reason: fallbackReason,
    };
  }

  /**
   * List every poster candidate Plex knows about for an item —
   * agent-supplied (TMDB/TVDB), locally-scanned, and previously
   * uploaded — including which one is currently active. Each entry's
   * shape is `{key, ratingKey, thumb, selected, provider?}`; `ratingKey`
   * here is the *candidate's* own identifier (e.g.
   * "upload://posters/<hash>" or an external image URL), not the
   * item's. Confirmed against a live capture (2026-08-03) and
   * python-plexapi's PosterMixin.posters() (plexapi/mixins/resources.py).
   */
  async listPosters(ratingKey: string): Promise<unknown[]> {
    const data = await this.request<{ Metadata?: unknown[] }>(
      `/library/metadata/${ratingKey}/posters`,
    );
    return data.MediaContainer?.Metadata ?? [];
  }

  /**
   * Select an existing poster candidate as the active poster.
   *
   * `PUT /library/metadata/{ratingKey}/poster` (the *singular*
   * "poster" endpoint — distinct from the plural "posters" list/
   * upload endpoint) `?url={posterRatingKey}`. `posterRatingKey` is a
   * candidate's own `ratingKey` from `listPosters()`, not the item's.
   * Confirmed against python-plexapi's `BaseResource.select()`
   * (plexapi/media.py) and live (2026-08-03): select, verify via
   * `getItem`'s `thumb` field, then revert — all round-tripped clean.
   */
  async setPoster(ratingKey: string, posterRatingKey: string): Promise<void> {
    await this.requestNoContent(
      `/library/metadata/${ratingKey}/poster`,
      { url: posterRatingKey },
      "PUT",
    );
  }

  /**
   * Add a new poster candidate from an external URL (Plex fetches it
   * server-side) or a local file already on disk under
   * `MCP_IMAGE_SAVE_DIR` (the `saveImage` output convention) — exactly
   * one of `url`/`filename`. `POST /library/metadata/{ratingKey}/posters`,
   * confirmed against python-plexapi's `PosterMixin.uploadPoster()`:
   * `url` as a query param, or the raw file bytes as the request body,
   * never both.
   *
   * Two things confirmed live (2026-08-03) that aren't obvious from
   * python-plexapi's source alone:
   * - The raw POST response is always a 200 with an **empty body**, so
   *   the newly added candidate's identity has to come from a
   *   before/after diff of `listPosters()`, not the upload response.
   * - **Plex auto-selects every freshly uploaded poster server-side.**
   *   python-plexapi's separate `setPoster()`/`select()` call is for
   *   switching between already-existing candidates, not required
   *   after an upload — confirmed by uploading via `url=`, observing
   *   `selected: true` on the new candidate with zero PUT calls made,
   *   and the item's `thumb` field changing to match.
   *
   * `select` (default `true`) trades on that: `false` restores
   * whichever candidate was selected *before* the upload, so the new
   * one is added without changing what's currently displayed — for
   * review-before-applying workflows. Not idempotent: each call adds a
   * new candidate regardless of `select`.
   */
  async uploadPoster(args: {
    ratingKey: string;
    url?: string;
    filename?: string;
    select?: boolean;
  }): Promise<{ posterRatingKey: string; thumb: string; selected: boolean }> {
    if (!args.url && !args.filename) {
      throw new Error("uploadPoster: either url or filename must be provided");
    }
    if (args.url && args.filename) {
      throw new Error(
        "uploadPoster: only one of url or filename may be provided",
      );
    }
    const select = args.select ?? true;

    type PosterEntry = {
      ratingKey?: string;
      thumb?: string;
      selected?: boolean;
    };
    const before = (await this.listPosters(args.ratingKey)) as PosterEntry[];
    const beforeKeys = new Set(before.map((p) => p.ratingKey));
    const previousSelected = before.find((p) => p.selected);

    if (args.url) {
      await this.requestNoContent(
        `/library/metadata/${args.ratingKey}/posters`,
        { url: args.url },
        "POST",
      );
    } else {
      assertSafeBasename(args.filename!, "uploadPoster");
      const baseDir = process.env.MCP_IMAGE_SAVE_DIR ?? "/data/images";
      const filePath = join(baseDir, args.filename!);
      let bytes: Buffer;
      try {
        bytes = readFileSync(filePath);
      } catch (err) {
        throw new Error(
          `uploadPoster: could not read ${filePath}: ${(err as Error).message}`,
          { cause: err },
        );
      }
      await this.requestNoContent(
        `/library/metadata/${args.ratingKey}/posters`,
        {},
        "POST",
        bytes,
      );
    }

    // Plex auto-selects the new candidate regardless of `select` — see
    // the doc comment above. If Plex deduped an identical URL instead
    // of adding a literal new entry, fall back to whatever's currently
    // selected rather than assuming a diff always finds something new.
    const after = (await this.listPosters(args.ratingKey)) as PosterEntry[];
    const fresh = after.find(
      (p) => p.ratingKey && !beforeKeys.has(p.ratingKey),
    );
    const current = fresh ?? after.find((p) => p.selected);
    if (!current?.ratingKey) {
      throw new Error(
        "uploadPoster: could not identify the newly added poster candidate after upload",
      );
    }

    if (!select && previousSelected?.ratingKey) {
      await this.setPoster(args.ratingKey, previousSelected.ratingKey);
    }

    return {
      posterRatingKey: current.ratingKey,
      thumb: current.thumb ?? "",
      selected: select,
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
