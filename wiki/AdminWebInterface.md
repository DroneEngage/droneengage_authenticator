# Admin Web Interface

The Andruav Authenticator includes a web-based admin interface for monitoring and managing the authentication server, registered users, and connected communication servers.

## Overview

The admin interface provides a real-time dashboard for:
- Viewing system statistics (total users, online servers, connected users)
- Managing user accounts (file-based or database storage)
- Monitoring communication server status and connected users
- Viewing database configuration

## Access

To access the admin interface:
1. Navigate to `https://<auth-server-host>:<webadmin_port>`
2. Login with the credentials configured in `server.config`

**Default credentials (change in production):**
- Username: `admin`
- Password: `admin123`

## Features

### Dashboard

The main dashboard displays:

- **Database Configuration**: Shows the current storage type (single/file/db) with a descriptive badge
- **Total Users**: Count of registered users (varies by storage type)
- **Online Servers**: Number of active communication servers connected via S2S
- **Connected Users**: Total users currently connected across all servers

Statistics auto-refresh every 30 seconds.

![Admin Dashboard](https://raw.githubusercontent.com/DroneEngage/droneengage_authenticator/refs/heads/release/wiki/images/_new_dashboard_authweb.png)

### User Management

The user management interface varies based on the `account_storage_type` configuration:

#### File-Based Storage (`account_storage_type: "file"`)
- Access via "Users" link in navigation
- View and manage users stored in JSON file (`db_users`)
- CRUD operations for user accounts

#### Database Storage (`account_storage_type: "db"`)
- Access via "Teams & Logins" link in navigation
- Manage teams and their associated logins
- SQLite database backend with migrations

#### Single Account Mode (`account_storage_type: "single"`)
- No user management interface (single hardcoded account)
- Dashboard shows "N/A" for user count

### Server Status

The "Servers" page provides real-time monitoring of communication servers:

- **Server Grid**: Visual cards showing each registered server
  - Server ID
  - Online/Offline status (green/red badge)
  - Public IP address
  - Port number
  - Version information

- **Connected Users Panel**: When a server is selected, shows:
  - Login ID
  - Account ID (with hashed account ID)
  - Unit name
  - Actor type (GCS, Agent, Admin)

Servers auto-refresh every 30 seconds. Click on a server card to view its connected users.

![Server Status](https://raw.githubusercontent.com/DroneEngage/droneengage_authenticator/refs/heads/release/wiki/images/_new_airgap_auth_site.png)

## Configuration

The admin interface is configured in `server.config`:

```json
{
    "webadmin_enable": true,
    "admin_username": "admin",
    "admin_password": "admin123",
    "session_secret": "change-this-secret-in-production",
    "webadmin_port": 8089,
    "webadmin_listening_ip": "0.0.0.0"
}
```

### Configuration Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `webadmin_enable` | boolean | true | Enable/disable admin web interface |
| `admin_username` | string | "admin" | Admin username for login |
| `admin_password` | string | "admin123" | Admin password for login |
| `session_secret` | string | required | Secret for session encryption |
| `webadmin_port` | number | 8089 | Port for admin web interface |
| `webadmin_listening_ip` | string | "0.0.0.0" | IP address to bind to |

## Security Considerations

### Production Deployment

1. **Change Default Credentials**
   - Always change `admin_username` and `admin_password`
   - Use strong, unique passwords

2. **Session Secret**
   - Use a long, random string for `session_secret`
   - Different for each deployment
   - Never commit to version control

3. **SSL/TLS**
   - Ensure `enable_SSL` is `true` in production
   - Use valid certificates from a trusted CA
   - Access via HTTPS only

4. **Network Access**
   - Consider binding to specific IP instead of `0.0.0.0`
   - Use firewall rules to restrict access
   - Consider VPN or private network access

5. **CSRF Protection**
   - Interface uses CSRF tokens for form submissions
   - Sessions are encrypted using the session secret

## API Endpoints

The admin interface uses internal API endpoints:

- `GET /admin/api/users` - List users (file storage)
- `GET /admin/api/sql/teams` - List teams (database storage)
- `GET /admin/api/servers` - List communication servers

These endpoints require admin session authentication.

## Troubleshooting

### Cannot Access Admin Interface

- Verify `webadmin_enable` is `true` in `server.config`
- Check that `webadmin_port` is not blocked by firewall
- Ensure SSL certificates are valid if `enable_SSL` is true
- Review server logs for startup errors

### Login Fails

- Verify `admin_username` and `admin_password` in `server.config`
- Check that `session_secret` is set
- Clear browser cookies and try again
- Check browser console for JavaScript errors

### Statistics Not Loading

- Verify API endpoints are accessible
- Check browser console for network errors
- Ensure storage backend (file/database) is accessible
- Review server logs for API errors

### Server Status Not Updating

- Verify S2S WebSocket connection is working
- Check `s2s_ws_listening_ip` and `s2s_ws_listening_port` configuration
- Ensure communication servers are properly authenticated
- Review S2S authentication logs

## Related Documentation

- [Configuration](Configuration.md) - Complete server configuration reference
- [Authentication Flow](AuthenticationFlow.md) - How authentication works
- [Database Schema](DatabaseSchema.md) - Database structure for storage modes
- [API Endpoints](APIEndpoints.md) - Public API reference
