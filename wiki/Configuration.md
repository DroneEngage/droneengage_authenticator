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
| `db` | MySQL database storage |

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
    "db_users": "./db_users.db"
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `db_users` | string | "./db_users.db" | Path to JSON database file |

### MySQL Database Storage

```json
{
    "account_storage_type": "db",
    "dbIP": "localhost",
    "dbuser": "USERNAME",
    "dbpassword": "PASSWORD",
    "dbdatabase": "andruav"
}
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `dbIP` | string | MySQL server IP address |
| `dbuser` | string | MySQL username |
| `dbpassword` | string | MySQL password |
| `dbdatabase` | string | MySQL database name |

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
    "admin_username": "admin",
    "admin_password": "admin123",
    "session_secret": "change-this-secret-in-production",
    "webadmin_port": 8089
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `admin_username` | string | "admin" | Admin username for web interface |
| `admin_password` | string | "admin123" | Admin password for web interface |
| `session_secret` | string | required | Secret for session encryption (change in production) |
| `webadmin_port` | number | 8089 | Port for admin web interface |

**Security Note:** Always change `admin_username`, `admin_password`, and `session_secret` in production.

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
    "andruavSecurityEx": "Andruav Web Panel, Andruav Geo Fence Manager, DRONE ENGAGE Web Client, Andruav Mobile, uavos",
    "APPVERSION": "{\"andruav\": \"4.00.00\", \"uavos\": \"1.0.0\", \"de\": \"1.0.0\"}"
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `skip_hardware_validation` | boolean | true | Skip hardware ID validation |
| `andruavSecurityEx` | string | - | Allowed client applications |
| `APPVERSION` | string | - | JSON string with version info for each app |

## Example Configuration Files

### Development (server.config)

```json
{
    "server_id": "AndruavAuth",
    "server_ip": "0.0.0.0",
    "server_port": 19408,
    "health_utl": "/h",
    "account_storage_type": "file",
    "db_users": "./db_users.db",
    "enableLog": true,
    "log_directory": "./logs/",
    "log_timeZone": "GMT",
    "log_detailed": true,
    "ignoreEmail": true,
    "s2s_ws_listening_ip": "127.0.0.1",
    "s2s_ws_listening_port": 19001,
    "s2s_auth_enabled": false,
    "enable_SSL": false,
    "admin_username": "admin",
    "admin_password": "admin123",
    "session_secret": "dev-secret",
    "webadmin_port": 8089,
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
    "dbIP": "localhost",
    "dbuser": "andruav_user",
    "dbpassword": "secure_password",
    "dbdatabase": "andruav",
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
    "admin_username": "admin",
    "admin_password": "secure_password",
    "session_secret": "random_long_secret_string",
    "webadmin_port": 8089,
    "skip_hardware_validation": false
}
```

## Environment Variables

You can override configuration values using environment variables. Prefix with `ANDRUAV_` and use underscores:

```bash
export ANDRUAV_SERVER_PORT=19408
export ANDRUAV_DBIP=localhost
export ANDRUAV_DBUSER=andruav_user
export ANDRUAV_DBPASSWORD=secure_password
```

## Security Best Practices

1. **Change Default Credentials**
   - Always change `admin_username` and `admin_password`
   - Use strong, unique passwords

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

- Verify MySQL is running
- Check database credentials
- Ensure database exists
- Test network connectivity

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
- [S2S Authentication](../andruav_server/wiki/S2SAuthentication.md)
