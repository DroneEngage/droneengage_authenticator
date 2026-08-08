# Architecture

This document provides an overview of the DroneEngage system architecture and how the Authentication Server fits into the overall ecosystem.

## System Overview

DroneEngage is a distributed UAV (drone) management system composed of multiple servers that work together to provide authentication, communication, and data storage for ground control stations (GCS) and drone agents.

```
                    ┌─────────────────────────────────┐
                    │     Authentication Server        │
                    │   (andruav_authenticator)        │
                    │                                  │
                    │  - User login & session mgmt     │
                    │  - Access code management        │
                    │  - Comm server assignment        │
                    │  - Admin web interface           │
                    └──────────────┬───────────────────┘
                                   │ S2S WebSocket
                                   │ (Ed25519 auth)
                    ┌──────────────┴───────────────────┐
                    │     Communication Server          │
                    │   (andruav_server)                │
                    │                                   │
                    │  - Real-time message routing      │
                    │  - GCS ↔ Agent relay              │
                    │  - Parent/child server mesh       │
                    │  - Storage proxy                  │
                    └──┬────────────┬────────────┬──────┘
                       │            │            │
                  ┌─────▼──┐   ┌────▼───┐   ┌────▼────┐
                  │  GCS   │   │ Agent  │   │ Storage │
                  │ (Web)  │   │ (Drone)│   │ Server  │
                  └────────┘   └────────┘   └─────────┘
```

## Components

### Authentication Server (`andruav_authenticator`)

The central authority for user identity and session management.

**Responsibilities:**
- User authentication (login/logout) for GCS and Agent clients
- Access code creation and management
- Session ID generation and tracking
- Communication server selection and assignment
- Hardware ID verification for agent devices
- Admin web interface for management

**Key files:**
| File | Purpose |
|------|---------|
| `src/server.js` | Entry point — starts API server and admin views server |
| `src/auth_server/js_auth_server.js` | Main authentication orchestration |
| `src/auth_server/js_session_manager.js` | Session and login card management |
| `src/auth_server/js_account_manager.js` | Account and access code operations |
| `src/auth_server/js_comm_server_manager.js` | Comm server selection and monitoring |
| `src/auth_server/js_s2s_auth.js` | S2S Ed25519 authentication |
| `src/routes/js_router_admin.js` | Admin web routes (dashboard, users, terminal, wiki) |
| `src/routes/js_router_web.js` | GCS (web client) API routes |
| `src/routes/js_router_agent.js` | Agent (drone) API routes |

**Ports:**
| Port | Purpose | Config |
|------|---------|--------|
| 19408 | API server (agent/web endpoints) | `server_port` |
| 8089 | Admin web interface | `webadmin_port` |
| 19001 | S2S WebSocket (comm servers connect here) | `s2s_ws_listening_port` |

### Communication Server (`andruav_server`)

The real-time message relay between GCS clients and drone agents.

**Responsibilities:**
- WebSocket message routing between connected clients
- Group-based and individual message delivery
- Parent/child server mesh for horizontal scaling
- Storage server proxy (forwards task/mission operations)
- S2S authentication (connects to auth server, accepts from storage)

**Key concepts:**
- **Super Server (Parent)**: Accepts connections from child comm servers for message relay across servers
- **Child Server**: Connects to a parent server to relay messages
- **Loop prevention**: Uses `_path` array tracking to prevent infinite message loops in the mesh

### Storage Server (`droneengage_storage_server`)

Persistent storage for tasks and missions.

**Responsibilities:**
- Task storage and retrieval (message types 9001-9004)
- Mission storage and retrieval (message types 9010-9012)
- Offline message queueing per unit
- S2S authentication (accepts connections from comm servers)

**Key features:**
- SQLite database with WAL mode
- Per-unit offline queue with priority ordering
- Upsert pattern with automatic version increment
- Graceful shutdown handling

## Authentication Flow

```
GCS / Agent
    │
    ├── POST /web/login or POST /agent/login
    │
    ▼
Auth Server
    │
    ├── Validate credentials (access code + account name)
    ├── Create session ID
    ├── Select available comm server
    ├── Request login on comm server (via S2S WebSocket)
    │
    ▼
Response to client
    │
    ├── session ID (encrypted)
    ├── comm server IP + port
    │
    ▼
Client connects to Comm Server
    │
    ├── Uses session ID for authentication
    ├── Sends/receives real-time messages
    │
    ▼
Comm Server
    │
    ├── Routes messages between GCS and Agents
    ├── Forwards storage operations to Storage Server
    ├── Relays messages to parent/child servers (if mesh enabled)
```

See [Authentication Flow](AuthenticationFlow.md) for detailed flow diagrams.

## S2S Authentication

All server-to-server WebSocket connections use Ed25519 challenge-response authentication:

| Connection | Accepting Server | Connecting Server |
|------------|-----------------|-------------------|
| Auth ⟷ Comm | Auth Server | Comm Server |
| Comm ⟷ Storage | Storage Server | Comm Server |
| Parent ⟷ Child Comm | Parent Comm Server | Child Comm Server |

Each server has its own unique key pair. The accepting server holds public keys of all trusted connecting servers. See [S2S Authentication](S2SAuthentication.md) for details.

## Storage Modes

The auth server supports three account storage modes:

| Mode | Config Value | Description | Use Case |
|------|-------------|-------------|----------|
| Single | `single` | One hardcoded account | Testing/air-gap |
| File | `file` | JSON file (LowDB) | Small deployments |
| Database | `db` | SQLite database | Production, multi-user |

See [Database Schema](DatabaseSchema.md) for schema details.

## Admin Web Interface

The admin interface runs on a separate port from the API server and provides:

- **Dashboard**: System statistics (users, servers, connections)
- **User Management**: CRUD operations (file mode) or Teams & Logins (db mode)
- **Server Status**: Real-time comm server monitoring
- **Web Terminal**: Interactive shell access (PTY over WebSocket)
- **Wiki / Help**: Built-in documentation browser

See [Admin Web Interface](AdminWebInterface.md) for details.

## Security Layers

```
┌──────────────────────────────────────────────────┐
│              Network / Firewall                   │
├──────────────────────────────────────────────────┤
│              SSL / TLS                            │
│   (enable_SSL — transport encryption)            │
├──────────────────────────────────────────────────┤
│              S2S Auth (Ed25519)                   │
│   (s2s_auth_enabled — server identity)           │
├──────────────────────────────────────────────────┤
│              Admin Auth (session + CSRF)          │
│   (username/password + session secret)           │
├──────────────────────────────────────────────────┤
│              GUID Gate (optional)                 │
│   (servers_admin_url_guid — hidden admin URL)    │
└──────────────────────────────────────────────────┘
```

## Related Documentation

- [Configuration](Configuration.md) - Complete server configuration reference
- [Authentication Flow](AuthenticationFlow.md) - How authentication works
- [Admin Web Interface](AdminWebInterface.md) - Admin panel features
- [API Endpoints](APIEndpoints.md) - Public API reference
- [Database Schema](DatabaseSchema.md) - Database structure for storage modes
- [S2S Authentication](S2SAuthentication.md) - Server-to-server authentication guide
