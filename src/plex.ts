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

  async getItem(ratingKey: string): Promise<unknown> {
    const data = await this.request<{ Metadata?: unknown[] }>(
      `/library/metadata/${ratingKey}`,
    );
    return data.MediaContainer?.Metadata?.[0];
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
    options: { offset?: number; limit?: number; type?: number } = {},
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
    const items = data.MediaContainer?.Metadata ?? [];
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
}
