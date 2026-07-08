# Database Schema

This document describes the database schema for the Andruav Authenticator server, which supports three storage modes: single, file (JSON), and MySQL database.

## Storage Modes

The authenticator supports three account storage modes configured via `account_storage_type` in `server.config`:

| Mode | Description | Use Case |
|------|-------------|----------|
| `single` | Single hardcoded account | Testing/development |
| `file` | JSON file storage (LowDB) | Small deployments, no database server |
| `db` | MySQL database | Production, multi-user deployments |

## File-Based Storage (LowDB)

### Configuration

```json
{
    "account_storage_type": "file",
    "db_users": "./db_users.db"
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

The `database/db_users.js` module provides:

- `fn_add_record(user_email, user_data)` - Add new user
- `fn_update_record(user_email, user_data)` - Update existing user
- `fn_delete_record(key)` - Delete user by email
- `fn_get_record(key)` - Get user by email
- `fn_get_user_by_accesscode(accesscode)` - Lookup user by access code
- `fn_get_users_by_sid(sid)` - Get all users with specific SID
- `fn_get_all_users()` - Get all non-admin users
- `fn_get_all_users_including_admins()` - Get all users
- `fn_sync_to_disk()` - Persist changes to disk

## MySQL Database Storage

### Configuration

```json
{
    "account_storage_type": "db",
    "dbIP": "localhost",
    "dbuser": "USERNAME",
    "dbpassword": "PASSWORD",
    "dbdatabase": "andruav"
}
```

### Database Schema

#### account Table

Main account information.

```sql
CREATE TABLE account (
    Account_SID INT AUTO_INCREMENT PRIMARY KEY,
    Name VARCHAR(255) UNIQUE NOT NULL,
    Enabled TINYINT(1) DEFAULT 1,
    Instance_Limit INT DEFAULT 10
);
```

| Column | Type | Description |
|--------|------|-------------|
| `Account_SID` | INT (PK) | Unique account identifier |
| `Name` | VARCHAR(255) | Account name/email (unique) |
| `Enabled` | TINYINT(1) | Account enabled flag (0=disabled, 1=enabled) |
| `Instance_Limit` | INT | Maximum concurrent instances |

#### account_details Table

Access codes and permissions for accounts.

```sql
CREATE TABLE account_details (
    Account_SID INT NOT NULL,
    AccessCode VARCHAR(255) NOT NULL,
    Permission VARCHAR(255) DEFAULT '0xffffffff',
    PRIMARY KEY (Account_SID, AccessCode),
    FOREIGN KEY (Account_SID) REFERENCES account(Account_SID)
);
```

| Column | Type | Description |
|--------|------|-------------|
| `Account_SID` | INT (FK) | Reference to account table |
| `AccessCode` | VARCHAR(255) | Access code/password |
| `Permission` | VARCHAR(255) | Permission mask (hex string) |

**Note:** One account can have multiple access codes (sub-logins) with different permissions.

#### account_hw_info Table

Hardware verification information for accounts.

```sql
CREATE TABLE account_hw_info (
    SID INT AUTO_INCREMENT PRIMARY KEY,
    Account_SID INT NOT NULL,
    HW_ID VARCHAR(255) NOT NULL,
    HW_Type VARCHAR(255),
    register_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (Account_SID) REFERENCES account(Account_SID)
);
```

| Column | Type | Description |
|--------|------|-------------|
| `SID` | INT (PK) | Hardware record identifier |
| `Account_SID` | INT (FK) | Reference to account table |
| `HW_ID` | VARCHAR(255) | Hardware identifier (e.g., serial number) |
| `HW_Type` | VARCHAR(255) | Hardware type (e.g., "Pixhawk", "Cube") |
| `register_time` | TIMESTAMP | Registration timestamp |

## Database Operations

### Login Query

```sql
SELECT 
    account.Account_SID, 
    account.Enabled, 
    account.Instance_Limit, 
    account_details.Permission 
FROM account_details, account 
WHERE account_details.AccessCode = ? 
  AND account.Account_SID = account_details.Account_SID 
  AND account.Name = ?
```

### Get Account by Access Code

```sql
SELECT account.Name 
FROM account_details, account 
WHERE account_details.AccessCode = ? 
  AND account.Account_SID = account_details.Account_SID
```

### Create Sub-Login

```sql
INSERT INTO account_details (Account_SID, AccessCode, Permission)
SELECT account.Account_SID, ?, ? 
FROM account 
WHERE account.Name = ?
```

### Create New Account

```sql
INSERT INTO account (Account_SID, Name) 
VALUES (NULL, ?)
```

### Delete Sub-Logins

```sql
DELETE FROM account_details 
WHERE Account_SID IN (
    SELECT Account_SID FROM account WHERE Name LIKE ?
) 
AND Permission LIKE ?
```

### Get Hardware by Account

```sql
SELECT 
    account_hw_info.SID, 
    account_hw_info.HW_ID, 
    account_hw_info.HW_Type, 
    account_hw_info.register_time 
FROM account_hw_info 
WHERE account_hw_info.Account_SID = ?
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

### MySQL Storage

- Use parameterized queries to prevent SQL injection
- Access codes are stored in plain text (consider hashing)
- Use SSL for database connections in production
- Implement proper user permissions on database
- Regular backups required

### Migration

To migrate from file to MySQL:
1. Export JSON data to SQL INSERT statements
2. Create MySQL tables using schema above
3. Import data
4. Update `account_storage_type` to `db`
5. Restart server

## Related Documentation

- [Authentication Flow](AuthenticationFlow.md)
- [Configuration](Configuration.md)
- [API Endpoints](APIEndpoints.md)
