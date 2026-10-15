#!/usr/bin/env node
"use strict";
/**
 * reset_access.js — last-resort account credential reset.
 *
 * Run locally on the authenticator host:
 *
 *     node tools/reset_access.js <account-name>
 *
 * Rotates the account's access code (preserving its permission and IsAdmin
 * flag), issues a fresh one-time recovery code, and prints both. This is
 * the recovery path for an owner who has no live session, no current
 * access code, and no recovery code — shell access to the server is the
 * out-of-band channel that replaces email/OTP on this deployment.
 *
 * IMPORTANT — file mode (account_storage_type = "file"):
 * The auth server loads the users file into memory once at startup and
 * rewrites the whole file on every change, so a reset issued while the
 * server is running is silently lost (the server keeps checking logins
 * against its stale copy and overwrites this tool's write). You MUST stop
 * the auth server first (e.g. `pm2 stop` / `systemctl stop`), run this
 * tool, then start it again. The tool enforces this: it refuses to run
 * when it detects a live server — by probing the configured API port and
 * by scanning /proc for a server.js process running from this repository.
 *
 * db mode (SQLite) has no such restriction — the database handles
 * concurrent writers.
 *
 * Single-account mode is rejected (there is no account database — edit
 * single_account_access_code in server.config instead).
 */

const fs   = require('fs');
const net  = require('net');
const path = require('path');

global.Colors         = require("droneengage_server_common").helpers.colors.Colors;
global.c_CONSTANTS    = require("../src/js_constants");
global.m_serverconfig = require("../src/js_serverConfig.js");
global.m_serverconfig.init("server.config");

const v_database_manager = require("../src/auth_server/js_database_manager");
const v_account_manager  = require("../src/auth_server/js_account_manager");

const c_accountName = process.argv[2];
if (!c_accountName) {
    console.error("usage: node tools/reset_access.js <account-name>");
    process.exit(2);
}

const c_cfg = global.m_serverconfig.m_configuration;
const c_storageType = (c_cfg.account_storage_type || "").toLowerCase();

if (c_storageType === "single") {
    console.error("reset_access: single-account mode has no account database — edit single_account_access_code in server.config instead.");
    process.exit(1);
}
if ((c_storageType !== "file") && (c_storageType !== "db")) {
    console.error("reset_access: unsupported account_storage_type '" + c_cfg.account_storage_type + "'.");
    process.exit(1);
}

/**
 * Probes the configured API port — a listening socket means the auth server
 * (or something else bound to its port) is up. fn_alive / fn_dead are called
 * exactly once.
 */
function fn_probeApiPort(fn_alive, fn_dead) {
    const c_port = process.env.de_auth_server_port || c_cfg.server_port;
    const c_host = (c_cfg.server_ip && c_cfg.server_ip !== '0.0.0.0') ? c_cfg.server_ip : '127.0.0.1';
    if (c_port == null) {
        fn_dead();
        return;
    }

    const c_sock = new net.Socket();
    let c_done = false;
    const c_finish = function (p_alive) {
        if (c_done === true) return;
        c_done = true;
        c_sock.destroy();
        if (p_alive === true) { fn_alive(); } else { fn_dead(); }
    };
    c_sock.setTimeout(800);
    c_sock.once('connect', function () { c_finish(true); });
    c_sock.once('timeout', function () { c_finish(false); });
    c_sock.once('error',   function () { c_finish(false); });
    c_sock.connect(c_port, c_host);
}

/**
 * /proc fallback: finds server.js processes whose working directory is this
 * repository — catches a server that is starting up (not yet listening) or
 * was launched in a way the port probe cannot see. Linux-only; silently
 * returns an empty list elsewhere.
 */
function fn_scanProcForServer() {
    const c_repoRoot = path.resolve(__dirname, '..');
    const c_pids = [];
    let c_entries;
    try { c_entries = fs.readdirSync('/proc'); } catch (e) { return c_pids; }
    for (const c_ent of c_entries) {
        if (!/^\d+$/.test(c_ent) || Number(c_ent) === process.pid) continue;
        try {
            if (fs.readlinkSync('/proc/' + c_ent + '/cwd') !== c_repoRoot) continue;
            const c_cmdline = fs.readFileSync('/proc/' + c_ent + '/cmdline', 'utf8');
            if (c_cmdline.indexOf('server.js') === -1) continue;
            c_pids.push(Number(c_ent));
        } catch (e) { /* process exited or unreadable — ignore */ }
    }
    return c_pids;
}

function fn_refuseServerRunning(p_reason) {
    console.error("reset_access: the auth server appears to be running (" + p_reason + ").");
    console.error("In file mode the server keeps the user database in memory and would");
    console.error("overwrite this tool's change on its next write. Stop the auth server");
    console.error("first (e.g. `pm2 stop` / `systemctl stop`), re-run this tool, then start it.");
    process.exit(1);
}

function fn_runReset() {
    // Opens the configured storage backend: SQLite (db mode) or the lowdb
    // users file via global.db_users (file mode).
    v_database_manager.fn_initialize();

    const c_lookupPermission = function (fn_found, fn_failed) {
        if (c_storageType === "file") {
            const c_record = global.db_users.fn_get_record(c_accountName);
            if (c_record == null) {
                fn_failed("account not found: " + c_accountName);
                return;
            }
            fn_found(c_record.prm);
            return;
        }
        // db mode — fail closed: a missing login row or a storage error must
        // not be silently substituted with a default (full) permission.
        v_database_manager.fn_getAccountPermission(c_accountName, function (p_reply) {
            if (p_reply[global.c_CONSTANTS.CONST_ERROR.toString()] !== global.c_CONSTANTS.CONST_ERROR_NON) {
                fn_failed(p_reply[global.c_CONSTANTS.CONST_ERROR_MSG.toString()] || "account lookup failed");
                return;
            }
            fn_found(p_reply.m_permission);
        });
    };

    c_lookupPermission(function (p_permission) {
        v_account_manager.fn_regenerateAccessCode(c_accountName, p_permission, function (p_reply) {
            if (p_reply[global.c_CONSTANTS.CONST_ERROR] !== global.c_CONSTANTS.CONST_ERROR_NON) {
                console.error("reset_access: failed — " + (p_reply[global.c_CONSTANTS.CONST_ERROR_MSG] || JSON.stringify(p_reply)));
                process.exit(1);
            }
            console.log("Access code reset for account: " + c_accountName);
            console.log("  new access code   : " + p_reply[global.c_CONSTANTS.CONST_ACCESS_CODE_PARAMETER]);
            console.log("  new recovery code : " + p_reply[global.c_CONSTANTS.CONST_RECOVERY_CODE_PARAMETER]);
            console.log("Hand these to the account owner over a trusted channel.");
            console.log("The recovery code is shown once — the owner should store it safely.");
            process.exit(0);
        });
    }, function (p_message) {
        console.error("reset_access: " + p_message);
        process.exit(1);
    });
}

if (c_storageType === "file") {
    // Refuse while the auth server is up — see the header comment.
    fn_probeApiPort(function () {
        fn_refuseServerRunning("listening on the configured API port");
    }, function () {
        const c_pids = fn_scanProcForServer();
        if (c_pids.length > 0) {
            fn_refuseServerRunning("server.js process(es) " + c_pids.join(", ") + " running from this directory");
            return;
        }
        fn_runReset();
    });
}
else {
    fn_runReset();
}
