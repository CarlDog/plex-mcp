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
- **[python-plexapi source](https://github.com/pushingkarmaorg/python-plexapi/tree/master/plexapi)**
  (`pkkid/python-plexapi` redirects here — repo was renamed) — when
  plexapi.dev is silent on an endpoint, the Python lib's source is
  often the only documentation. Useful files: `library.py`,
  `media.py`, `playlist.py`, `audio.py`, `video.py`, and the
  `mixins/` directory (`editions.py`, `rating.py`, `resources.py`
  covers posters/art/themes/logos, `unmatch_match.py`, etc.). Doesn't
  cover 100% of Plex's real API surface — confirmed absent for
  several endpoints this repo has since shipped or evaluated
  (`removeFromContinueWatching`, `emptyTrash`, `/:/timeline`,
  section-scoped `onDeck`) despite older notes here claiming
  otherwise; cross-check against a second source before trusting a
  "not in python-plexapi" conclusion.
- **[LukasParke/plex-api-spec](https://github.com/LukasParke/plex-api-spec)**
  (`LukeHagar/plex-api-spec` redirects here — repo was renamed) —
  community OpenAPI 3 spec with CI contract-testing against real Plex
  servers (see its `.github/workflows/contract-test.yml`,
  `discovery.yml`). Broader coverage than python-plexapi for some
  action/mutation endpoints; useful second source when python-plexapi
  is silent. Occasionally itself uncertain (e.g. `emptyTrash` lists
  GET/POST/PUT variants with no clear canonical one) — verify
  ambiguous entries against a live capture before trusting blindly.
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

**The `guid` field for an unmatched item is
`tv.plex.agents.none://<ratingKey>`** — confirmed live (2026-08-03,
see the `unmatch`/`applyMatch` flake fix in STATUS.md): the "Arcane"
show sat unmatched in production with `guid:
"tv.plex.agents.none://40892"`, exactly its own `ratingKey` after the
scheme. Useful for tooling that needs to detect the unmatched state
from a `plex_browse`/`plex_get_item` response without a round-trip
through `plex_get_matches` — check whether `guid` starts with
`tv.plex.agents.none://` (or the equivalent `*.agents.none://` for
non-`tv` agent types) rather than only checking the `agent` field,
since `plex_browse`'s sparse projections may omit `agent` but usually
carry `guid`. Not found in python-plexapi's source at all (the
wrapper doesn't special-case this scheme), so this is a live-observed
Plex convention, not something cross-validated against the client
library.

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

### Editions — multiple versions of one title via `{edition-<name>}` filenames + `editionTitle`

Plex's Editions feature lets several versions of the same title (a
theatrical cut vs. an extended cut, or — per the WWE PPV convention
below — night 1 vs. night 2 of a two-night event) live under one
library tile with a picker, instead of showing up as unrelated
duplicates. **Corrects an earlier assumption**: `editionTitle` was
believed to live on the `Media[]` entry (one item, N Media variants).
Live data shows the opposite — confirmed against two real,
independent examples on this server (2026-08-03):

```
143136 | Deadpool 2 | editionTitle: Theatrical      | guid: plex://movie/5d776c1c51dd69001fe37d4f
143147 | Deadpool 2 | editionTitle: Super Duper Cut  | guid: plex://movie/5d776c1c51dd69001fe37d4f

208901 | WWE WrestleMania 42 | editionTitle: Saturday | guid: plex://movie/67ba7960333cb35c1b31ccfa
208902 | WWE WrestleMania 42 | editionTitle: Sunday   | guid: plex://movie/67ba7960333cb35c1b31ccfa
```

- **`editionTitle` is a top-level item field**, not a `Media[]` field
  — every `Media[]` entry checked had `editionTitle: null`/absent
  while the item itself carried the real value. Readable via
  `plex_get_item` or a `plex_browse`/`plex_search` `fields=[...]`
  projection.
- **Each edition is a separate item** (its own `ratingKey`), not a
  Media variant of one item. What ties them together is a **shared
  `guid`** — `plex_browse`'s existing `collection` filter doesn't
  cover this; finding "all editions of X" means browsing/searching
  and client-side filtering by matching `guid`, excluding the current
  `ratingKey`. This matches python-plexapi's own `editions()`
  implementation (`plexapi/mixins/editions.py`): `search(filters=
  {'guid': self.guid, 'id!': self.ratingKey})`. No dedicated plex-mcp
  tool for this yet.
- **Plex's scanner sets `editionTitle` from a `{edition-<name>}` tag
  in the filename**, confirmed directly from the two Deadpool 2
  files' real paths on this server:
  ```
  Deadpool 2 (2018) {imdb-tt5463162} {edition-Theatrical} [Bluray-1080p]...mkv
  Deadpool 2 (2018) {imdb-tt5463162} {edition-Super Duper Cut} [Bluray-1080p]...mkv
  ```
  Both files live in the same folder; the bracketed `{edition-X}` tag
  becomes the item's `editionTitle` verbatim on scan. **No tag at
  all** means no edition — most items (e.g. `WWE Royal Rumble`, which
  has two same-titled-but-different-`guid` entries for different
  years) aren't editions of each other just because they share a
  title; Plex disambiguates those by year in its UI instead. Sharing
  a `guid` **and** having an `editionTitle` is what makes two items
  editions of one another.
- **Why this matters over `plex_split_item`/`plex_apply_match`**:
  Editions is the tool for the exact problem the "Auto-merge" gotcha
  above describes. Fighting Plex's auto-merge with `split`+`unmatch`
  to keep related variants as visually-distinct items only lasts
  until the next rescan re-merges them. Editions embraces the merge
  instead — separate items, same `guid`, disambiguated by
  `editionTitle` — which is stable across rescans because it's not
  fighting anything Plex's scanner does natively. Operational
  recipe: one folder per title, one file per edition inside it, each
  filename carrying `{edition-<Name>}`; `plex_refresh_section` after
  disk changes to pick up new/renamed files. Trade-off: watch counts
  and ratings track per-item (i.e. per-edition), not aggregated
  across all editions of a title.

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

### A filesystem rename/move can re-mint the `ratingKey` instead of updating it

Observed during WWE PPV consolidation and a multi-episode rename
session (2026-05-11) — not re-verified live this session, since
reproducing it would mean actually renaming real files in the user's
library just to confirm a documentation claim, which isn't a
justified risk. Recorded here as established operational history,
not a fresh capture.

When a file or folder is renamed/moved on disk (e.g. via
filesystem-mcp's `fs_move`) and Plex rescans, it does **not**
reliably treat this as "the same item, new path." Sometimes it does;
sometimes it mints a **new** `ratingKey` for what Plex sees as a
newly-appeared file, leaving the old `ratingKey` orphaned (and
Plex-cleaned on a later scan once the old path is confirmed gone).
Locked field overrides (title, summary, etc.) do **not** reliably
survive this churn — a fresh item starts from the agent's raw data
again, locks and all.

Practical implications:

- Any code or tooling that holds a `ratingKey` reference across a
  filesystem operation (a playlist entry, a watch-history join, an
  external index) must treat that reference as **potentially stale**
  after a rename/move + rescan, not just after an explicit delete.
- After a bulk rename, re-verify affected items via `plex_browse`
  (matching by file path or a distinguishing embedded ID like
  `{imdb-tt...}`, not by the `ratingKey` you had before the move)
  rather than assuming the old `ratingKey` still resolves.
- Re-apply any locked-field overrides that mattered (title, etc.)
  after confirming the item's current `ratingKey`, rather than
  assuming they carried over.

### `plex_refresh_section` can need two calls after a bulk filesystem change

Same operational-history caveat as above: observed during bulk
`fs_move` reorganization (2026-05-11), not freshly reproduced this
session. The tool itself returns as soon as Plex *accepts* the
refresh request — the actual disk scan continues after the call
returns (see the tool's description). After a large batch of
renames/moves, the **first** refresh sometimes only gets partway
through reconciliation: old `episodeFileId`s get detached from their
items, but the new file paths aren't re-attached yet. A **second**
`plex_refresh_section` call (after giving the first scan time to
settle) typically completes the reconciliation. If a section's
content still looks stale/incomplete right after a refresh call
returns, that's the first symptom to check for — not necessarily a
sign something's actually broken.

### `Field[]` on an item lists only its *locked* fields — absent means none are locked

`plex_get_item`'s response carries a `Field[]` array,
`[{name: "<fieldName>", locked: true}, ...]`, when the item has one
or more manually-locked fields (typically set via
`plex_edit_metadata`'s default `lock=true`). Confirmed live
(2026-08-03) across several real items with different lock states —
`Field` is **entirely absent** (not an empty array) on items with
zero locks, and **every entry present has `locked: true`** — no
example returned a `locked: false` entry for an unlocked field. So
`Field[]` is a sparse list of *what's locked*, not a complete
inventory of every field with its lock state:

```
rk 40892  (Arcane, several manual overrides): summary, thumb, genre, collection, label
rk 143136 (Deadpool 2, minimal overrides):     thumb, label
rk 214521 (freshly-added, no manual edits):    Field key absent entirely
```

Useful for tooling that wants to know "what has a human touched on
this item" without diffing full field values against the agent's
current data —
`(item.Field ?? []).some((f) => f.name === "title")` answers "is the
title locked" directly.

### Section-scoped on-deck entries don't reliably carry `librarySectionID`

`GET /library/sections/{id}/onDeck` scopes the on-deck list to one
section by the request URL, but confirmed live (2026-08-15, Anime
section, 19 items): 5 of 19 returned entries omitted
`librarySectionID` **and** `librarySectionKey` **and**
`librarySectionTitle` entirely — not `null`, just absent from the
response — while the other 14 carried `librarySectionID` matching the
requested section normally. All 19 were genuinely `type: "episode"`
entries scoped correctly (the endpoint itself works); Plex just
doesn't consistently stamp the section-identity fields onto every
on-deck entry. Don't build tooling that assumes every item in this
response carries `librarySectionID` — check for its presence before
relying on it, the way `tests/plex.test.ts`'s on-deck test does.

### `removeFromContinueWatching`'s real param is `ratingKey`, not `key` — the community OpenAPI spec had it wrong

`LukasParke/plex-api-spec` documents `PUT
/actions/removeFromContinueWatching?key=...`, and a 2026-08-15 attempt
against that exact shape returned an identical generic `400` for every
value tried (bare ratingKey, full metadata path encoded and raw,
with/without `identifier=`, with/without client-identity headers) — no
python-plexapi coverage existed to cross-check against, so the tool was
deferred rather than shipped against an unconfirmed guess.

Resolved 2026-08-29 by capturing the request Plex Web itself sends when
you click "Remove from Continue Watching" (Chrome DevTools Network tab,
via Claude in Chrome + `read_network_requests`, driving the user's own
logged-in session): the real call is `PUT
/actions/removeFromContinueWatching?ratingKey={ratingKey}` — no
`identifier=`, no client-identity headers. `key` vs `ratingKey` was the
entire bug; every other guessed detail (method, no identifier) had
already been right. Verified the item's `viewOffset`/`lastViewedAt` are
untouched by the call — it only flips a hidden-from-the-hub flag that
clears again once the item is resumed.

**General lesson**: when a community-maintained spec's documented shape
gets a blanket rejection with no working variant and no second source
to cross-check, a live capture of the real first-party client actually
performing the action is more reliable than guessing further permutations
of the documented shape. Claude in Chrome (driving the user's already-
authenticated browser) plus its network-request inspection is a
practical way to get that capture without needing separate credentials.

## Endpoints currently used

| Tool                  | Endpoint                                                               | Notes                                                                  |
| --------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `plex_list_libraries` | `GET /library/sections`                                                | Returns `MediaContainer.Directory[]`                                   |
| `plex_search`         | `GET /search?query=...`                                                | Cross-library                                                          |
| `plex_recently_added` | `GET /library/recentlyAdded` or `/library/sections/{id}/recentlyAdded` | Section filter optional                                                |
| `plex_on_deck`        | `GET /library/onDeck` or `/library/sections/{id}/onDeck`               | `section_id` optional; section-scoped confirmed via `LukasParke/plex-api-spec` (not in python-plexapi) |
| `plex_get_item`       | `GET /library/metadata/{rating_key}`                                   | Returns first `Metadata[]` entry                                       |
| `plex_get_children`   | `GET /library/metadata/{rating_key}/children`                          | Show→seasons, season→episodes, artist→albums, album→tracks             |
| `plex_browse`         | `GET /library/sections/{id}/all`                                       | Paged via `X-Plex-Container-Start/Size` headers; optional `type=N`; `fields[]` is a client-side projection (Plex still sends full payload, we filter before returning) |
| `plex_now_playing`    | `GET /status/sessions`                                                 | Empty array when nothing playing                                       |
| `plex_history`        | `GET /status/sessions/history/all`                                     | Paged; `sort=viewedAt:desc`; optional `librarySectionID`               |
| `plex_mark_watched`   | `GET /:/scrobble?key=...&identifier=com.plexapp.plugins.library`       | Empty 200 — use `requestNoContent`                                     |
| `plex_mark_unwatched` | `GET /:/unscrobble?key=...&identifier=com.plexapp.plugins.library`     | Empty 200                                                              |
| `plex_rate_item`      | `PUT /:/rate?key=...&identifier=com.plexapp.plugins.library&rating=N` | Empty 200 — 0-10 scale; omitting `rating` sends `-1` to clear it       |
| `plex_remove_from_continue_watching` | `PUT /actions/removeFromContinueWatching?ratingKey=...`  | Empty 200 — param is `ratingKey`, not `key`; no `identifier=` needed; confirmed via live DevTools capture, not docs |
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
| `plex_list_posters`    | `GET /library/metadata/{key}/posters`                                  | Returns `MediaContainer.Metadata[]` candidates, each `{key, ratingKey, thumb, selected, provider?}` |
| `plex_set_poster`      | `PUT /library/metadata/{key}/poster?url=<candidate ratingKey>`         | Empty 200 — note the *singular* `poster`, distinct from the plural list/upload endpoint |
| `plex_upload_poster`   | `POST /library/metadata/{key}/posters?url=<external url>` or same path with raw bytes as body | Empty 200 — Plex auto-selects the new candidate server-side; see below |

All requests carry `X-Plex-Token: <token>` as an HTTP header
(`PlexClient.request`); never put the token in the URL query string.

## Endpoints we haven't built yet

Candidates with rough endpoint shapes so future-us has a starting
point. Shapes marked **✓ pkkid** were originally claimed confirmed
against python-plexapi master (cross-validated 2026-05-13 — see
section below). **That mark turned out unreliable**: re-checked
2026-08-15 against both python-plexapi's *current* source and an
independent OpenAPI spec
([`LukasParke/plex-api-spec`](https://github.com/LukasParke/plex-api-spec),
which contract-tests against real Plex servers) — 4 of the 5 rows
that carried a "✓ pkkid" mark below don't actually appear in
python-plexapi's source at all. Corrected in place; see
`plex_rate_item`/`plex_on_deck`/`plex_remove_from_continue_watching`
in "Endpoints currently used" above for the three that shipped (the
last one only after a follow-up live-capture investigation — see its
gotcha above), and STATUS.md's Next section for the drop/defer
reasoning on the remaining two (one dropped outright, one still
deferred for a genuinely ambiguous spec). Shapes without any mark are
still speculative.

| Capability                              | Endpoint(s)                                                                              | Risk                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------ |
| Smart playlists (filter expressions)    | `POST /playlists?type=&smart=1&uri=` (filter shape via `library:///` URI)                | Medium (complex shape)   |
| Update playback timeline — declined     | `POST /:/timeline?key=&ratingKey=&state=&time=&duration=...` (confirmed via plex-api-spec; not in python-plexapi). Real shape is a live-playback-session reporter (~10 required client-identity headers, meant to be called every 10-20s by an actual player), not a one-shot resume-position setter as originally assumed | Declined — synthetic fake-session call, low value vs. `plex_mark_watched` |
| Empty section trash — deferred          | `PUT`/`POST`/`GET /library/sections/{id}/emptyTrash` (confirmed to exist via plex-api-spec, but the spec itself lists all 3 HTTP methods claiming the same effect, no clear canonical one) | Deferred — irreversible delete + genuinely ambiguous method, not worth guessing at |
| Analyze section ✓ pkkid                 | `PUT /library/sections/{id}/analyze`                                                     | Medium (server load)     |
| Continue Watching hub explicit ✓ pkkid  | `GET /hubs/continueWatching/items`                                                       | Low                      |
| Player control (play/pause/skip)        | `/player/playback/playMedia`, `/player/playback/pause`, etc.                             | Medium (live device)     |
| Currently transcoding sessions          | `GET /transcode/sessions`                                                                | Low                      |
| Subtitle content (dialogue text)        | Not implemented — no endpoint evidence, see below                                        | Declined — no evidence   |
Built since the table above was last swept: collections support
(`plex_list_collections`, `plex_hub_search`, `plex_browse`'s `collection`
filter — 2026-08-03), subtitle *discovery* (`plex_get_item`'s minimal
mode now keeps subtitle-track `Stream[]` entries — 2026-08-03, see
below), server log retrieval (`plex_download_logs` — 2026-08-03, see
below), and poster management (`plex_list_posters`, `plex_set_poster`,
`plex_upload_poster` — 2026-08-03, see below).

### Subtitle discovery — done; content fetch — declined (2026-08-03)

Motivated by plex-companion wanting richer, more accurate context for its
watch-along reactions than a Plex synopsis + web search can give — subtitle
text is exactly what was watched, timestamped, and inherently spoiler-safe
up to the current position (unlike a web search, which can't help wandering
into later episodes).

- **Discovery: done.** `plex_get_item`'s `minimal=true` mode used to strip
  `Media[].Part[].Stream[]` entirely; it now keeps only subtitle-type
  entries (`streamType === 3` — confirmed against python-plexapi's
  `SubtitleStream.STREAMTYPE = 3` class attribute and a live
  `plex_now_playing` capture showing video/audio entries as
  `streamType` 1/2) while still dropping the audio/video entries that were
  the actual bulk of the ~3KB/file minimal-mode cost. Each surviving entry
  includes `language`, `codec`, and **`hearingImpaired`** (the confirmed
  real field name for the SDH flag — bool, default `false`) — SDH tracks
  include bracketed non-dialogue cues (`[thunder rumbles]`, `[door
  creaks]`) that plain subtitles omit, real signal for a companion reacting
  to atmosphere, not just dialogue. Prefer a `hearingImpaired: true` track
  over a plain one in the same language when both exist; a plain track is
  an acceptable fallback.
- **Content fetch: declined, not just unresearched.** Checked
  python-plexapi (`pushingkarmaorg/python-plexapi@master`) directly —
  `SubtitleStream`'s only method is `setSelected()` (toggles which stream
  is active for playback, fetches nothing). The one generic
  `download()` method in the library (`Playable.download()`,
  `base.py`) only downloads a whole `MediaPart` file via `part.key`, with
  no code path targeting an individual stream. The `subtitles`-named
  methods that do exist (`uploadSubtitles`, `searchSubtitles`,
  `downloadSubtitles`, `removeSubtitles` — `video.py`) all manage *which*
  subtitle file is attached to an item (upload one, search an
  OpenSubtitles-style provider, ask the **server** to fetch+attach a
  match, remove one) — none of them read dialogue text back to the
  caller. `downloadSubtitles()`'s name is misleading: it's async and
  returns nothing to the Python caller, per its own docstring. No literal
  path resembling `/library/streams/{id}/content` or a transcoder-based
  subtitle URL appears anywhere in the source. This reads as a genuine
  gap in the wrapper (or a feature Plex Web renders client-side via a
  mechanism the wrapper never attempted), not a confirmed dead end —
  pursuing it further would need live packet-capture of Plex Web's own
  network calls against a real PMS instance while subtitles render,
  which is out of scope without that setup.
- Two distinct capabilities, if content fetch is ever unblocked: static
  content enrichment (fetch the whole subtitle file, feed a condensed
  version into a lore/context prompt — cheap, fits a request/response
  tool) vs. live position-correlated interjections (needs an active
  session tracker polling `plex_now_playing` against subtitle timestamps —
  a different shape of feature entirely, out of scope for a single tool).

### Server log retrieval ✓ pkkid — shipped 2026-08-03

Motivated by wanting an LLM assistant to help troubleshoot Plex issues
directly — "why did last night's recording fail," "why does this file
keep failing to scan," "was there an error during that refresh" —
rather than the operator manually pulling logs via the web UI (Settings
→ Help → "Download Logs") and pasting excerpts into a session by hand.

- **`GET /diagnostics/logs`**, same `X-Plex-Token` header auth as every
  other call in this repo. Confirmed against python-plexapi's
  `PlexServer.downloadLogs()` (identical endpoint), independently
  corroborated by Plex's own support docs and an unrelated third-party
  plugin before implementation — then confirmed for real against this
  server: `plex_download_logs()` returns actual bytes with
  `Content-Type: application/zip` (exactly as inferred beforehand) and
  a real bundle size of **1.66 MB** on this install — far under the
  50 MiB `MCP_LOG_MAX_BYTES` default cap, and fast enough that even a
  30s timeout likely would have been fine (a 120s
  `MCP_LOG_FETCH_TIMEOUT_MS` default is kept anyway as headroom for a
  server with a lot more log history).
- **Response is an unmodified ZIP**, saved to disk under
  `MCP_LOG_SAVE_DIR` (default `/data/logs/`), same disk-write pattern as
  `plex_save_image`/`MCP_IMAGE_SAVE_DIR` — the tool returns a manifest
  (`path`, `bytes_written`, `mime_type`), never the archive content
  inline. Not auto-unpacked: the exact internal layout wasn't
  cross-checked, and unzip-on-write adds a failure mode for no clear
  benefit when the caller can unzip the saved file directly (or via
  filesystem-mcp, which already has that reach if the log save dir is
  bind-mounted the same way `_mcp-scratch` is for images).
- **No filtering/tail parameter exists** — neither python-plexapi's
  wrapper (zero-parameter beyond local save options) nor any source
  checked exposes one. A caller wanting "just tonight's errors" pulls
  the whole bundle and greps the relevant file(s) themselves (or via a
  follow-up filesystem-mcp read) rather than a server-side filter this
  endpoint doesn't support.

### Poster management ✓ pkkid — shipped 2026-08-03

Motivated by closing the loop on a poster-design workflow: Plex's
auto-picked posters are often bad (a mediocre agent candidate, or a
custom composited poster from an external pipeline needs pushing
back in) and until now plex-mcp had no write side for artwork at all.

- **Corrects an earlier speculative note.** STATUS.md's original
  design (captured 2026-05-11, before this repo's "verify against a
  real captured response" discipline was as strict as it is now)
  assumed a single `POST .../posters?url=&select=` call with a
  `select` flag baked into the upload itself. The real
  python-plexapi source (`plexapi/mixins/resources.py`'s
  `PosterMixin`) shows upload and select as two fully separate
  operations — `uploadPoster()` never calls `setPoster()`/`select()`
  internally.
- **`plex_list_posters`** — `GET /library/metadata/{key}/posters`,
  confirmed against `PosterMixin.posters()`. Each candidate:
  `{key, ratingKey, thumb, selected, provider?}` — `ratingKey` here
  is the *candidate's own* identifier (e.g.
  `upload://posters/<hash>` for a previously uploaded poster, or the
  literal external image URL for an agent-fetched one), not the
  item's. `provider` is present for agent-supplied candidates
  (`tmdb`, etc.) and absent for uploaded ones — matches
  `BaseResource`'s docstring ("`None` if uploaded or agent-/
  plugin-supplied", confirmed live: an uploaded candidate had no
  `provider` key at all).
- **`plex_set_poster`** — `PUT /library/metadata/{key}/poster?url=
  <candidate ratingKey>`. Note the **singular** `poster` in the path
  — the plural `posters` is the list/upload collection endpoint,
  this is the per-item "select" endpoint. Confirmed against
  `BaseResource.select()` (`plexapi/media.py`): it builds this exact
  URL from `self._initpath[:-1]` (stripping the trailing "s") plus
  `?url={quote_plus(self.ratingKey)}`.
- **`plex_upload_poster`** — `POST /library/metadata/{key}/posters`
  with either `url=<external>` as a query param (Plex fetches
  server-side) or the raw image bytes as the request body — never
  both, confirmed against `PosterMixin.uploadPoster(url=None,
  filepath=None)`. plex-mcp's `filename` mode reads from
  `MCP_IMAGE_SAVE_DIR` (the `plex_save_image` output convention),
  closing the `plex_save_image → local compositor → plex_upload_poster`
  round trip this item was originally motivated by.
- **Two things confirmed live (2026-08-03) that aren't obvious from
  the python-plexapi source alone, both discovered by testing
  against a real library item (the "Arcane" show) and fully
  reverting afterward:**
  1. **The raw POST response is always a 200 with an empty body**
     (`Content-Length: 0`) — matches python-plexapi's own
     `uploadPoster()` never reading the response. The newly added
     candidate's identity has to come from a before/after diff of
     `plex_list_posters`, not the upload response.
  2. **Plex auto-selects every freshly uploaded poster server-side.**
     Uploading via `url=` with zero follow-up `PUT` calls produced a
     new candidate with `selected: true` immediately, and the item's
     `thumb` field changed to match. `setPoster()`/`select()` is for
     switching between *already-existing* candidates, not something
     upload needs afterward. `plex_upload_poster`'s `select=false`
     (default `true`) works by capturing the previously-selected
     candidate before uploading and restoring it afterward — the
     opposite of what the pre-research design assumed.
- **Gotcha for anyone testing this further:** the item's `thumb`
  field is not a stable "did the poster change" signal — Plex bumps
  a version/cache-busting suffix on the `thumb` URL on *any* select
  call, even a no-op reselection of the same candidate (confirmed by
  the round-trip test in `tests/plex.test.ts` initially asserting
  thumb-equality and failing on the version-number tail). Same
  family of quirk as `/:/scrobble` bumping `lastViewedAt` on every
  call (see above) — check `plex_list_posters`' `selected` flag
  against the candidate's `ratingKey`, not the `thumb` URL's bytes.
- **No per-candidate delete exists.** Only `DELETE
  /library/metadata/{key}/thumb` (deletes whichever candidate is
  *currently selected*) is exposed by python-plexapi
  (`deletePoster()`) — there's no endpoint to remove one specific
  unselected candidate from the list. Not implemented as a plex-mcp
  tool; a test-uploaded candidate that's never selected just sits in
  the list as harmless clutter, same as it would for a real caller.

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

- **`plex_search` uses `/search?query=` (legacy/simple); `plex_hub_search`
  (added 2026-08-03) uses `/hubs/search`.** pkkid's `Server.search()`
  matches `plex_hub_search` exactly: `includeCollections=1`,
  `includeExternalMedia=1`, Hub-grouped results. Both endpoints coexist
  deliberately — `/search` stays the lighter flat-list response `plex_search`
  has used since v0.1 (not modified, to avoid changing its existing
  response shape for callers), `plex_hub_search` is the additive richer
  variant that also surfaces collections and external-media matches
  `/search` misses entirely.
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

**Superseded 2026-08-15, kept for history — see the correction at the
top of "Endpoints we haven't built yet."** This section's claim that
pkkid's source documents the exact shape turned out false for
`removeFromContinueWatching` (no `video.py` support for it exists;
the real shape was only found via a live DevTools capture, not
pkkid) and for timeline/progress (`base.py` doesn't cover it either —
the real endpoint is a live-playback-session reporter, declined
outright). Only the rating/played-unplayed mixins panned out as
originally described.

The "Endpoints we haven't built yet" entries marked **✓ pkkid**
above are no longer speculative — pkkid's source documents the
exact call shape. If we ship them, the canonical example lives in
the corresponding pkkid mixin / class file
(`mixins/rating.py`, `mixins/played_unplayed.py`, `base.py` for
timeline/progress, `video.py` for `removeFromContinueWatching`,
`library.py` for the section variants, `server.py` for hub-search).
