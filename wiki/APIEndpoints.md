# API Endpoints

This document describes the REST API endpoints provided by the Andruav Authenticator server.

## Base URL

The base URL depends on your configuration:
- HTTP: `http://<server_ip>:<server_port>`
- HTTPS: `https://<server_ip>:<server_port>`

Default port: `19408`

## Health Check

### GET /h/health

Health check endpoint for monitoring.

**Response:**
```json
{
    "status": "OK",
    "version": "7.0.1",
    "server_id": "AndruavAuth"
}
```

## Admin Endpoints

Admin endpoints are protected by session-based authentication. All admin endpoints require a valid admin session.

### Authentication

#### POST /admin/login

Admin login endpoint with rate limiting (5 attempts per 15 minutes) and CSRF protection.

**Request Body:**
```json
{
    "username": "admin",
    "password": "admin123"
}
```

**Response:** Redirects to `/admin/dashboard` on success, or back to login with error.

#### POST /admin/logout

Logout and destroy admin session.

**Response:** Redirects to `/admin/login`.

### Protected Admin Pages

#### GET /admin/dashboard

Admin dashboard page (requires authentication).

#### GET /admin/users

User management page (requires authentication).

#### GET /admin/servers

Server status page (requires authentication).

### Admin API Endpoints

#### GET /admin/api/users

Get all users including admins.

**Authentication:** Required

**Response:**
```json
{
    "error": 0,
    "users": {
        "user@example.com": {
            "sid": 1,
            "AccessCode": "ABC123",
            "prm": "0xffffffff",
            "isadmin": false
        }
    }
}
```

#### POST /admin/api/users

Create a new user or update existing user.

**Authentication:** Required

**Request Body:**
```json
{
    "email": "user@example.com",
    "sid": 1,
    "prm": "0xffffffff",
    "isadmin": false
}
```

**Response:**
```json
{
    "error": 0,
    "AccessCode": "generated_access_code"
}
```

**Error Response:**
```json
{
    "error": 1,
    "errorMessage": "Missing required fields"
}
```

#### PUT /admin/api/users/:email

Update an existing user.

**Authentication:** Required

**Request Body:**
```json
{
    "sid": 1,
    "prm": "0xffffffff",
    "isadmin": false
}
```

**Response:**
```json
{
    "error": 0,
    "AccessCode": "existing_access_code"
}
```

#### DELETE /admin/api/users/:email

Delete a user.

**Authentication:** Required

**Response:**
```json
{
    "error": 0
}
```

#### GET /admin/api/servers

Get status of all communication servers.

**Authentication:** Required

**Response:**
```json
{
    "error": 0,
    "servers": [
        {
            "serverId": "Server1",
            "isOnline": true,
            "public_host": "127.0.0.1",
            "serverPort": 9966,
            "version": "3.9.11",
            "accounts": []
        }
    ]
}
```

#### GET /admin/terminal

Web terminal page (requires authentication and `webadmin_terminal_enabled`).

#### WS /admin/api/terminal/ws

WebSocket endpoint for the interactive web terminal. Requires admin session authentication via cookie. Spawns a PTY shell and pipes input/output bidirectionally.

#### GET /admin/wiki

Wiki index page listing all available documentation pages (requires authentication).

#### GET /admin/wiki/:page

View a specific wiki page rendered as HTML (requires authentication).

#### GET /admin/wiki/images/:filename

Serve wiki images (requires authentication, image files only).

#### GET /admin/api/sql/teams

Get paginated teams with logins (database storage mode only).

**Query Parameters:** `page`, `limit`, `search`, `sortBy`, `sortDir`

#### GET /admin/api/sql/stats

Get total counts of logins and teams (database storage mode only).

#### POST /admin/api/sql/teams

Create a new team (database storage mode only).

#### DELETE /admin/api/sql/teams/:id

Delete a team (database storage mode only).

#### POST /admin/api/sql/logins

Create a new login under a team (database storage mode only).

#### DELETE /admin/api/sql/logins/:id

Delete a login (database storage mode only).

## Agent Endpoints

Agent endpoints are used by drone/agent clients for authentication and account operations.

### POST /agent/login

Agent login request.

**Request Body:**
```json
{
    "accountName": "user@example.com",
    "accessCode": "ABC123",
    "group": "group_id",
    "app": "Andruav",
    "version": "4.00.00",
    "extra": {}
}
```

**Response:**
```json
{
    "command": "agent_login",
    "sid": "encrypted_session_id",
    "serverIP": "127.0.0.1",
    "serverPort": 9966,
    "error": 0
}
```

### POST /agent/account

Account management operations for agents.

**Request Body:**
```json
{
    "subCommand": "create_access_code",
    "accountName": "user@example.com",
    "accessCode": "ABC123",
    "app": "Andruav",
    "version": "4.00.00",
    "extra": {}
}
```

**Sub-commands:**
- `create_access_code` - Create new access code
- `regenerate_access_code` - Regenerate existing access code
- `get_account_name` - Get account name by access code

**Response:**
```json
{
    "command": "account_management",
    "subCommand": "create_access_code",
    "error": 0,
    "AccessCode": "NEW_CODE"
}
```

### POST /agent/hardware

Hardware verification operations.

**Request Body:**
```json
{
    "subCommand": "verify_hardware_by_id",
    "sessionID": "session_id",
    "hardwareID": "HW123456",
    "hardwareType": "Pixhawk"
}
```

**Response:**
```json
{
    "command": "agent_hardware_management",
    "error": 0
}
```

## Web Endpoints

Web endpoints are used by GCS (Ground Control Station) clients.

### POST /web/login

GCS login request.

**Request Body:**
```json
{
    "accountName": "user@example.com",
    "accessCode": "ABC123",
    "actorType": "g",
    "group": "group_id",
    "app": "Andruav",
    "version": "4.00.00",
    "extra": {}
}
```

**Response:**
```json
{
    "command": "web_login",
    "sid": "encrypted_session_id",
    "serverIP": "127.0.0.1",
    "serverPort": 9966,
    "error": 0
}
```

### POST /web/account

Account management operations for web clients.

**Request Body:**
```json
{
    "subCommand": "create_access_code",
    "accountName": "user@example.com",
    "permission": "0xffffffff",
    "accessCode": "ABC123",
    "sessionID": "session_id"
}
```

**Response:**
```json
{
    "command": "account_management",
    "subCommand": "create_access_code",
    "error": 0,
    "AccessCode": "NEW_CODE"
}
```

### POST /web/logout

Logout and invalidate session.

**Request Body:**
```json
{
    "sessionID": "session_id"
}
```

**Response:**
```json
{
    "error": 0
}
```

## Error Codes

| Error Code | Constant | Description |
|------------|----------|-------------|
| 0 | `CONST_ERROR_NON` | Success |
| 1 | `CONST_ERROR_INVALID_DATA` | Invalid input data |
| 2 | `CONST_ERROR_ACCOUNT_NOT_FOUND` | Account not found |
| 3 | `CONST_ERROR_DATA_DATABASE_ERROR` | Database error |
| 5 | `CONST_ERROR_SERVER_NOT_AVAILABLE` | No communication server available |
| 6 | `CONST_ERROR_NO_PERMISSION` | Insufficient permissions |
| 7 | `CONST_ERROR_SESSION_NOT_FOUND` | Invalid session ID (relogin required) |
| 8 | `CONST_ERROR_HARDWARE_NOT_FOUND` | Hardware not found |
| 9 | `CONST_ERROR_ACCOUNT_DISABLED` | Account is disabled |
| 10 | `CONST_ERROR_NOT_FOUND` | Resource not found |
| 999 | `CONST_ERROR_UNKNOWN` | Unknown error |

## Response Format

All API responses follow this format:

```json
{
    "error": 0,
    "errorMessage": "Optional error message",
    "command": "command_name",
    "subCommand": "sub_command_name",
    "data": {}
}
```

## Security Features

### Admin Endpoints
- Session-based authentication
- CSRF protection on all forms
- Rate limiting on login (5 attempts per 15 minutes)
- Secure cookie configuration (httpOnly, secure)
- 2-hour session expiration

### Agent/Web Endpoints
- Input validation on all parameters
- Version checking for client compatibility
- Permission validation for operations
- Session ID validation for logout

## Rate Limiting

Admin login endpoint is rate-limited to prevent brute force attacks:
- Window: 15 minutes
- Max attempts: 5

## CSRF Protection

All admin forms use CSRF tokens. Include the CSRF token in your requests:

```javascript
// From rendered form
const csrfToken = document.querySelector('input[name="_csrf"]').value;

// Include in POST request
fetch('/admin/login', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
    },
    body: JSON.stringify({ username, password })
});
```

## Related Documentation

- [Authentication Flow](AuthenticationFlow.md)
- [Database Schema](DatabaseSchema.md)
- [Configuration](Configuration.md)
- [S2S Authentication](S2SAuthentication.md) - Server-to-server authentication guide
- [Architecture](Architecture.md) - DroneEngage system architecture
