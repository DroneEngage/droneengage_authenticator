# AGENTS.md — droneengage_authenticator

Andruav/DroneEngage authentication server (binary `andruavauth`).
Registration, tokens, comm-server assignment, S2S (Ed25519) handshake,
admin web UI. **Rust (tokio)** — ported from Node.js (old code on
`pr_nodejs_last_version`).

## Quickstart

    cargo build --release     # -> target/release/andruavauth
    cargo test                # unit + integration tests

## Index — `.agents/wiki/`

| File | What it covers |
|---|---|
| [`agents_overview.md`](.agents/wiki/agents_overview.md) | run-from-repo-root rule, server.config + .local, $$HASH$$, source layout |

See `../../AGENTS.md` for the workspace and shared server conventions.
