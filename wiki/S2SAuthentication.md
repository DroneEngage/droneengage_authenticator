# S2S Authentication

This document describes the Server-to-Server (S2S) authentication mechanism used by the Andruav Authenticator server to verify connecting communication servers.

## Overview

The authenticator server accepts WebSocket connections from communication servers on the S2S channel (`s2s_ws_listening_ip`:`s2s_ws_listening_port`). To ensure only trusted comm servers can connect, the authenticator uses Ed25519 public-key cryptography for a challenge-response handshake.

The authenticator **only accepts** S2S connections — it does not initiate them. Therefore it only needs the **public keys** of trusted comm servers, not any private key of its own.

The implementation uses only Node.js built-in `crypto` — no third-party dependencies.

## Handshake Flow

```
  Authenticator (accepts)                Comm Server (connects)
  Holds: PUBLIC keys                     Holds: PRIVATE key
        │                                      │
        │  1. Comm server opens WebSocket       │
        │◄─────────────────────────────────────│
        │                                      │
        │  2. Auth sends nonce challenge        │
        │──────────────────────────────────────►│
        │  { s2s_auth: "challenge", nonce: ... }│
        │                                      │
        │  3. Comm signs nonce with private key │
        │◄──────────────────────────────────────│
        │  { s2s_auth: "response", sig: ..., id: "DE_CommSrv" }
        │                                      │
        │  4. Auth verifies signature           │
        │     using comm's public key           │
        │                                      │
        │  5. Auth success or connection close  │
        │──────────────────────────────────────►│
        │                                      │
```

### Step-by-step

1. **Connection:** The comm server opens a WebSocket connection to the authenticator's S2S listener.
2. **Challenge:** The authenticator generates a 32-byte random nonce (hex-encoded) and sends it as a challenge.
3. **Response:** The comm server signs the nonce with its Ed25519 private key and sends back the base64 signature along with its server ID.
4. **Verification:** The authenticator looks up the comm server's public key by server ID from `s2s_trusted_server_keys` and verifies the signature.
5. **Result:** If valid, the connection is marked authenticated. If invalid, the connection is terminated.

## Timeout

The handshake must complete within 8 seconds. If the comm server does not respond in time, the authenticator closes the connection.

## Configuration

### Authenticator (Accepting Side)

The authenticator needs the **public keys** of all trusted comm servers:

```json
{
    "s2s_auth_enabled": true,
    "s2s_trusted_server_keys": {
        "DE_CommSrv": "./ssl_local/DE_ServerComm_public.pem",
        "DE_CommSrv2": "./ssl_local/DE_CommSrv2_public.pem"
    }
}
```

| Config Key | Description |
|------------|-------------|
| `s2s_auth_enabled` | Set to `true` to require S2S auth on incoming connections |
| `s2s_trusted_server_keys` | Map of server ID → public key PEM file path |

### Comm Server (Connecting Side)

The comm server needs its own **private key** to sign challenges:

```json
{
    "s2s_auth_enabled": true,
    "s2s_my_private_key": "./ssl_local/DE_ServerComm_private.pem"
}
```

The comm server's `server_id` must match a key in the authenticator's `s2s_trusted_server_keys`.

## Key Generation

Use the provided script to generate an Ed25519 key pair:

```bash
node scripts/gen_s2s_keys.js DE_CommSrv
```

This generates two files:

| File | Type | Distribution |
|------|------|-------------|
| `DE_CommSrv_private.pem` | Private key | Copy to the comm server's `ssl_local/` directory. Keep secret. |
| `DE_CommSrv_public.pem` | Public key | Copy to the authenticator's `ssl_local/` directory. |

The private key file is written with restrictive permissions (`0o600`).

### Key Distribution Workflow

1. Generate keys: `node scripts/gen_s2s_keys.js DE_CommSrv`
2. Copy `DE_CommSrv_private.pem` to the comm server.
3. Copy `DE_CommSrv_public.pem` to the authenticator.
4. Add to authenticator config:
   ```json
   "s2s_trusted_server_keys": {
       "DE_CommSrv": "./ssl_local/DE_CommSrv_public.pem"
   }
   ```
5. Add to comm server config:
   ```json
   "s2s_my_private_key": "./ssl_local/DE_CommSrv_private.pem"
   ```
6. Restart both servers.

## Per-Server Key Model

Each server has its own unique Ed25519 key pair. This provides better security than a shared key:

- **Compromise isolation**: If one server is compromised, the attacker cannot impersonate other servers
- **Server identity**: The authenticator can identify which server is connecting
- **Revocation**: Individual server keys can be revoked by removing the public key from the config

## Envelope Format

### Challenge (auth → comm)

```json
{
  "s2s_auth": "challenge",
  "nonce": "a1b2c3d4e5f6...64 hex chars"
}
```

### Response (comm → auth)

```json
{
  "s2s_auth": "response",
  "sig": "base64-encoded Ed25519 signature",
  "id": "DE_CommSrv"
}
```

## Disabling Authentication

When `s2s_auth_enabled` is `false`, the authenticator skips the challenge-response handshake and accepts all S2S connections without verification. This is suitable for:

- Air-gapped / isolated network environments
- Development and testing
- Environments where network-level security is sufficient

```json
"s2s_auth_enabled": false
```

## SSL vs S2S Auth

These are independent security layers:

| Layer | Config | Purpose |
|-------|--------|---------|
| SSL/TLS | `enable_SSL` | Transport encryption (encrypts the WebSocket channel) |
| S2S Auth | `s2s_auth_enabled` | Identity verification (proves the comm server is trusted) |

Both can be enabled independently. For maximum security, enable both. For air-gapped environments, SSL with self-signed certificates may be sufficient.

## Troubleshooting

### Connection Fails

**Check:**
- Key files exist at the configured paths
- File permissions are correct (private key should be 0600)
- `s2s_auth_enabled` is set to `true` in both configs
- The server ID sent during handshake matches a key in `s2s_trusted_server_keys`
- The public key on the authenticator matches the private key on the comm server

### "Invalid signature" Error

The signature verification failed. This usually means:
- The public key on the authenticator does not match the private key on the comm server
- Keys were regenerated but not redistributed

### "Unknown server_id" Error

The authenticator received a server ID that is not in its `s2s_trusted_server_keys` mapping. Add the server's public key to the config.

### Authentication Timeout

If the comm server does not respond to the challenge within 8 seconds, the connection remains unauthenticated. Check that:
- The comm server has the private key
- The server is not experiencing network delays

## Security Best Practices

- **Never commit private keys** to version control (add `*.pem` to `.gitignore`)
- **Restrict file permissions** — Private keys should be mode 0600
- **Use unique keys** — Each server must have its own key pair
- **Distribute keys securely** — Use out-of-band methods when possible
- **Regenerate keys periodically** — Re-run the script with the server ID to generate new keys
- **Revoke compromised keys** — Remove the public key from the authenticator's config

## Related Documentation

- [Configuration](Configuration.md) - Complete server configuration reference
- [Authentication Flow](AuthenticationFlow.md) - How user authentication works
- [Architecture](Architecture.md) - DroneEngage system architecture
