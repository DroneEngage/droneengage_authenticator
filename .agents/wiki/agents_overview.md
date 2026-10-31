# droneengage_authenticator — overview

Andruav/DroneEngage authentication server (binary `andruavauth`).
Registers users and vehicles, issues login tokens, assigns units to comm
servers, runs the S2S (Ed25519) handshake and serves the admin web UI.
**Rust (tokio)** — ported from Node.js; the API, replies, pages and
`server.config` format are unchanged. The old Node code is on branch
`pr_nodejs_last_version`. See `../../AGENTS.md` for the workspace
architecture and the `server.config` / `server.config.local` conventions
shared by all servers.

## Build / test / run

    cargo build --release     # -> target/release/andruavauth
    cargo test                # unit + integration tests (tests/)
    cargo test --test web_app # one integration test file

Run from the repo root — `server.config`, `ssl*/`, `database/`,
`public/` are resolved relative to the cwd. `../sh_start_servers.sh`
starts it in a gnome-terminal tab alongside the other servers.

## Config

`server.config` + `server.config.local` (git-ignored top-level overlay;
C-style comments allowed — leave them). `$$HASH$$('plaintext')`
directives become bcrypt via `droneengage_server_common::config_handler`.

## Source layout

`src/` — `main.rs` (the `andruavauth` binary), `cli.rs` (args, banner,
startup of the three listeners), `auth.rs` (login/account/logout),
`accounts.rs` (file + SQLite account store, team administration),
`sessions.rs` (login cards), `comm.rs` (comm-server list, selection,
login requests), `s2s.rs` (S2S WebSocket listener, Ed25519 handshake),
`filedb.rs`, `sqldb.rs`, `altcha.rs` (proof-of-work captcha),
`validator.rs`, `perm.rs`, `constants.rs`, `config.rs`, `jsv.rs`,
`web/` (HTTP servers, API + agent routes, admin router, terminal, wiki).
`tests/` — integration tests. `README.md` — full architecture docs.
