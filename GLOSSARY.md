# Chronoscribe

Personal data visualizations of last.fm listening histories: one or more Listeners, kept side by side and viewed one at a time.

## Language

**Listener**:
A last.fm user whose Scrobbles have been imported into Chronoscribe; each Listener has their own Scrobbles, Days and Pinned Artists.
_Avoid_: User, account, profile

**Scrobble**:
One recorded play of one track, as logged by last.fm.
_Avoid_: Play, listen, stream

**Day**:
A calendar day in the Listener's chosen timezone, one timezone for the whole history. The timeline's Days run from the Day of the first Scrobble through today, including Days with no Scrobbles.
_Avoid_: Date (when meaning the bucket), UTC day

**Standing**:
An artist's rank by cumulative Scrobble count from the start of the history through the end of a given Day. Equal counts are ordered by which artist reached that count first (the earlier Scrobble that brought them to it), then by name. An Artist has no Standing (is unranked) before their first Scrobble.
_Avoid_: Position, place, cumulative rank

**Artist**:
An artist exactly as named by last.fm; differently spelled names are different Artists.

**Top X**:
The X artists with the best Standings on a given Day, where X is a chart setting.

**Daily plays**:
An artist's Scrobble count within a single Day, not cumulative.
_Avoid_: Day count, daily scrobbles

**Daily volume**:
A Day's Scrobble count across all Artists, as the minimap under the chart draws it.
_Avoid_: Daily total, activity

**Climber**:
Any Artist, in or out of the Top X, whose Standing improved since the previous Day, ranked by positions gained. An Artist debuting that Day counts as climbing from just below the last ranked Artist of the previous Day.
_Avoid_: Mover, riser

**Focus Day**:
The single Day the timeline is currently inspecting; its Top X, Daily plays and Climbers are what the chart reports on.
_Avoid_: Selected date, current day

**Import**:
Fetching a Listener's whole history from last.fm, newest first; it can pause and resume.

**Sync**:
Fetching a finished Listener's recent Scrobbles again (everything since the last Sync, and at least the last 14 Days) and replacing that window all at once, so late and deleted Scrobbles are reconciled. A failed Sync changes nothing.
_Avoid_: Refresh, update

**Pinned Artist**:
An Artist the Listener has chosen to keep visible on the timeline regardless of whether it is in the Top X.
