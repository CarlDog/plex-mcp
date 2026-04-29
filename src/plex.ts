export interface PlexConfig {
  url: string;
  token: string;
}

interface PlexResponse<T> {
  MediaContainer?: T & { size?: number };
}

export class PlexClient {
  constructor(private readonly config: PlexConfig) {}

  private async request<T>(
    path: string,
    params: Record<string, string> = {},
  ): Promise<PlexResponse<T>> {
    const url = new URL(path, this.config.url);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
    const res = await fetch(url, {
      headers: {
        "X-Plex-Token": this.config.token,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Plex ${res.status} ${res.statusText} for ${path}: ${body.slice(0, 200)}`,
      );
    }
    return (await res.json()) as PlexResponse<T>;
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
}
