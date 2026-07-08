# Andruav Authenticator

Andruav Authenticator is the authentication server responsible for registering users and vehicles and assigning them to [communication servers](https://github.com/HefnySco/andruav_server).

[Andruav and Drone-Engage](https://cloud.ardupilot.org).

## Architecture Overview

The authenticator server provides:
- User and vehicle registration
- Authentication token generation
- Communication server assignment
- Server-to-Server (S2S) authentication for secure connections
- Admin web interface for management

The following diagram shows the main function of this module:

[![Authentication Sequence Diagram](https://github.com/DroneEngage/droneegnage_authenticator/blob/master/resources/seq_diagram_authentication.png?raw=true)](https://github.com/DroneEngage/droneegnage_authenticator/blob/master/resources/seq_diagram_authentication.png?raw=true)

## Installation

### Prerequisites

- Node.js >= 18
- MySQL (if using database storage)
- OpenSSL (for SSL certificates)

### Setup

```bash
# Clone the repository
git clone https://github.com/HefnySco/andruav_authenticator.git
cd andruav_authenticator

# Install dependencies
npm install

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
- `single`: Single account mode (for testing)
- `file`: JSON file storage (default)
- `db`: MySQL database storage

```json
{
    "account_storage_type": "file",
    "db_users": "./db_users.db"
}
```

For database mode:
```json
{
    "account_storage_type": "db",
    "dbIP": "localhost",
    "dbuser": "USERNAME",
    "dbpassword": "PASSWORD",
    "dbdatabase": "andruav"
}
```

### S2S Authentication

Server-to-Server authentication using Ed25519 keys:

```json
{
    "s2s_ws_listening_ip": "127.0.0.1",
    "s2s_ws_listening_port": 19001,
    "s2s_auth_enabled": true,
    "s2s_trusted_server_keys": {
        "AndruavLap": "./ssl/AndruavLap_public.pem",
        "SuperServer": "./ssl/SuperServer_public.pem"
    }
}
```

See [wiki/S2SAuthentication.md](wiki/S2SAuthentication.md) for detailed setup.

### SSL/TLS

```json
{
    "enable_SSL": true,
    "ssl_key_file": "ssl/domain.key",
    "ssl_cert_file": "ssl/domain.crt"
}
```

### Admin Interface

```json
{
    "admin_username": "admin",
    "admin_password": "admin123",
    "session_secret": "change-this-secret-in-production",
    "webadmin_port": 8089
}
```

## Running the Server

### Development

```bash
npm start
```

### Production

```bash
# Using Docker
./dockercreate.sh
./dockerrun.sh

# Or directly
NODE_ENV=production npm start
```

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
- `GET /admin/servers` - Manage communication servers
- `GET /admin/users` - Manage users

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
# Run all tests
npm test

# Run specific test file
node --test test/unit/s2s_auth.test.js
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
- Use strong `session_secret` in production
- Enable SSL/TLS for all connections
- Restrict file permissions on private keys (0600)
- Use environment variables for sensitive data
- Keep dependencies updated
- Enable rate limiting for API endpoints

## Troubleshooting

### Connection Refused
- Check server is running: `npm start`
- Verify port is not in use
- Check firewall settings

### S2S Authentication Fails
- Verify public keys are in `ssl/` directory
- Check `s2s_trusted_server_keys` configuration
- Ensure server IDs match key filenames

### Database Connection Issues
- Verify MySQL is running
- Check database credentials in config
- Ensure database exists

## Documentation

- [Authentication Flow](wiki/AuthenticationFlow.md)
- [Database Schema](wiki/DatabaseSchema.md)
- [API Endpoints](wiki/APIEndpoints.md)
- [Configuration](wiki/Configuration.md)
- [S2S Authentication](wiki/S2SAuthentication.md)

## Contributing

Contributions are welcome! Please read the contributing guidelines before submitting PRs.

## License

[License information here]

## Support

For support and documentation, please refer to [Cloud.Ardupilot.org](https://cloud.ardupilot.org).

[![Ardupilot Cloud EcoSystem](https://cloud.ardupilot.org/_static/ardupilot_logo.png)](https://cloud.ardupilot.org) **Drone Engage** is part of Ardupilot Cloud Eco System


