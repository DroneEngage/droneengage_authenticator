# Database Schema

This document describes the database schema for the Andruav Authenticator server, which supports three storage modes: single, file (JSON), and SQLite database.

## Storage Modes

The authenticator supports three account storage modes configured via `account_storage_type` in `server.config`:

| Mode | Description | Use Case |
|------|-------------|----------|
| `single` | Single hardcoded account | Testing/development |
| `file` | JSON file storage (LowDB) | Small deployments, no database server |
| `db` | SQLite database | Production, multi-user deployments |

## File-Based Storage (LowDB)

### Configuration

```json
{
    "account_storage_type": "file",
    "file_db": "./file_db.json"
}
```

### JSON Structure

The JSON file uses LowDB with the following structure:

```json
{
    "db_info": {
        "SID": 0
    },
    "users": {
        "user@example.com": {
            "sid": 1,
            "AccessCode": "ABC123",
            "prm": "0xffffffff",
            "isadmin": false
        },
        "admin@example.com": {
            "sid": 2,
            "AccessCode": "ADMIN123",
            "prm": "0xffffffff",
            "isadmin": true
        }
    }
}
```

### User Record Fields

| Field | Type | Description |
|-------|------|-------------|
| `sid` | number | Account Session ID (unique identifier) |
| `AccessCode` | string | Access code/password for authentication |
| `prm` | string | Permission mask (hex string, e.g., "0xffffffff") |
| `isadmin` | boolean | Admin flag for elevated privileges |
| `pwd` | string | Legacy password field (backward compatibility) |

### Database Operations

The `src/database/db_users.js` module provides:

- `fn_add_record(user_email, user_data)` - Add new user
- `fn_update_record(user_email, user_data)` - Update existing user
- `fn_delete_record(key)` - Delete user by email
- `fn_get_record(key)` - Get user by email
- `fn_get_user_by_accesscode(accesscode)` - Lookup user by access code
- `fn_get_users_by_sid(sid)` - Get all users with specific SID
- `fn_get_all_users()` - Get all non-admin users
- `fn_get_all_users_including_admins()` - Get all users
- `fn_sync_to_disk()` - Persist changes to disk

## SQLite Database Storage

### Configuration

```json
{
    "account_storage_type": "db",
    "dbdatabase": "database/andruav.db"
}
```

### Database Schema

The schema is initialized via `src/database/migrations/002_init_schema.sql`.

#### teams Table

Main team information. Each team represents an organization/group that can have multiple logins and registered hardware.

```sql
CREATE TABLE IF NOT EXISTS teams (
    TeamID INTEGER PRIMARY KEY AUTOINCREMENT,
    TeamName TEXT NOT NULL UNIQUE,
    Email TEXT,
    InstanceLimit INTEGER DEFAULT 999,
    Enabled INTEGER DEFAULT 1,
    CreatedAt TEXT DEFAULT (datetime('now')),
    UpdatedAt TEXT DEFAULT (datetime('now'))
);
```

| Column | Type | Description |
|--------|------|-------------|
| `TeamID` | INTEGER (PK) | Unique team identifier (auto-increment) |
| `TeamName` | TEXT | Team name (unique) |
| `Email` | TEXT | Team email |
| `InstanceLimit` | INTEGER | Maximum concurrent instances (default 999) |
| `Enabled` | INTEGER | Team enabled flag (0=disabled, 1=enabled) |
| `CreatedAt` | TEXT | Creation timestamp |
| `UpdatedAt` | TEXT | Last update timestamp |

#### logins Table

Access codes and permissions for a team. A team can have multiple logins with different permissions.

```sql
CREATE TABLE IF NOT EXISTS logins (
    LoginID INTEGER PRIMARY KEY AUTOINCREMENT,
    TeamID INTEGER NOT NULL,
    LoginName TEXT NOT NULL,
    AccessCode TEXT NOT NULL UNIQUE,
    Permissions INTEGER NOT NULL DEFAULT 4294967295,
    IsAdmin INTEGER DEFAULT 0,
    CreatedAt TEXT DEFAULT (datetime('now')),
    LastLogin TEXT,
    FOREIGN KEY (TeamID) REFERENCES teams(TeamID) ON DELETE CASCADE
);
```

| Column | Type | Description |
|--------|------|-------------|
| `LoginID` | INTEGER (PK) | Unique login identifier (auto-increment) |
| `TeamID` | INTEGER (FK) | Reference to teams table (cascade delete) |
| `LoginName` | TEXT | Login name/username |
| `AccessCode` | TEXT | Access code (unique) |
| `Permissions` | INTEGER | Permission bitmask (default 0xFFFFFFFF = 4294967295) |
| `IsAdmin` | INTEGER | Admin flag (0=no, 1=yes) |
| `CreatedAt` | TEXT | Creation timestamp |
| `LastLogin` | TEXT | Last login timestamp |

**Note:** One team can have multiple logins (sub-logins) with different permissions. Deleting a team cascades to delete all its logins.

#### team_hardware Table

Hardware verification information registered to a team.

```sql
CREATE TABLE IF NOT EXISTS team_hardware (
    HardwareSID INTEGER PRIMARY KEY AUTOINCREMENT,
    TeamID INTEGER NOT NULL,
    HardwareID TEXT NOT NULL,
    HardwareType TEXT NOT NULL,
    RegisteredAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (TeamID) REFERENCES teams(TeamID) ON DELETE CASCADE,
    UNIQUE(TeamID, HardwareID)
);
```

| Column | Type | Description |
|--------|------|-------------|
| `HardwareSID` | INTEGER (PK) | Unique hardware record identifier |
| `TeamID` | INTEGER (FK) | Reference to teams table (cascade delete) |
| `HardwareID` | TEXT | Hardware identifier (e.g., serial number) |
| `HardwareType` | TEXT | Hardware type (e.g., "Pixhawk", "Cube") |
| `RegisteredAt` | TEXT | Registration timestamp |

**Note:** The combination of `TeamID` and `HardwareID` is unique, preventing duplicate hardware registrations for the same team.

## Database Operations

### Login Query

Authenticate a login by access code and login name, joining with teams to check enabled status and instance limit:

```sql
SELECT * FROM logins WHERE AccessCode = ? AND LoginName = ?
```

The result is then joined with `teams` to verify `Enabled` and `InstanceLimit`:

```sql
SELECT t.Enabled, t.InstanceLimit, l.Permissions, l.IsAdmin
FROM logins l
JOIN teams t ON l.TeamID = t.TeamID
WHERE l.AccessCode = ? AND l.LoginName = ?
```

### Get Teams (Paginated)

Retrieve a paginated list of teams with optional filtering:

```sql
SELECT * FROM teams WHERE ... ORDER BY ... LIMIT ? OFFSET ?
```

### Get Logins for Team

Retrieve all logins belonging to a specific team:

```sql
SELECT * FROM logins WHERE TeamID = ? ORDER BY LoginID
```

### Create Team

Create a new team:

```sql
INSERT INTO teams (TeamName, Email, InstanceLimit, Enabled) VALUES (?, ?, ?, ?)
```

### Create Login

Create a new login for a team:

```sql
INSERT INTO logins (TeamID, LoginName, AccessCode, Permissions, IsAdmin) VALUES (?, ?, ?, ?, ?)
```

### Delete Team

Delete a team (cascades to delete associated logins and hardware):

```sql
DELETE FROM teams WHERE TeamID = ?
```

### Delete Login

Delete a specific login:

```sql
DELETE FROM logins WHERE LoginID = ?
```

## Permission Masks

Permissions are stored as hexadecimal strings:

| Mask | Description |
|------|-------------|
| `0xffffffff` | Full permissions (all bits set) |
| `D1G1T3R4V5C6` | Legacy full permission string (converted to `0xffffffff`) |
| Custom masks | Bitwise permission flags |

## Security Considerations

### File-Based Storage

- JSON files are stored in plain text
- Access codes are not hashed by default (bcrypt can be enabled)
- File permissions should be restricted (0600)
- Regular backups recommended

### SQLite Storage

- Use parameterized queries to prevent SQL injection
- Access codes are stored in plain text (consider hashing)
- Use SSL for database connections in production
- Implement proper user permissions on database
- Regular backups required

### Migration

To migrate from file to SQLite:
1. Run the migration script: `node src/database/migrate_file_db.js`
2. Update `account_storage_type` to `db`
3. Restart server

The SQLite schema is initialized via SQL migration files in `src/database/migrations/`. The main schema definition is in `src/database/migrations/002_init_schema.sql`, which creates the `teams`, `logins`, and `team_hardware` tables. These migrations run automatically when the database is first created or when the server starts with `account_storage_type` set to `db`.

## Related Documentation

- [Authentication Flow](AuthenticationFlow.md)
- [Configuration](Configuration.md)
- [API Endpoints](APIEndpoints.md)
- [S2S Authentication](S2SAuthentication.md) - Server-to-server authentication guide
- [Architecture](Architecture.md) - DroneEngage system architecture
