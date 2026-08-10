# Database — CSV Import & SQLite Generation

This folder contains the SQLite schema and the migration/import script used to
build the `db`-backed account store (`account_storage_type = "db"` in
`server.config`).

## Files

| File | Purpose |
|------|---------|
| `migrate_file_db.js` | Migration & CSV import script. Generates a fresh SQLite DB from a legacy JSON `db_users.db` and/or CSV files. |
| `migrations/002_init_schema.sql` | Schema used for new installations (`teams`, `logins`, `team_hardware`). |
| `migrations/001_redesign_schema.sql` | In-place migration of the old `account` / `account_details` / `account_hw_info` tables into the new normalized schema (used when migrating an existing SQLite DB, not by the CSV importer). |
| `db_users.js` | Runtime data-access layer used by the auth server when `account_storage_type = "db"`. |

## Resulting SQLite Schema

The importer always recreates the DB from `002_init_schema.sql`:

- **teams** — one row per account/team. `TeamID` is the legacy `Account_SID`.
- **logins** — one row per credential. `LoginID` is the legacy `account_details.SID`, linked to `teams.TeamID`.
- **team_hardware** — registered hardware per team (not populated by the CSV importer).

See `migrations/002_init_schema.sql` for full column definitions.

## CSV Import

The importer reads two CSV files from a directory you pass via `--csv-dir`:

- `account.csv` → `teams`
- `account_details.csv` → `logins`

Both files **must** be present in the same directory, otherwise CSV import is
skipped with a warning. The importer uses a small built-in RFC-4180-style parser
(quoted fields, escaped `""` quotes, comma separator). No header renaming is
performed — column names must match exactly (case-sensitive).

### `account.csv` — required columns

Header (exact):

```csv
"Account_SID","Name","Instance_Limit","Enabled","register_time"
```

| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `Account_SID` | integer | yes | Primary key → `teams.TeamID`. Rows where this parses to `0`/`NaN` are skipped. |
| `Name` | string | yes | Team/login display name. Also stored as `teams.Email` (the importer does not have a separate email column). |
| `Instance_Limit` | integer | no | Defaults to `999` if missing/empty. |
| `Enabled` | integer/bool | no | `1`, `true`, `yes` (case-insensitive) → `1`; anything else → `0`. |
| `register_time` | datetime string | no | Stored verbatim into `teams.CreatedAt` and `teams.UpdatedAt`. Falls back to `now()` if empty. |

Example:

```csv
"Account_SID","Name","Instance_Limit","Enabled","register_time"
"4","team@ardupilot.com","999","1","2021-11-23 19:13:25"
```

### `account_details.csv` — required columns

Header (exact):

```csv
"SID","Account_SID","PWD","Permission","register_time"
```

| Column | Type | Required | Notes |
|--------|------|----------|-------|
| `SID` | integer | yes | Primary key → `logins.LoginID`. |
| `Account_SID` | integer | yes | Foreign key → `teams.TeamID`. **Rows whose `Account_SID` does not match any row in `account.csv` are silently skipped.** |
| `PWD` | string | yes | Access code → `logins.AccessCode`. Must be unique across all logins (DB enforces `UNIQUE`); duplicates are skipped during insert. |
| `Permission` | string | no | Hex permission bitmask. See parsing rules below. Defaults to `4294967295` (`0xffffffff`, all permissions). |
| `register_time` | datetime string | no | Stored verbatim into `logins.CreatedAt`. Falls back to `now()` if empty. |

Example:

```csv
"SID","Account_SID","PWD","Permission","register_time"
"4","5","5350","0xffffffff","2021-12-02 00:17:16"
```

### `Permission` parsing rules

The importer (`parsePermission`) interprets the `Permission` column as follows:

| Value | Resulting `logins.Permissions` |
|-------|--------------------------------|
| empty / missing | `4294967295` (`0xffffffff`) |
| literal `D1G1T3R4V5C6` | `4294967295` (legacy "all permissions" sentinel) |
| `0x...` prefix | parsed as hex, e.g. `0xffffffff` → `4294967295` |
| bare hex digits (no `0x`) | parsed as hex, e.g. `ff` → `255` |
| anything unparseable | `4294967295` |

`IsAdmin` is always set to `0` for CSV-imported logins (the importer does not
read an admin flag from CSV).

## Usage

Run from the authenticator root (`andruav_authenticator/`):

```bash
# Import only the CSV files in ./migrate.tmp into the DB path from server.config
node src/database/migrate_file_db.js --csv-dir ./migrate.tmp

# Import CSV into a specific output DB (recommended — see note below)
node src/database/migrate_file_db.js --csv-dir ./migrate.tmp --output ./src/database/andruav_DB.db

# Merge a legacy JSON db_users.db AND CSV into the output DB
node src/database/migrate_file_db.js db_users.db --csv-dir ./migrate.tmp
```

### Path resolution

- **Output DB** (`--output`): if omitted, uses `server.config.dbdatabase`
  (currently `database/andruav.db`). Falls back to `src/database/andruav.db`.
- **Input JSON** (positional arg): if omitted, uses `server.config.file_db`
  (`./file_db.json`). If that file does not exist, JSON import is skipped with a
  warning and only CSV data is used.

> **Important — `--output` must match `server.config.dbdatabase`.**
> The auth server opens whatever path is in `server.config.dbdatabase` at
> startup. If you import into a different path, the server will not see your
> data. Always pass `--output <same value as server.config.dbdatabase>`, or
> omit `--output` and let the script read the path from `server.config`.
>
> Example: if `server.config` has `"dbdatabase": "src/database/andruav_DB.db"`,
> then run:
> ```bash
> node src/database/migrate_file_db.js --csv-dir ./migrate.tmp --output ./src/database/andruav_DB.db
> ```

### What the importer does to the output DB

The importer **deletes and recreates** the output SQLite file:

1. Removes the existing output file if present.
2. Runs `migrations/002_init_schema.sql` (creates `teams`, `logins`,
   `team_hardware`).
3. Inserts teams (CSV + JSON merged, deduped by `TeamID`).
4. Inserts logins (CSV + JSON merged, deduped by `LoginID`; duplicate
   `AccessCode` values are skipped).
5. Commits in a single transaction.

It does **not** perform an incremental merge into an existing populated DB —
back up the output file first if you need to keep its current contents.

## After importing

1. In `server.config`, set:
   ```json
   "account_storage_type" : "db",
   ```
2. Start the server: `npm start` (or `node ./src/server.js`).
3. The server will now read accounts from the SQLite DB at
   `server.config.dbdatabase`.

## Troubleshooting: "Server is Down." on every login (`/al`, `/wl`, `/wo`)

If the auth server starts, reports `[OK] SQLite Database is Connected: <path>`,
but every login attempt returns `{"em":"Server is Down.","e":3,...}`, the most
likely cause is that the SQLite file exists but has **no schema** (no `teams` /
`logins` tables). The server's startup code only *opens* the DB file — it does
not create the schema. Only `migrate_file_db.js` (or running
`migrations/002_init_schema.sql` manually) creates the tables.

### Confirm the cause

```bash
sqlite3 ./src/database/andruav_DB.db ".tables"
sqlite3 ./src/database/andruav_DB.db ".schema logins"
```

If both commands print nothing, the DB file is empty (no tables) and every
query fails with `no such table: logins`. The error is currently swallowed by
the database-manager error callbacks, which is why you only see the generic
"Server is Down." message instead of the real SQLite error.

### Fix

Regenerate the DB from your CSVs (this creates the schema and imports the
data in one step):

```bash
cd /home/ap_cloud/de_server/droneengage_authenticator

# Verify your CSVs are present
ls ./migrate.tmp/   # should list account.csv and account_details.csv

# Regenerate the DB with the correct schema + CSV data
# Use the SAME path that is in server.config.dbdatabase
node src/database/migrate_file_db.js --csv-dir ./migrate.tmp --output ./src/database/andruav_DB.db
```

Then restart the server.

### Verify

```bash
sqlite3 ./src/database/andruav_DB.db ".tables"
# Expect: logins  team_hardware  teams

sqlite3 ./src/database/andruav_DB.db "SELECT count(*) FROM teams; SELECT count(*) FROM logins;"
```

### Alternative: migrate an existing old-schema DB in place

If the DB file already contains data in the legacy `account` /
`account_details` / `account_hw_info` tables and you want to keep it instead
of re-importing from CSV, run the in-place migration SQL:

```bash
sqlite3 ./src/database/andruav_DB.db < src/database/migrations/001_redesign_schema.sql
```

This creates the new `teams` / `logins` / `team_hardware` tables and copies
the data over from the legacy tables (the legacy tables are left intact for
rollback).
