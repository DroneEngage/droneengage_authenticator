# TASK-01 — Reduce auth server log spam

**Depends on:** nothing.
**Blocks:** nothing.
**Size:** small (~1-2 hours). **Risk:** low — only touches logging statements, no logic change.

## Goal

The auth server (`de_auth_2026`) generates excessive log output that caused
journald to accumulate **3.9 GB** of journals on the cloud.ardupilot.org VPS
(3.8 GB RAM). The log spam caused intermittent I/O + memory spikes that made
the server unresponsive (SSH itself was getting starved). Reduce the spam at
its source by (a) only logging storage-status changes and (b) gating debug
logging behind a config flag.

## Current state

### 1. Storage-status spam (main culprit)

`src/auth_server/js_comm_server_manager.js:375` logs the storage status on
**every** update, even when the status has not changed:

```js
// line ~353: overwrites unconditionally
m_communicationServersList[c_commServerGUID].m_server.m_storageStatus = {
    status: c_statusData.status,
    storage_host: c_statusData.storage_host,
    storage_port: c_statusData.storage_port,
    timestamp: c_statusData.timestamp,
    error: c_statusData.error || null
};

// line 375: logs EVERY time — even if status is unchanged
console.log (`[INFO] Comm server ${m_communicationServersList[c_commServerGUID].m_server.m_serverId} storage status: ${readableStatus}`);
```

Observed in production: 8 identical `CONNECTED` lines in a 20-line log
sample. The comm server polls repeatedly, so this fires on every poll.

### 2. Debug login-card logging (secondary)

`src/routes/js_router_agent.js` and `src/routes/js_router_web.js` log every
login card as JSON — debug logging left in production:

| File | Line | Statement |
|------|------|-----------|
| `js_router_agent.js` | 57 | `console.log("debug ... " + C.CONST_AGENT_LOGIN_COMMAND + " called")` |
| `js_router_agent.js` | 159 | `console.log("debug ... fn_newLoginCard: " + JSON.stringify(p_data))` |
| `js_router_agent.js` | 178 | `console.log("debug ... " + C.CONST_AGENT_ACCOUNT_MANAGMENT + " called")` |
| `js_router_agent.js` | 257 | `console.log("debug ... " + C.CONST_AGENT_HARDWARE_MANAGMENT + " called")` |
| `js_router_web.js` | 53 | `console.log("debug ... " + C.CONST_WEB_LOGIN_COMMAND + " called")` |
| `js_router_web.js` | 143 | `console.log("debug ... fn_newLoginCard: " + JSON.stringify(p_data))` |
| `js_router_web.js` | 160 | `console.log("debug ... " + C.CONST_ACCOUNT_MANAGMENT + " called")` |
| `js_router_web.js` | 217 | `console.log("debug ... " + C.CONST_WEB_LOGOUT_COMMAND + " called")` |

## Proposed changes

### Change 1 — Only log storage status on change

In `src/auth_server/js_comm_server_manager.js`, capture the previous status
before overwriting and only log when it differs:

```js
// Capture previous status before overwriting
const prevStatus = m_communicationServersList[c_commServerGUID].m_server.m_storageStatus
    ? m_communicationServersList[c_commServerGUID].m_server.m_storageStatus.status
    : null;

// Update storage status (unchanged)
m_communicationServersList[c_commServerGUID].m_server.m_storageStatus = {
    status: c_statusData.status,
    storage_host: c_statusData.storage_host,
    storage_port: c_statusData.storage_port,
    timestamp: c_statusData.timestamp,
    error: c_statusData.error || null
};

// ... statusMap unchanged ...

// Only log when status changes
if (prevStatus !== c_statusData.status) {
    console.log(`[INFO] Comm server ${m_communicationServersList[c_commServerGUID].m_server.m_serverId} storage status: ${readableStatus}`);
}
```

### Change 2 — Gate debug logging behind a config flag

Add a `DEBUG_LOGGING` flag (read from `server.config` / env var, default
`false` in production) and wrap the `debug ...` console.log calls in the two
router files:

```js
if (global.DEBUG_LOGGING) {
    console.log("debug ... fn_newLoginCard: " + JSON.stringify(p_data));
}
```

Alternatively, simply remove the `debug ...` lines if they are no longer
needed for development.

## Risk

- **Change 1:** No logic change — only suppresses duplicate log lines. The
  storage status is still updated and stored; it just isn't logged when
  unchanged. The "unknown comm server" warning (line 346) is unaffected.
- **Change 2:** Debug logging is informational only. Gating or removing it
  has no functional impact.

## Verification

1. After deploying, watch the auth log:
   `pm2 logs de_auth_2026 --lines 50 --nostream`
2. Confirm `storage status: CONNECTED` appears once (on connect) not
   repeatedly.
3. Confirm no `debug ... fn_newLoginCard` lines appear unless `DEBUG_LOGGING`
   is explicitly enabled.
4. Monitor journald size over a few days:
   `journalctl --disk-usage` — should stay well under 500M (the persistent
   limit set on cloud.ardupilot.org).

## Context — mitigations already in place

The following were applied on cloud.ardupilot.org as immediate mitigations
(this task addresses the root cause so they are not solely relied upon):

- journald vacuumed from 3.9 GB to ~487 MB; persistent `SystemMaxUse=500M`
  limit set via `/etc/systemd/journald.conf.d/size-limit.conf`.
- `max_memory_restart=300M` set on the `de_auth_2026` pm2 process so pm2
  auto-restarts it if it leaks past 300 MB instead of OOM-killing the VPS.
- Auth server restarted to reset accumulated memory.
