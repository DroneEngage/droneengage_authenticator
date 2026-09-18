# Changelog

Major changes to the DroneEngage Authenticator server, newest first.

## [7.6.8] - 2026-09-16

- Added QR-code login verification so users can confirm logins by scanning a code.
- Added controls to enable/disable logins and to block UDP proxy connections.

## [7.6.7] - 2026-09-15

- Admin dashboard now color-codes related rows: blue for users, green for UDP proxies.
- Fixed the LoginID shown for each connected unit.

## [7.6.6] - 2026-09-12

- Added a live-refresh toggle and cross-highlighting for the UDP proxy admin view.
- Fixed the admin view losing storage status and proxy data on refresh.
- Fixed regenerated access codes losing the IsAdmin flag; permissions are now stored consistently.

## [7.6.5] - 2026-09-08

- Added a view-mode permission (read-only GCS logins that can watch but not control).
- Added account-type login bits and message-category permission constants.
- Added team-scoped user administration through the WebClient.
- The admin dashboard now shows the authenticator server version.

## [7.6.0] - 2026-09-05

- Added an on-demand UDP proxy query for the admin dashboard.
- Added a `debug_logging` config flag to reduce routine log spam.
- Fixed a helmet/CSP crash on the `script-src-attr` directive.

## [7.5.0] - 2026-09-01

- Shared config loading and helpers moved to the `droneengage_server_common` npm package.
- Fixed CSP blocking inline event handlers.

## [7.4.x] - 2026-08

- Access codes are now stored hashed (bcrypt) instead of plain text.
- Added CSRF protection and session-security hardening to the admin interface.
- Admin user edit no longer shows the password hash; added a regenerate-access-code button.
- `session_secret` validation relaxed from a hard failure to a warning.

## [7.3.x] - 2026-08

- Removed the version parameter from agent login and account operations.

## [7.1.0 / 7.0.x] - 2026-08

- Added a web terminal with configurable security settings.
- Server and web-admin ports can now be overridden with environment variables.
- Project file structure reorganized.

## [6.1.x] - 2026-07

- Added Storage Server support: storage-type validation, conditional menus, and short status codes in the UI.
- Migrated the file-based database to SQLite with CSV import.
- Handle logout notifications from the communication server and clean up sessions.

## [5.x] - 2026-07 and earlier

- Added the web-based admin interface.
- Added single-account mode (no database required).
- Early releases: user accounts database, access-code authentication, and login permissions.
