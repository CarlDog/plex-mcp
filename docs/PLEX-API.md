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

### Items can be bound to `tv.plex.agents.none` (no source) — file renames won't fix the title

An item whose `agent` is `tv.plex.agents.none` (or any `*.agents.none`)
has no metadata source. Plex displays the raw filename as the title,
ignores TRaSH-style `{imdb-tt…}` / `{tmdb-…}` IDs, and won't re-match
on its own — even after a refresh. Locked fields
(`titleSort.locked=1`, `contentRating.locked=1`, etc.) on such an item
preserve whatever the user manually edited but don't unstick the
binding.

The fix is server-side, not filesystem:

1. `plex_get_matches` with `title` + `year` overrides parsed from the
   filename. Plex's scoring typically puts the right TMDB / TVDB entry
   first; pick its `guid` + `name`.
2. `plex_apply_match` with that GUID. This overwrites the binding from
   `agents.none` to the correct agent.
3. `plex_refresh_metadata` to pull poster, summary, cast, etc.

Locked field values survive across all three steps. This was the
root cause for 19 movies surfaced by a library audit (2026-05-08):
files on disk had perfect TRaSH-style names with embedded IDs, but
every item was on `agents.none`, so Plex displayed the raw release
filename as the title.

### Auto-merge: `apply_match` triggers it, `split` doesn't

When you call `plex_apply_match` and the new GUID matches an
existing item's GUID, Plex consolidates the two items on its next
rescan — the secondary ratingKey disappears (404), its Media
variants become Media variants of the surviving item. Observed
twice:

1. WWE Royal Rumble 2026 audit cleanup: rk 207232 was re-matched
   to the canonical GUID; Plex auto-removed it on rescan, leaving
   only 206822.
2. WWE SummerSlam 2025 Night 1 cleanup (2026-05-13 evening): six
   Saturday-file ratingKeys created by `plex_split_item` were all
   re-bound to the Night 1 GUID via `apply_match`. Plex auto-merged
   them 6 → 1 (rk 208829 survived) on rescan.

**`plex_split_item`, by contrast, does NOT trigger this auto-merge.**
The N items it creates all share the source's original GUID, but
they remain separate. To consolidate them you have to call
`plex_merge_items` explicitly. Verified empirically: after
splitting WWE SummerSlam Night 2 (rk 207172) into 11 items, the 5
that retained the Night 2 GUID stayed separate until I called
`plex_merge_items(207172, [208828, 208833, 208834, 208836])`.

Recipe for safely re-grouping a split-then-re-matched item:

1. `plex_split_item(rk)` → N new items, all on the source's GUID.
2. For items needing a different binding, `plex_apply_match` to the
   correct GUID — Plex auto-merges items sharing the new GUID into
   the first one bound to that GUID.
3. For items that should keep the original GUID (e.g. correctly-bound
   variants), `plex_merge_items` explicitly to consolidate.

### `/photo/:/transcode` rejects width-only or height-only requests

The image-resize endpoint takes `url=` (a relative path to the
source image), `width=`, and `height=`. Sending only one dimension
returns `400 Bad Request` — the resampler needs both bounding
constraints. When the caller has only one (e.g. `max_width=400`
with no max_height), mirror the missing dimension to the same value
and let Plex's resampler preserve aspect ratio internally. Include
`minSize=1` + `upscale=0` per python-plexapi's defaults.

`PlexClient.getImageBytes` handles this automatically:

```
const dim = String(args.maxWidth ?? args.maxHeight);
const params = {
  url: relativeUrl,
  width: args.maxWidth ? String(args.maxWidth) : dim,
  height: args.maxHeight ? String(args.maxHeight) : dim,
  minSize: "1",
  upscale: "0",
};
```

Without this mirror, calls like `plex_get_image(rating_key, max_width=400)`
fail with a `400 Bad Request` from the transcoder. Discovered during
the v0.8 `plex_get_image` smoke test (2026-05-17).

### Hidden flag has two states; `TESTING` sections are scratch space

`plex_list_libraries` returns sections with a `hidden` field that's
either `0` (visible), `1` (hidden from "All Libraries" but still
browseable), or `2` (fully hidden — Plex's "scratch" tier). Sections
named `* - TESTING` are conventionally `hidden: 2` and exist for the
user to stage / migrate content; an audit or bulk operation should
skip them by default and only act on `hidden: 0` sections unless the
user explicitly asks otherwise. The Plex API doesn't expose a
`?include_hidden=false` flag — filtering is the agent's job.

## Endpoints currently used

| Tool                  | Endpoint                                                               | Notes                                                                  |
| --------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `plex_list_libraries` | `GET /library/sections`                                                | Returns `MediaContainer.Directory[]`                                   |
| `plex_search`         | `GET /search?query=...`                                                | Cross-library                                                          |
| `plex_recently_added` | `GET /library/recentlyAdded` or `/library/sections/{id}/recentlyAdded` | Section filter optional                                                |
| `plex_on_deck`        | `GET /library/onDeck`                                                  |                                                                        |
| `plex_get_item`       | `GET /library/metadata/{rating_key}`                                   | Returns first `Metadata[]` entry                                       |
| `plex_get_children`   | `GET /library/metadata/{rating_key}/children`                          | Show→seasons, season→episodes, artist→albums, album→tracks             |
| `plex_browse`         | `GET /library/sections/{id}/all`                                       | Paged via `X-Plex-Container-Start/Size` headers; optional `type=N`; `fields[]` is a client-side projection (Plex still sends full payload, we filter before returning) |
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
| `plex_hubs`            | `GET /hubs`                                                           | Server-wide curated rows (Continue Watching, Recently Released, etc.)  |
| `plex_section_hubs`    | `GET /hubs/sections/{id}`                                             | Same shape, scoped to a single section                                 |
| `plex_related`         | `GET /library/metadata/{key}/related`                                 | Provenance-grouped "related" hubs for an item                          |
| `plex_similar`         | `GET /library/metadata/{key}/similar`                                 | Algorithmic similarity (flat Metadata list)                            |
| `plex_refresh_metadata`| `PUT /library/metadata/{key}/refresh[?force=1]`                       | Empty 200 — re-pulls metadata from current agent                       |
| `plex_get_matches`     | `GET /library/metadata/{key}/matches?manual=1[&agent=&language=&title=&year=]` | Returns `MediaContainer.SearchResult[]` candidates              |
| `plex_apply_match`     | `PUT /library/metadata/{key}/match?guid=&name=`                       | Empty 200 — overwrites current agent binding                           |
| `plex_edit_metadata`   | `PUT /library/metadata/{key}?<field>.value=&<field>.locked=`          | Empty 200 — scalar fields only; `.locked=1` essential or refresh wipes |
| `plex_unmatch`         | `PUT /library/metadata/{key}/unmatch`                                 | Empty 200 — drops agent binding to `agents.none`; locked fields survive |
| `plex_refresh_section` | `GET /library/sections/{id}/refresh[?force=1]`                        | Empty 200 — async on server; `force=1` deep-rescans every item        |
| `plex_split_item`      | `PUT /library/metadata/{key}/split`                                   | Empty 200 — all-or-nothing; splits into N items per Media variant     |
| `plex_merge_items`     | `PUT /library/metadata/{key}/merge?ids=<csv>`                         | Empty 200 — sources absorbed into target; target's rk/GUID survive    |
| `plex_get_image`       | `GET {item.thumb/art/banner}` or `GET /photo/:/transcode?url=…&width=&height=` | Returns binary; Accept: image/\* (not JSON). Transcode needs BOTH width AND height — see gotcha above. 4 MiB raw cap. |
| `plex_save_image`      | Same fetch path as `plex_get_image`                                    | Writes bytes to `${MCP_IMAGE_SAVE_DIR}/${filename}` inside the container instead of returning them. Default save dir `/data/images/`. |

All requests carry `X-Plex-Token: <token>` as an HTTP header
(`PlexClient.request`); never put the token in the URL query string.

## Endpoints we haven't built yet

Candidates with rough endpoint shapes so future-us has a starting
point. Shapes marked **✓ pkkid** have been confirmed against
python-plexapi master (cross-validated 2026-05-13 — see section
below). Shapes without ✓ are speculative.

| Capability                              | Endpoint(s)                                                                              | Risk                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------ |
| Smart playlists (filter expressions)    | `POST /playlists?type=&smart=1&uri=` (filter shape via `library:///` URI)                | Medium (complex shape)   |
| Rate item ✓ pkkid                       | `PUT /:/rate?key=...&identifier=com.plexapp.plugins.library&rating=N` (0–10 → 0–5 stars) | Low                      |
| Update playback timeline ✓ pkkid        | `GET /:/timeline?ratingKey=...&key=...&identifier=...&time=...&state=...&duration=...`   | Low                      |
| Update playback progress (lighter) ✓ pkkid | `GET /:/progress?key=...&identifier=...&time=...&state=...`                           | Low                      |
| Remove from Continue Watching ✓ pkkid   | `PUT /actions/removeFromContinueWatching?ratingKey=...`                                  | Low (one-shot, reversible by viewing) |
| Section-scoped on-deck ✓ pkkid          | `GET /library/sections/{id}/onDeck`                                                      | Low (read-only, fills a gap in plex_on_deck) |
| Empty section trash ✓ pkkid             | `PUT /library/sections/{id}/emptyTrash`                                                  | Medium (irreversible)    |
| Analyze section ✓ pkkid                 | `PUT /library/sections/{id}/analyze`                                                     | Medium (server load)     |
| Continue Watching hub explicit ✓ pkkid  | `GET /hubs/continueWatching/items`                                                       | Low                      |
| Hub-search (richer than `/search`) ✓ pkkid | `GET /hubs/search?query=&limit=&sectionId=&includeCollections=1&includeExternalMedia=1` | Low (additive vs `plex_search`) |
| Player control (play/pause/skip)        | `/player/playback/playMedia`, `/player/playback/pause`, etc.                             | Medium (live device)     |
| Currently transcoding sessions          | `GET /transcode/sessions`                                                                | Low                      |

**Out of scope** (per scoping decision in v0.2): `DELETE /library/metadata/{key}`,
`DELETE /library/sections/{id}`, and any other operation that destroys
media or library structure. The cost of an LLM hallucinating a delete
call is too high relative to the value of the tool.

## Cross-validation against python-plexapi

Last validated against
[`pushingkarmaorg/python-plexapi@master`](https://github.com/pushingkarmaorg/python-plexapi/tree/master/plexapi)
on **2026-05-13**. The 29 endpoints in our "currently used" table
were spot-checked against pkkid's source where pkkid exposes the same
operation. Match unless noted below.

### Known shape divergences (both work; we pick the simpler one)

- **`plex_search` uses `/search?query=` (legacy/simple).** pkkid's
  `Server.search()` uses `/hubs/search` with `includeCollections=1`,
  `includeExternalMedia=1`, and returns Hub-grouped results. Both
  endpoints exist; `/search` is a lighter flat-list response, the
  one we've used since v0.1. Adding a richer search variant via
  `/hubs/search` is captured in "Endpoints we haven't built yet"
  above.
- **`plex_edit_metadata` uses `PUT /library/metadata/{rk}?...` (direct).**
  pkkid edits via `PUT /library/sections/{section_id}/all?id={rk}&type={typeCode}&<field>.value=&<field>.locked=`
  — same `.value=` / `.locked=` shape but routed through the
  section's batch-edit endpoint, with `id=` and `type=` added.
  Plex accepts both shapes; verified empirically when we fixed
  the WWE titles in v0.6. Ours is simpler.
- **`plex_refresh_metadata` (per-item) is not in pkkid.** pkkid
  only wraps section-level refresh (`/library/sections/{id}/refresh`).
  Per-item refresh (`PUT /library/metadata/{rk}/refresh[?force=1]`)
  is the same endpoint Plex's web UI uses; we verified it works
  empirically during the 2026-05-08 audit (used it on 19 movies
  to pull fresh posters after re-matching). Don't expect pkkid's
  source to help debug this one.

### Confirmed identical (no shape drift)

`/library/sections`, `/library/recentlyAdded` (+ section variant),
`/library/onDeck`, `/library/metadata/{rk}` family
(`/children`, `/related`, `/similar`, `/matches`, `/match`,
`/unmatch`, `/split`, `/merge`), `/library/sections/{id}/all` (with
`X-Plex-Container-Start`/`Size` headers), `/status/sessions`,
`/status/sessions/history/all`, `/:/scrobble`, `/:/unscrobble`,
`/identity`, `/hubs`, `/hubs/sections/{id}`, and the full `/playlists`
family.

### Endpoints pkkid has that we deferred — confirmed worth shipping

The "Endpoints we haven't built yet" entries marked **✓ pkkid**
above are no longer speculative — pkkid's source documents the
exact call shape. If we ship them, the canonical example lives in
the corresponding pkkid mixin / class file
(`mixins/rating.py`, `mixins/played_unplayed.py`, `base.py` for
timeline/progress, `video.py` for `removeFromContinueWatching`,
`library.py` for the section variants, `server.py` for hub-search).
