[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/DroneEngage/droneengage_authenticator)

# Andruav Authenticator

Andruav Authenticator is the authentication server responsible for registering users and vehicles and assigning them to [communication servers](https://github.com/DroneEngage/droneengage_server).

[Andruav and Drone-Engage](https://cloud.ardupilot.org).

## Architecture Overview

The authenticator server provides:
- User and vehicle registration
- Authentication token generation
- Communication server assignment
- Server-to-Server (S2S) authentication for secure connections
- Admin web interface for management

### Project Structure

The server is written in Rust (it was ported from Node.js; the API,
replies, pages and configuration are unchanged — see
[Differences from the Node.js server](#differences-from-the-nodejs-server)).

```
andruav_authenticator/
├── server.config          # Server configuration (JSON with comments)
├── Cargo.toml
├── src/
│   ├── main.rs            # andruavauth: the server binary
│   ├── cli.rs             # arguments, banner, startup of the three listeners
│   ├── auth.rs            # login / account / hardware / logout operations
│   ├── accounts.rs        # account store operations (file + SQLite) and team administration
│   ├── sessions.rs        # login cards
│   ├── comm.rs            # comm server list, selection, login requests
│   ├── s2s.rs             # the S2S WebSocket listener (Ed25519 handshake)
│   ├── filedb.rs          # file (JSON) account store
│   ├── sqldb.rs           # SQLite access
│   ├── altcha.rs          # proof-of-work captcha
│   ├── validator.rs, perm.rs, constants.rs, config.rs, jsv.rs
│   ├── web/               # HTTP servers, API + agent routes, admin router, terminal, wiki
│   └── bin/               # reset_access, migrate_file_db
├── views/                 # Admin page templates (Jinja syntax)
├── public/                # Static assets
├── database/              # SQL migrations and the database tools' README
├── ssl_local/             # SSL certificates & S2S keys
├── scripts/               # S2S key generation, release build
├── tests/                 # Integration tests (cargo test)
└── wiki/                  # Documentation (also served at /admin/wiki)
```

Shared code (configuration loading, `$$HASH$$` handling, password hashing,
S2S helpers, Express-compatible sessions/CSRF/rate limits) comes from the
`droneengage_server_common` crate.

The following diagram shows the main function of this module:

[![Authentication Sequence Diagram](https://github.com/DroneEngage/droneegnage_authenticator/blob/master/resources/seq_diagram_authentication.png?raw=true)](https://github.com/DroneEngage/droneegnage_authenticator/blob/master/resources/seq_diagram_authentication.png?raw=true)

## Installation

### Prerequisites

- Rust (stable, via [rustup](https://rustup.rs)) to build; the binary has no runtime dependencies (SQLite is bundled)
- Git access to `DroneEngage/droneengage_server_common` (a Cargo git dependency)
- OpenSSL (for SSL certificates)

### Setup

```bash
# Clone the repository
git clone https://github.com/DroneEngage/droneengage_authenticator.git
cd andruav_authenticator

# Build (the binaries are in target/release)
cargo build --release

# Copy configuration
cp server.config server.config.local
# Edit server.config.local with your settings

# Generate SSL certificates (if needed)
mkdir -p ssl
openssl req -x509 -newkey rsa:4096 -keyout ssl/domain.key -out ssl/domain.crt -days 365 -nodes
```

## Configuration

The server is configured via `server.config` (JSON format). Key settings:

### Server Settings

```json
{
    "server_id": "AndruavAuth",
    "server_ip": "0.0.0.0",
    "server_port": 19408,
    "health_utl": "/h"
}
```

### Account Storage

Three storage modes available:
- `single`: Single account mode (default, for testing)
- `file`: JSON file storage
- `db`: SQLite database storage

Single-account settings:
```json
{
    "account_storage_type": "single",
    "single_account_user_name": "single@airgap.droneengage.com",
    "single_account_access_code": "test"
}
```

File-based settings:
```json
{
    "account_storage_type": "file",
    "file_db": "./file_db.json"
}
```

Database mode uses the bundled SQLite database:
```json
{
    "account_storage_type": "db",
    "dbdatabase": "database/andruav.db"
}
```

### S2S Authentication

Server-to-Server authentication using Ed25519 keys:

```json
{
    "s2s_ws_listening_ip": "127.0.0.1",
    "s2s_ws_listening_port": "19001",
    "s2s_auth_enabled": false,
    "s2s_trusted_server_keys": {
        "DE_CommSrv": "./ssl_local/DE_ServerComm_public.pem"
    }
}
```

See [wiki/S2SAuthentication.md](wiki/S2SAuthentication.md) for detailed setup.

### SSL/TLS

```json
{
    "enable_SSL": true,
    "ssl_key_file": "./ssl_local/ssl_airgap/domain.key",
    "ssl_cert_file": "./ssl_local/ssl_airgap/domain.crt"
}
```

### Admin Interface

```json
{
    "webadmin_enable": true,
    "admin_username": "admin",
    "admin_password": "$$HASH$$('admin123')",
    "session_secret": "change-this-secret-in-production",
    "webadmin_port": 8089,
    "webadmin_listening_ip": "0.0.0.0"
}
```

> **Password hashing:** The `$$HASH$$('plaintext')` directive is automatically replaced with a bcrypt hash on first startup and persisted back to the config file. See [wiki/Configuration.md](wiki/Configuration.md#sensitive-value-hashing) for details. Plaintext passwords are still accepted as a fallback (a warning is logged).

## Running the Server

Run the server from the repository directory (configuration, `views/`,
`public/`, `wiki/` and relative paths in the configuration are resolved
against the current directory):

```bash
./target/release/andruavauth                       # server.config
./target/release/andruavauth --config=my.config    # another configuration file
```

`-h` prints the help and `-v` the version. `scripts/build.sh` builds a
release and copies the binaries and runtime files into `build/`.

### Tools

```bash
# last-resort access code reset for an account (stop the server first in file mode)
./target/release/reset_access <account-name>

# build the SQLite account database from a file-mode JSON db and/or CSV files
./target/release/migrate_file_db [json_db_file] [--csv-dir <dir>] [--output <sqlite_file>]
```

See [database/README.md](database/README.md) for the migration tool.

## API Endpoints

### Authentication Endpoints

- `POST /api/login` - User login
- `POST /api/register` - User registration
- `POST /api/logout` - User logout
- `GET /api/verify` - Token verification

### Communication Server Endpoints

- `POST /api/s2s/register` - Register communication server
- `GET /api/s2s/servers` - List registered servers

### Admin Endpoints

- `GET /admin` - Admin dashboard
- `GET /admin/servers` - Manage communication servers and view storage connection status
- `GET /admin/users` - Manage users
- `GET /admin/api/servers` - Get communication server status including storage connection

See [wiki/APIEndpoints.md](wiki/APIEndpoints.md) for detailed API documentation.

## Database Schema

### Users Table (MySQL mode)

```sql
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    access_code VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Communication Servers Table

```sql
CREATE TABLE comm_servers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    server_id VARCHAR(255) UNIQUE NOT NULL,
    ip_address VARCHAR(255) NOT NULL,
    port INT NOT NULL,
    public_key TEXT,
    registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

See [wiki/DatabaseSchema.md](wiki/DatabaseSchema.md) for complete schema.

## Testing

```bash
cargo test                      # unit and integration tests
cargo test --test web_app       # one integration test file
cargo fmt --check && cargo clippy --all-targets -- -D warnings
```

## S2S Key Generation

Generate Ed25519 keys for server-to-server authentication:

```bash
cd scripts
./gen_s2s_keys.sh <server_id>
```

This creates:
- `<server_id>_private.pem` - Private key (keep secret)
- `<server_id>_public.pem` - Public key (share with authenticator)

See [wiki/S2SAuthentication.md](wiki/S2SAuthentication.md) for complete guide.

## Security Best Practices

- Change default admin credentials in production
- Use the `$$HASH$$('password')` directive for `admin_password` so it is stored as a bcrypt hash instead of plaintext (see [wiki/Configuration.md](wiki/Configuration.md#sensitive-value-hashing))
- Use strong `session_secret` in production
- Enable SSL/TLS for all connections
- Restrict file permissions on private keys (0600)
- Use environment variables for sensitive data
- Keep dependencies updated
- Enable rate limiting for API endpoints

## Troubleshooting

### Connection Refused
- Check server is running: `./target/release/andruavauth`
- Verify port is not in use
- Check firewall settings

### S2S Authentication Fails
- Verify public keys are in `ssl/` directory
- Check `s2s_trusted_server_keys` configuration
- Ensure server IDs match key filenames

### Database Connection Issues
- Verify SQLite database file is accessible
- Check `dbdatabase` path in config
- Ensure database directory exists and is writable

## Differences from the Node.js server

The Rust server answers like the Node.js one: the same endpoints, JSON
replies (key order included), status codes, headers (helmet 3 with its
per-browser CSP header names, CORS), cookies, rate limits, admin pages and
console messages. Where it differs:

- The default error page (a malformed JSON body, a bad route parameter, a
  missing wiki image) shows the error message without the Node.js stack
  trace, and JSON parse errors are worded by the Rust JSON parser.
- Static files ignore Range requests (the whole file is sent).
- Wiki pages are parsed by pulldown-cmark and written in marked's HTML
  format; Markdown the two parsers read differently can render differently.
  A wiki page name is resolved strictly inside `wiki/`.
- A request whose reply the Node.js server would send twice (an agent login
  answered by the comm server with an error, then timed out) gets one reply.
- A plain HTTP request on a TLS port gets a TLS alert instead of a silent close.

## Documentation

- [Authentication Flow](wiki/AuthenticationFlow.md)
- [Database Schema](wiki/DatabaseSchema.md)
- [API Endpoints](wiki/APIEndpoints.md)
- [Configuration](wiki/Configuration.md)
- [S2S Authentication](wiki/S2SAuthentication.md)

## Contributing

Contributions are welcome! Please read the contributing guidelines before submitting PRs.


## Support

For support and documentation, please refer to [Cloud.Ardupilot.org](https://cloud.ardupilot.org).

[![Ardupilot Cloud EcoSystem](https://cloud.ardupilot.org/_static/ardupilot_logo.png)](https://cloud.ardupilot.org) **Drone Engage** is part of Ardupilot Cloud Eco System



