# last.fm API: importing and syncing a full Scrobble history

Research for issue #2 (child of #1). Researched 2026-10-25.

**Question:** How do we pull a listener's complete Scrobble history from the last.fm API, then Sync only new Scrobbles? This covers paging, rate limits, timestamps and Day mapping, now-playing entries and duplicates, Artist fields, whether a browser client can call the API, and quirks with large histories.

Confidence tags: **[official]** = last.fm's own docs or ToS. **[observed]** = checked directly against `ws.audioscrobbler.com` while writing this. **[community]** = third-party docs or client-library source. **[unverified]** = inference that needs a live check with a real API key. No API key was available for this research, so no successful `getRecentTracks` response was inspected directly.

## Sources

- S1. `user.getRecentTracks` docs: https://www.last.fm/api/show/user.getRecentTracks
- S2. API Terms of Service: https://www.last.fm/api/tos
- S3. Web auth how-to: https://www.last.fm/api/webauth (desktop variant: https://www.last.fm/api/desktopauth)
- S4. Authentication intro: https://www.last.fm/api/authentication
- S5. Scrobbling 2.0 docs: https://www.last.fm/api/scrobbling, and `track.scrobble`: https://www.last.fm/api/show/track.scrobble
- S6. `user.getInfo`: https://www.last.fm/api/show/user.getInfo
- S7. Error codes: https://www.last.fm/api/errorcodes
- S8. Unofficial community API docs, with real JSON samples: https://lastfm-docs.github.io/api-docs/user/getRecentTracks/
- S9. pylast source (`get_recent_tracks`, `_delay_call`, `_collect_nodes`): https://github.com/pylast/pylast/blob/main/src/pylast/__init__.py
- S10. lastfm-java wiki, which quotes an earlier ToS clause 4.4: https://github.com/jkovacs/lastfm-java/wiki/Getting-Started
- S11. pylast issue #300 ("Operation failed" partway through paging `getRecentTracks`): https://github.com/pylast/pylast/issues/300
- S12. Reports of the two-week scrobble age cutoff: https://redmine.audacious-media-player.org/issues/260, https://bitbucket.org/cs96and/rockscrobbler/issues/3/all-tracks-ignored, https://tangled.org/rocksky.app/rocksky/issues/6

## 1. `user.getRecentTracks` parameters

Endpoint: `GET https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=<name>&api_key=<key>&format=json` **[official, S1]**. The method needs no authentication **[official, S1]**.

| Param | Meaning | Default / max |
|---|---|---|
| `user` | last.fm username (required) | — |
| `limit` | results per page | default 50, **max 200** [official, S1]. S8 claims a max of 1000 [community]. Use 200 and don't rely on the higher value. |
| `page` | page number, 1-based | 1 |
| `from` | "only display scrobbles after this time", UTC Unix seconds | none |
| `to` | "only display scrobbles before this time", UTC Unix seconds | none (now) |
| `extended` | `0`/`1`. Adds extended artist data and a `loved` flag per track | 0 |
| `api_key` | required | — |

- Results come **newest first**: `page=1` holds the most recent scrobbles [official sample in S1; community S8].
- The response root `recenttracks.@attr` holds `page`, `perPage`, `total` and `totalPages`. **In JSON these are all strings**, for example `"total": "94618"` [community, S8].
- The docs don't say whether `from` and `to` bounds are inclusive or exclusive ("after", "before") **[unverified]**. Design so that it doesn't matter: overlap the window and de-duplicate (see §8).
- Errors the method can return [official S1/S7; S8]: 6 (invalid params, also returned as "User not found" with HTTP 404), 8 (operation failed, retry), 11 (service offline), 16 (temporary error, retry), 17 ("Login: User required to be logged in", HTTP 403, returned when the user has hidden their recent listening), 26 (suspended key), 29 (rate limit exceeded).

## 2. Rate limits and throttling

- **Current ToS clause 4.4** sets no number. last.fm "sets and enforces limits on use of the API … in our sole discretion", and you must not try to get around them [official, S2].
- **The earlier ToS 4.4** said: "You will not make more than 5 requests per originating IP address per second, averaged over a 5 minute period, without prior written consent" [S10, quoting the old ToS]. pylast still uses this as `DELAY_TIME = 0.2` s, citing "section 4.4 of https://www.last.fm/api/tos" [community, S9].
- When the limit is exceeded, the API returns error **29** [official, S1/S7]. pylast treats 29, 8, 11 and 16 as retryable [community, S9].
- **Recommendation:** make **one request at a time, at most about 4 per second** (250 ms minimum gap). This stays under the old 5/s figure and is easy to justify. On errors 29, 8, 11, 16, HTTP 5xx or a network error, retry with exponential backoff (for example 1 s, 2 s, 4 s … capped at 60 s), then pause the import and allow a resume. Don't fetch pages in parallel.
- Cost estimate: at 200 per page, 100k Scrobbles is about 500 requests. At 4 requests per second that's about 2–3 minutes, plus response latency. getRecentTracks pages are often slow, so in practice expect several minutes.

### Other ToS points that matter here

- **Non-commercial use only** (3.1). **Attribution** to last.fm, with links back (2.7) [official, S2].
- **"Reasonable Usage Cap" of 100 MB** of stored last.fm data (4.3.4) [official, S2]. This needs a size check. A Scrobble stored as (uts, artist, track, album) is roughly 60–120 bytes, so 100k Scrobbles is about 10 MB and well under the cap. Don't store raw API responses (images, URLs) for every scrobble.
- "Implement suitable caching in accordance with the HTTP headers" (4.3.4) [official, S2]. Storing each Scrobble locally once satisfies this.

## 3. Timestamps and mapping to a local Day

- Each scrobbled track has `date.uts`, which is **Unix seconds in UTC, as a string** in JSON (for example `"uts": "1603188238"`) [official S1 for `uts`; community S8 for the string type]. `date["#text"]` is a preformatted human-readable date. **Don't parse it.** Its timezone isn't documented [unverified].
- The scrobble's timestamp is the time playback **started**, in UTC (`track.scrobble`: "This must be in the UTC time zone") [official, S5].
- **Day mapping:** compute `Day = localDate(uts * 1000, listenerTimeZone)` using an IANA zone (for example `Intl.DateTimeFormat(..., { timeZone, year, month, day })` or `Temporal.Instant.fromEpochSeconds(uts).toZonedDateTimeISO(tz).toPlainDate()`). Store raw `uts` and derive the Day when needed, or store both and re-derive if the timezone setting changes. DST is handled by the zone database. last.fm doesn't record where the listener was, so all history maps through a single configured zone.

## 4. Now-playing entries

- If the user is listening right now, the **first** track on page 1 has `"@attr": {"nowplaying": "true"}` and **no `date`** [official S1; community S8 sample].
- It is **added on top of `limit`**. A request with `limit=1` returned 2 tracks [community, S8]. pylast requests `limit + 1` and skips any node with `nowplaying` [community, S9].
- **Rule:** drop any track that has `@attr.nowplaying === "true"` or has no `date.uts`. It isn't a Scrobble yet. Don't use `track.length` to check whether a page is full or the last page.

## 5. Duplicates and missing timestamps

- **No documented de-duplication.** Two genuine Scrobbles can share artist and track and even `uts`, for example batch scrobbles from offline players. A Scrobble has **no ID** in the response [official S1 sample; no id field].
- **Page-boundary drift:** offset paging (`page=N`) shifts if Scrobbles are inserted or deleted while you page. New scrobbles go at the top, and backdated scrobbles are inserted further down. A shift duplicates or skips an item at the page boundary. Fix this by passing a **fixed `to`** captured when the import starts (newer scrobbles then fall outside the result set), and by de-duplicating at the boundary (see §8) [inference from S1 ordering; S8 shows `total` changing between calls].
- **Backdated scrobbles:** clients may submit scrobbles with past timestamps. The server ignores ones that are "too far in the past" (ignored code 3) [official, S5], and multiple reports put the cutoff at **about 2 weeks** [community, S12]. A Sync that only asks for `from = lastSeenUts` **will miss** scrobbles that arrive late with older timestamps, for example from an offline device or a delayed import.
- **Edits and deletions:** users can delete Scrobbles on the website (and edit them, with Pro, according to third-party tools). The API has no change feed, so edits and deletions older than the Sync overlap window can't be detected incrementally [inference; no official source found].
- A **missing `date`** only means a now-playing entry (§4). No other case was found in sources.

## 6. Artist fields

- **Default (`extended=0`)**: `artist` is `{"mbid": "...", "#text": "Artist Name"}`. Album has the same shape [official S1 XML sample; community S8 JSON].
- **`extended=1`**: `artist` becomes an object with `name`, `mbid`, `url`, `image[]`, and each track gets `loved: "0"|"1"`. Per S8, `extended` "changes the output format" [community, S8; official S1 only says "extended data in each artist"].
- **`mbid` is often an empty string.** Don't use it as the Artist key. The project glossary already defines Artist as the exact last.fm name. Use `artist["#text"]` with `extended=0`. Extended mode adds bytes for no benefit to Chronoscribe.
- Artist names come back as last.fm stored them for that Scrobble. Scrobbling 2.0 describes server-side autocorrection (flagged `corrected="1"` on submit) [official, S5], so names are usually canonical but not guaranteed. Treat exact-string equality as the identity, as the glossary decides.

## 7. Browser client: CORS and key exposure

- **CORS works.** **[observed 2026-10-25]** Both an `OPTIONS` preflight and a `GET` to `ws.audioscrobbler.com/2.0/` with `Origin: http://localhost:5173` returned `access-control-allow-origin: *`, `access-control-allow-methods: POST, GET, OPTIONS`, `access-control-max-age: 86400`. Use `format=json`. A plain GET with no custom headers doesn't even need a preflight.
- **The API key alone is enough** for `user.getRecentTracks` and `user.getInfo`, which need no auth [official, S1/S6].
- **The shared secret is only used for signing** (`api_sig = md5(sorted params + secret)`), which is needed for auth sessions and write methods ("All write services require authentication") [official, S3/S4]. **The secret must never ship to the client.** Chronoscribe needs no write calls and no session, so it never needs the secret.
- **Exposing the API key client-side** is the normal pattern for read-only last.fm web apps. The key is visible in every request URL anyway. The risk is that someone reuses the key and causes rate limiting or suspension (error 26). For a single-user, local-first app this is acceptable. Options, from simplest: (a) the user pastes **their own** API key into settings, stored locally (best fit: each listener uses their own quota and the repo holds no key); (b) the key comes from a build-time env var such as `VITE_LASTFM_API_KEY`, kept out of git. Don't put the shared secret in either.

## 8. Large histories: quirks

- **`total` and `totalPages` move while you page** (S8's two samples a few minutes apart: 94618 vs 94613, plus a now-playing entry). Don't treat `totalPages` from page 1 as fixed. Loop until a page returns no dated tracks, or until `page > totalPages` as reported by the **current** response.
- **Pages fail intermittently** with error 8 "Operation failed" partway through a long paging run [community, S11; official S7 says "try again"]. Retry with backoff and make the import resumable from the last completed page.
- **Ordering:** newest first within and across pages. Sort by `uts` locally and don't rely on response order inside a page.
- **Private listening history** returns error 17 / HTTP 403 [community, S8]. Show a clear message such as "make your recent listening public in last.fm privacy settings".
- **Progress / sanity check:** `user.getInfo` returns `playcount` (total scrobbles) and `registered.unixtime` [official, S6]. Use these to show progress and to check after the import that the stored count matches (small mismatches are expected; see §5).

## Recommended algorithm

Storage per Scrobble: `{ uts: number, artist: string, track: string, album: string }`. Day is derived from `uts` and the configured IANA zone. Keep import state `{ importTo, nextPage, done }` and `lastSyncAt`.

**Initial import**

1. `user.getInfo` → check the user exists; read `playcount` for the progress bar.
2. `importTo = floor(now / 1000)` and persist it. Every request uses `to=importTo`, `limit=200`, `extended=0`, `format=json`.
3. For `page = nextPage, nextPage+1, …`, run strictly sequentially with a 250 ms minimum gap:
   - Fetch. On 29/8/11/16/5xx/network error, retry with exponential backoff (cap about 60 s, then pause and let the user resume).
   - Drop now-playing entries and any track without `date.uts`. Map each remaining track to a Scrobble (`Number(date.uts)`, `artist["#text"]`, `name`, `album["#text"]`).
   - Write the page's Scrobbles and `nextPage = page + 1` in **one transaction**, so the import is resumable.
   - Stop when a page has no dated tracks, or when `page >= Number(@attr.totalPages)` from the current response.
4. De-duplicate page-boundary repeats. Drop a Scrobble that is identical in (uts, artist, track, album) to one **from the previous page**. Don't collapse identical Scrobbles that come from the same page, since those are real repeats. Mark the import done.

**Sync (manual)**

1. `maxUts = max(uts)` in the store. `windowStart = maxUts - 14 days` (the overlap catches late-arriving backdated scrobbles, §5).
2. Fetch all pages with `from=windowStart` (no `to`, or `to=now`), same throttling and filtering.
3. In one transaction, **delete all stored Scrobbles with `uts >= windowStart` and insert the fetched set**. Replacing the whole window handles duplicates, late inserts, and deletions or edits inside the window, and doesn't depend on whether `from` is inclusive.
4. Optionally compare the stored count with `user.getInfo.playcount`. If the gap is large (edits or deletions older than 14 days), offer a full re-import.

Open items to check with a real key before implementation: whether `from`/`to` are inclusive or exclusive (the algorithm doesn't depend on it), whether `limit` above 200 is honoured (don't depend on it), and the exact `extended=0` JSON shape for album and artist when the mbid is empty.
