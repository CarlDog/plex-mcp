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

  private async request<T>(
    path: string,
    params: Record<string, string> = {},
    headers: Record<string, string> = {},
    method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  ): Promise<PlexResponse<T>> {
    const url = new URL(path, this.config.url);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
    const start = Date.now();
    log.debug("plex", "request", { method, path });
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          "X-Plex-Token": this.config.token,
          Accept: "application/json",
          ...headers,
        },
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
    const url = new URL(path, this.config.url);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
    const start = Date.now();
    log.debug("plex", "request", { method, path });
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: { "X-Plex-Token": this.config.token },
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
      | Record<string, unknown>
      | undefined;
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
    // with deep casts. Stream[] inside each Media.Part adds another
    // ~3KB per file. UltraBlurColors is purely cosmetic. The kept
    // fields cover the operational use cases (file path, GUID,
    // locked-field state, title/year/edition, viewed state).
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
                      if (pk === "Stream") continue;
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
    if (
      args.filename.includes("/") ||
      args.filename.includes("\\") ||
      args.filename.includes("..") ||
      args.filename.startsWith(".")
    ) {
      throw new Error(
        `saveImage: filename must be a basename (no '/', '\\', '..', or leading '.'); got ${JSON.stringify(args.filename)}`,
      );
    }
    const baseDir = process.env.MCP_IMAGE_SAVE_DIR ?? "/data/images";
    const { bytes, mimeType } = await this.getImageBytes({
      ratingKey: args.ratingKey,
      imageUrl: args.imageUrl,
      imageType: args.imageType,
      maxWidth: args.maxWidth,
      maxHeight: args.maxHeight,
    });
    try {
      mkdirSync(baseDir, { recursive: true });
    } catch (err) {
      throw new Error(
        `saveImage: could not create save dir ${baseDir}: ${(err as Error).message}. Set MCP_IMAGE_SAVE_DIR to a writable path.`,
      );
    }
    const path = join(baseDir, args.filename);
    try {
      writeFileSync(path, bytes);
    } catch (err) {
      throw new Error(
        `saveImage: could not write ${path}: ${(err as Error).message}`,
      );
    }
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

  private async fetchBinary(
    path: string,
    params: Record<string, string> = {},
  ): Promise<{ bytes: Buffer; mimeType: string }> {
    const url = new URL(path, this.config.url);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
    const start = Date.now();
    log.debug("plex", "fetch binary", { path });
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          "X-Plex-Token": this.config.token,
          Accept: "image/*",
        },
      });
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

    const cap = Number.parseInt(
      process.env.MCP_IMAGE_MAX_BYTES ?? "4194304",
      10,
    );
    const contentLength = res.headers.get("content-length");
    if (contentLength && Number.parseInt(contentLength, 10) > cap) {
      throw new Error(
        `Plex image at ${path} is ${contentLength} bytes, exceeds MCP_IMAGE_MAX_BYTES=${cap}. Pass max_width or max_height to transcode.`,
      );
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > cap) {
      throw new Error(
        `Plex image at ${path} is ${buffer.byteLength} bytes (no content-length header), exceeds MCP_IMAGE_MAX_BYTES=${cap}. Pass max_width or max_height to transcode.`,
      );
    }

    const rawType = res.headers.get("content-type") ?? "image/jpeg";
    const mimeType = rawType.split(";")[0]!.trim();
    log.debug("plex", "ok binary", {
      path,
      status: res.status,
      ms,
      bytes: buffer.byteLength,
      mime: mimeType,
    });
    return { bytes: buffer, mimeType };
  }
}
