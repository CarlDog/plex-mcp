# Plex HTTP API — reference & gotchas

There is no official Plex API documentation. This file curates the
external references, captures gotchas we've hit while building
plex-mcp, and notes endpoints we haven't built yet so future-us has
a starting point.

This is a living document. When you discover a new quirk, add it here.

## External references

The community-maintained sources that come closest to authoritative:

- **[plexapi.dev](https://plexapi.dev/)** — de-facto API reference.
  Endpoints, query params, response shapes. Most thorough thing
  available; start here.
- **[python-plexapi source](https://github.com/pkkid/python-plexapi/tree/master/plexapi)** —
  when plexapi.dev is silent on an endpoint, the Python lib's source
  is often the only documentation. Useful files: `library.py`,
  `media.py`, `playlist.py`, `audio.py`, `video.py`.
- **[LukeHagar/plex-api-spec](https://github.com/LukeHagar/plex-api-spec)** —
  community OpenAPI 3 spec. Partial coverage, machine-readable.
- **DevTools spying** — Plex's own Web client at `app.plex.tv` calls
  the same API. Open browser DevTools → Network tab while clicking
  around to see real-world calls and responses. Last-resort discovery
  for undocumented endpoints.

## Gotchas we've hit

### Pagination — `Start` and `Size` must come together

`X-Plex-Container-Start` and `X-Plex-Container-Size` (as either
headers or query params) are required as a **pair**. Sending only
`Size` is silently ignored — Plex returns the full result set.

`PlexClient.browse` and `PlexClient.history` always send both with
defaults `Start=0, Size=50` whenever paging is in play. Don't make
either conditional on user input.

### `/:/scrobble` and `/:/unscrobble` return empty 200s

The watch-state mutation endpoints don't return JSON — body is empty.
The default `PlexClient.request` calls `res.json()` unconditionally
and would throw. `PlexClient.requestNoContent` exists for this case.

### `/:/scrobble` overwrites `lastViewedAt` and writes a new history entry every call

Calling `scrobble` on an already-watched item is **not** a no-op. Each
call:

- Sets `lastViewedAt` to "now" (replacing the previous value)
- Writes a new entry to `/status/sessions/history/all`, *replacing*
  any existing history entry for the same item (the original entry's
  timestamp is lost)

Verified empirically via round-trip (`mark_watched` → `mark_unwatched`
→ `mark_watched`): the item's `lastViewedAt` returned to "watched"
state but with the timestamp of the third call, not the original.

Implications:

- "Continue Watching" / "On Deck" sorting treats a re-scrobbled item
  as just-watched, which can shuffle the user's queue.
- An LLM tool-using `plex_mark_watched` defensively to "make sure
  it's marked watched" will silently destroy the original
  `lastViewedAt`. Don't call mark_watched if the state is already
  correct.
- `plex_mark_unwatched` does not have this issue — it just clears
  state.

`/:/unscrobble` followed by `/:/scrobble` is a *destructive* round
trip on the timestamp. There's no Plex API to set `lastViewedAt` to
a specific value; the only way to set it is via the live timeline
endpoint while playback is occurring.

### `type` filter expects integer codes

`/library/sections/{id}/all?type=N` accepts integers:

| Code | Type    |
| ---- | ------- |
| 1    | movie   |
| 2    | show    |
| 3    | season  |
| 4    | episode |
| 8    | artist  |
| 9    | album   |
| 10   | track   |

`plex_browse` exposes the friendly enum names externally and
translates internally via `PLEX_TYPE_CODES` in `src/index.ts`.

### Container DNS — host can't see its own hostname

A Docker container running plex-mcp on the same host as Plex Media
Server can't reach Plex via the host's hostname (e.g. `my-nas:32400`).
Containers have their own DNS context.

Fix: set `PLEX_URL=http://host.docker.internal:32400` and use the
`extra_hosts: ["host.docker.internal:host-gateway"]` mapping in
`docker-compose.yml`. The compose file already includes the mapping
by default.

## Endpoints currently used

| Tool                  | Endpoint                                                               | Notes                                                                  |
| --------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `plex_list_libraries` | `GET /library/sections`                                                | Returns `MediaContainer.Directory[]`                                   |
| `plex_search`         | `GET /search?query=...`                                                | Cross-library                                                          |
| `plex_recently_added` | `GET /library/recentlyAdded` or `/library/sections/{id}/recentlyAdded` | Section filter optional                                                |
| `plex_on_deck`        | `GET /library/onDeck`                                                  |                                                                        |
| `plex_get_item`       | `GET /library/metadata/{rating_key}`                                   | Returns first `Metadata[]` entry                                       |
| `plex_get_children`   | `GET /library/metadata/{rating_key}/children`                          | Show→seasons, season→episodes, artist→albums, album→tracks             |
| `plex_browse`         | `GET /library/sections/{id}/all`                                       | Paged via `X-Plex-Container-Start/Size` headers; optional `type=N`     |
| `plex_now_playing`    | `GET /status/sessions`                                                 | Empty array when nothing playing                                       |
| `plex_history`        | `GET /status/sessions/history/all`                                     | Paged; `sort=viewedAt:desc`; optional `librarySectionID`               |
| `plex_mark_watched`   | `GET /:/scrobble?key=...&identifier=com.plexapp.plugins.library`       | Empty 200 — use `requestNoContent`                                     |
| `plex_mark_unwatched` | `GET /:/unscrobble?key=...&identifier=com.plexapp.plugins.library`     | Empty 200                                                              |
| `plex_list_playlists` | `GET /playlists`                                                       | Includes both regular and smart playlists                              |
| `plex_get_playlist_items` | `GET /playlists/{id}/items`                                        | Each item has `playlistItemID` (≠ `ratingKey`)                         |
| `plex_create_playlist` | `POST /playlists?type=&title=&smart=0&uri=server://...`               | Requires at least one initial item via `uri=`                          |
| `plex_add_to_playlist` | `PUT /playlists/{id}/items?uri=server://...`                          | `uri=` uses `metadataUri()` helper for shape                           |
| `plex_remove_from_playlist` | `DELETE /playlists/{id}/items/{playlistItemID}`                  | Path uses `playlistItemID`, not `ratingKey`                            |
| `plex_delete_playlist` | `DELETE /playlists/{id}`                                              | Metadata only; media files untouched                                   |

All requests carry `X-Plex-Token: <token>` as an HTTP header
(`PlexClient.request`); never put the token in the URL query string.

## Endpoints we haven't built yet

Candidates for v0.3+ with rough endpoint shapes so future-us has a
starting point. **Not endorsed, not yet investigated** — verify
against plexapi.dev / python-plexapi before relying on the shape.

| Capability                              | Endpoint(s)                                                                              | Risk class               |
| --------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------ |
| Smart playlists (filter expressions)    | `POST /playlists?type=&smart=1&uri=` (filter shape via `library:///` URI)                | Medium (complex shape)   |
| Plex hubs (Continue Watching, etc.)     | `GET /hubs`, `GET /hubs/sections/{id}`                                                   | Low                      |
| Rate item                               | `PUT /:/rate?key=...&identifier=com.plexapp.plugins.library&rating=N` (0–10 → 0–5 stars) | Low                      |
| Edit metadata field                     | `PUT /library/metadata/{key}?<field>.value=...`                                          | Medium (LLM might mangle) |
| Refresh / scan section                  | `GET /library/sections/{id}/refresh[?force=1]`                                           | Medium (server load)     |
| Empty section trash                     | `PUT /library/sections/{id}/emptyTrash`                                                  | Medium (irreversible)    |
| Update playback timeline                | `GET /:/timeline?ratingKey=...&time=...&state=playing\|paused\|stopped`                  | Low                      |
| Player control (play/pause/skip)        | `/player/playback/playMedia`, `/player/playback/pause`, etc.                             | Medium (live device)     |
| Related / similar items                 | `GET /library/metadata/{key}/related`, `/similar`                                        | Low                      |
| Currently transcoding sessions          | `GET /transcode/sessions`                                                                | Low                      |

**Out of scope** (per scoping decision in v0.2): `DELETE /library/metadata/{key}`,
`DELETE /library/sections/{id}`, and any other operation that destroys
media or library structure. The cost of an LLM hallucinating a delete
call is too high relative to the value of the tool.
