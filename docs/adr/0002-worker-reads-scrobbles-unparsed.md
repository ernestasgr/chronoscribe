# The Standings worker reads Scrobble rows without parsing them

The coding standards say Dexie rows go through a Zod schema, and Listener and settings rows do. Scrobble rows read by the Standings worker are the exception: a history can hold around a million of them, and parsing each one on every build would add seconds to a build that otherwise takes well under one. We accept this because only ingest writes Scrobbles, from last.fm pages that are already parsed at the boundary, so the rows have one trusted writer.

## Consequences

If anything else ever writes Scrobbles (an import from a file, a schema migration), it must parse before writing, or this decision must be revisited.
