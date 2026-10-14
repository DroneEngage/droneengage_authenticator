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
 * Single-account mode is rejected (there is no account database — edit
 * single_account_access_code in server.config instead).
 */

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

// Opens the configured storage backend: SQLite (db mode) or the lowdb
// users file via global.db_users (file mode).
v_database_manager.fn_initialize();

const c_lookupPermission = function (fn_found, fn_missing) {
    if (c_storageType === "file") {
        const c_record = global.db_users.fn_get_record(c_accountName);
        if (c_record == null) {
            fn_missing();
            return;
        }
        fn_found(c_record.prm);
        return;
    }
    // db mode — fn_getAccountPermission returns a default when the account
    // is missing; a missing account is surfaced by the regenerate reply
    // (team lookup in fn_createSubLogin fails with ACCOUNT_NOT_FOUND).
    v_database_manager.fn_getAccountPermission(c_accountName, fn_found);
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
}, function () {
    console.error("reset_access: account not found: " + c_accountName);
    process.exit(1);
});
