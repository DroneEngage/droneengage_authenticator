# Configuration

This document describes the configuration options for the Andruav Authenticator server.

## Configuration File

The server is configured via `server.config` (JSON format). You can create environment-specific configs by copying and renaming (e.g., `server.config.local`, `server.config.production`).

## Server Settings

### Basic Server Configuration

```json
{
    "server_id": "AndruavAuth",
    "server_ip": "0.0.0.0",
    "server_port": 19408,
    "health_utl": "/h"
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `server_id` | string | "AndruavAuth" | Unique server identifier for S2S authentication |
| `server_ip` | string | "0.0.0.0" | IP address to bind to (0.0.0.0 = all interfaces) |
| `server_port` | number | 19408 | HTTP/HTTPS port for the server |
| `health_utl` | string | "/h" | Health check endpoint path |

## Account Storage

### Storage Mode

```json
{
    "account_storage_type": "file"
}
```

| Value | Description |
|-------|-------------|
| `single` | Single hardcoded account (testing only) |
| `file` | JSON file storage (LowDB) |
| `db` | SQLite database storage |

### Single Account Mode

```json
{
    "account_storage_type": "single",
    "single_account_user_name": "single@airgap.droneengage.com",
    "single_account_access_code": "test"
}
```

### File-Based Storage

```json
{
    "account_storage_type": "file",
    "file_db": "./file_db.json"
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `file_db` | string | "./file_db.json" | Path to JSON database file |

### SQLite Database Storage

```json
{
    "account_storage_type": "db",
    "dbdatabase": "database/andruav.db"
}
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `dbdatabase` | string | SQLite database file path |

## Server-to-Server (S2S) Configuration

### S2S WebSocket Listener

```json
{
    "s2s_ws_listening_ip": "127.0.0.1",
    "s2s_ws_listening_port": 19001
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `s2s_ws_listening_ip` | string | "127.0.0.1" | IP address for S2S WebSocket connections |
| `s2s_ws_listening_port` | number | 19001 | Port for S2S WebSocket connections |

### S2S Authentication

```json
{
    "s2s_auth_enabled": true,
    "s2s_trusted_server_keys": {
        "AndruavLap": "./ssl/AndruavLap_public.pem",
        "SuperServer": "./ssl/SuperServer_public.pem",
        "DronCommServer": "./ssl/DronCommServer_public.pem"
    }
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `s2s_auth_enabled` | boolean | false | Enable S2S Ed25519 authentication |
| `s2s_trusted_server_keys` | object | {} | Mapping of server_id to public key file paths |

**Note:** The authenticator only accepts connections, so it only needs public keys. See [S2SAuthentication.md](../andruav_server/wiki/S2SAuthentication.md) for complete setup guide.

## SSL/TLS Configuration

```json
{
    "enable_SSL": true,
    "ssl_key_file": "ssl/domain.key",
    "ssl_cert_file": "ssl/domain.crt"
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `enable_SSL` | boolean | true | Enable HTTPS |
| `ssl_key_file` | string | "ssl/domain.key" | Path to SSL private key file |
| `ssl_cert_file` | string | "ssl/domain.crt" | Path to SSL certificate file |

## Admin Interface Configuration

```json
{
    "webadmin_enable": true,
    "admin_username": "admin",
    "admin_password": "$$HASH$$('admin123')",
    "session_secret": "change-this-secret-in-production",
    "webadmin_port": 8089,
    "webadmin_listening_ip": "0.0.0.0",
    "servers_admin_url_guid": "",
    "webadmin_terminal_enabled": true
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `webadmin_enable` | boolean | true | Enable the admin web interface |
| `admin_username` | string | "admin" | Admin username for web interface |
| `admin_password` | string | "$$HASH$$('admin123')" | Admin password — supports `$$HASH$$('plaintext')` directive (see [Sensitive Value Hashing](#sensitive-value-hashing)) |
| `session_secret` | string | required | Secret for session encryption (change in production) |
| `webadmin_port` | number | 8089 | Port for admin web interface |
| `webadmin_listening_ip` | string | "0.0.0.0" | IP address to bind admin web interface |
| `servers_admin_url_guid` | string | "" | Secret GUID prefix for admin URLs. When set, entire admin interface is hidden behind /admin/<guid>/* |
| `webadmin_terminal_enabled` | boolean | true | Enable web terminal for remote shell access. Commands run with server process privileges |

**Security Note:** Always change `admin_username`, `admin_password`, and `session_secret` in production. Use the `$$HASH$$('...')` directive for `admin_password` so the plaintext is not stored in the config file.

## Sensitive Value Hashing

The config handler (`src/helpers/js_config_handler.js`) automatically detects the `$$HASH$$('plaintext')` directive in string config values and replaces it with a bcrypt hash.

### How It Works

1. You write the directive in `server.config`:
   ```json
   {
       "admin_password": "$$HASH$$('mySecretPassword')"
   }
   ```
2. On startup, the config handler:
   - Detects the `$$HASH$$('...')` pattern in the parsed config
   - Computes a bcrypt hash (10 salt rounds) of the plaintext
   - Replaces the value **in memory** so the running server uses the hash
   - Persists the hash back to the config **file**, replacing only the `$$HASH$$('...')` substring — all comments, whitespace, and other values are preserved exactly as-is
3. After the first run, the file contains the raw hash directly:
   ```json
   {
       "admin_password": "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"
   }
   ```
4. Subsequent starts are a no-op — the value is already a hash, so nothing changes.

### Changing the Password

To change the admin password, replace the hash with a new directive and restart:
```json
{
    "admin_password": "$$HASH$$('newPassword')"
}
```
The handler will hash the new plaintext and persist it on the next startup.

### Backward Compatibility

Plaintext passwords are still accepted as a fallback. If `admin_password` does not start with `$2` (the bcrypt hash prefix), it is compared directly as plaintext and a warning is logged:
```
[WARN] admin_password is stored in plaintext. Use $$HASH$$('...') in server.config and restart to hash it.
```

### Supported Directives

| Directive | Description |
|-----------|-------------|
| `$$HASH$$('plaintext')` | Replaced with `bcrypt.hashSync(plaintext, 10)` on first startup |
| `$$HASH$$("plaintext")` | Same as above (double quotes also accepted) |

The directive works on any top-level string config value, not just `admin_password`.

## Logging Configuration

```json
{
    "enableLog": false,
    "log_directory": "./logs/",
    "log_timeZone": "GMT",
    "log_detailed": true
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `enableLog` | boolean | false | Enable logging |
| `log_directory` | string | "./logs/" | Directory for log files |
| `log_timeZone` | string | "GMT" | Timezone for log timestamps |
| `log_detailed` | boolean | true | Enable detailed logging |

## Application Configuration

```json
{
    "skip_hardware_validation": true,
    "andruavSecurityEx": "Andruav Web Panel, Andruav Geo Fence Manager, DRONE ENGAGE Web Client, Andruav Mobile, uavos"
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `skip_hardware_validation` | boolean | true | Skip hardware ID validation |
| `andruavSecurityEx` | string | - | Allowed client applications |

## Example Configuration Files

### Development (server.config)

```json
{
    "server_id": "AndruavAuth",
    "server_ip": "0.0.0.0",
    "server_port": 19408,
    "health_utl": "/h",
    "account_storage_type": "file",
    "file_db": "./file_db.json",
    "enableLog": true,
    "log_directory": "./logs/",
    "log_timeZone": "GMT",
    "log_detailed": true,
    "ignoreEmail": true,
    "s2s_ws_listening_ip": "127.0.0.1",
    "s2s_ws_listening_port": 19001,
    "s2s_auth_enabled": false,
    "enable_SSL": false,
    "webadmin_enable": true,
    "admin_username": "admin",
    "admin_password": "$$HASH$$('admin123')",
    "session_secret": "dev-secret",
    "webadmin_port": 8089,
    "webadmin_listening_ip": "0.0.0.0",
    "servers_admin_url_guid": "",
    "webadmin_terminal_enabled": true,
    "skip_hardware_validation": true
}
```

### Production (server.config.production)

```json
{
    "server_id": "AndruavAuth",
    "server_ip": "0.0.0.0",
    "server_port": 19408,
    "health_utl": "/h",
    "account_storage_type": "db",
    "dbdatabase": "database/andruav.db",
    "enableLog": true,
    "log_directory": "/var/log/andruav_auth/",
    "log_timeZone": "UTC",
    "log_detailed": false,
    "ignoreEmail": false,
    "s2s_ws_listening_ip": "0.0.0.0",
    "s2s_ws_listening_port": 19001,
    "s2s_auth_enabled": true,
    "s2s_trusted_server_keys": {
        "Server1": "./ssl/Server1_public.pem",
        "Server2": "./ssl/Server2_public.pem"
    },
    "enable_SSL": true,
    "ssl_key_file": "/etc/ssl/private/domain.key",
    "ssl_cert_file": "/etc/ssl/certs/domain.crt",
    "webadmin_enable": true,
    "admin_username": "admin",
    "admin_password": "$$HASH$$('secure_password')",
    "session_secret": "random_long_secret_string",
    "webadmin_port": 8089,
    "webadmin_listening_ip": "127.0.0.1",
    "servers_admin_url_guid": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "webadmin_terminal_enabled": false,
    "skip_hardware_validation": false
}
```

## Environment Variables

You can override configuration values using environment variables:

| Variable | Description |
|----------|-------------|
| `de_auth_server_port` | Overrides `server_port` |
| `de_auth_webadminport` | Overrides `webadmin_port` |
| `de_auth_servers_status_guid` | Overrides `servers_admin_url_guid` |
| `de_auth_webadmin_terminal_enabled` | Overrides `webadmin_terminal_enabled` (`"true"`/`"1"` = enabled) |

```bash
export de_auth_server_port=19408
export de_auth_webadminport=8089
export de_auth_servers_status_guid=a1b2c3d4-e5f6-7890-abcd-ef1234567890
export de_auth_webadmin_terminal_enabled=false
```

## Security Best Practices

1. **Change Default Credentials**
   - Always change `admin_username` and `admin_password`
   - Use strong, unique passwords
   - Use the `$$HASH$$('...')` directive for `admin_password` so it is stored as a bcrypt hash (see [Sensitive Value Hashing](#sensitive-value-hashing))

2. **Session Secret**
   - Use a long, random string for `session_secret`
   - Different for each deployment

3. **SSL/TLS**
   - Always enable `enable_SSL` in production
   - Use valid certificates from a trusted CA
   - Restrict file permissions on key files (0600)

4. **Database**
   - Use strong database passwords
   - Restrict database user permissions
   - Use SSL for database connections

5. **S2S Authentication**
   - Enable `s2s_auth_enabled` in production
   - Keep private keys secure (0600 permissions)
   - Rotate keys periodically

6. **Logging**
   - Disable detailed logging in production
   - Use centralized log management
   - Protect log files from unauthorized access

## Troubleshooting

### Server Won't Start

- Check JSON syntax is valid
- Verify file paths exist
- Check port is not in use
- Review logs for error messages

### Database Connection Failed

- Verify SQLite database file is accessible
- Check `dbdatabase` path in config
- Ensure database directory exists and is writable

### S2S Authentication Fails

- Verify public keys are in `ssl/` directory
- Check `s2s_trusted_server_keys` configuration
- Ensure server IDs match key filenames
- Verify key file permissions (0600)

### Admin Interface Not Accessible

- Check `webadmin_port` is not blocked by firewall
- Verify admin credentials
- Check session secret is set
- Review browser console for errors

## Related Documentation

- [Authentication Flow](AuthenticationFlow.md)
- [Database Schema](DatabaseSchema.md)
- [API Endpoints](APIEndpoints.md)
- [S2S Authentication](S2SAuthentication.md) - Server-to-server authentication guide
- [Architecture](Architecture.md) - DroneEngage system architecture
