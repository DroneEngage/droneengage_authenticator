"use strict";

/**
 * Tests for CONST_CMD_VERIFY_TEAM_USER ('vtu') — the lightweight
 * credential check used by the login-QR flow.  It must:
 *  - return ok only when the typed access code matches the stored hash,
 *  - stay scoped to the caller's team,
 *  - require an admin session,
 *  - never return the stored code/hash.
 */

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const { setupTestGlobals } = require("./test_helpers");

setupTestGlobals();

const dbUsers = require("../src/database/db_users");
const sessionManager = require("../src/auth_server/js_session_manager");
const accountManager = require("../src/auth_server/js_account_manager");
const authServer = require("../src/auth_server/js_auth_server");
const c_CONSTANTS = require("../src/js_constants");
const C = c_CONSTANTS;

const TEST_DB = path.join(__dirname, "fixtures", "db_team_verify.test.db");

function replyError(reply) {
    return reply[C.CONST_ERROR];
}

/**
 * Create a team-admin account via the web CREATE path (sets isadmin=true,
 * unlike fn_createAccessCode) and resolve with the plaintext access code.
 */
function createAdminAccount(accountName) {
    return new Promise((resolve, reject) => {
        authServer.fn_accountOperation(
            C.CONST_CMD_CREATE_ACCESSCODE,
            accountName,
            "0xffffffff",
            null,
            (reply) => {
                if (replyError(reply) !== C.CONST_ERROR_NON) {
                    reject(new Error("setup create admin failed"));
                    return;
                }
                resolve(reply[C.CONST_ACCESS_CODE_PARAMETER]);
            },
            () => reject(new Error("fn_error invoked")),
            null
        );
    });
}

function loginSession(accountName, accessCode) {
    return new Promise((resolve, reject) => {
        sessionManager.fn_createLoginCard(
            accountName,
            accessCode,
            "g",
            "testgroup",
            (reply) => {
                if (replyError(reply) !== C.CONST_ERROR_NON) {
                    reject(new Error("login failed in test setup"));
                    return;
                }
                resolve(reply.m_session_id);
            }
        );
    });
}

/**
 * Team-admin call through the auth gate (mirrors what /w/am sends):
 * session-authenticated, params via targetLoginName/accessCode/isAdmin.
 */
function teamOp(subCommand, sessionID, params) {
    return new Promise((resolve, reject) => {
        authServer.fn_accountOperation(
            subCommand,
            params.targetLoginName || null,   // accountName (unused by team cmds)
            params.permission || "",
            params.accessCode != null ? params.accessCode : null,
            (reply) => resolve(reply),
            () => reject(new Error("fn_error invoked")),
            sessionID,
            params.targetLoginName,
            params.isAdmin
        );
    });
}

describe("vtu — verify team user access code (file mode)", () => {
    let adminSession;
    let memberCode;

    before(async () => {
        try { fs.unlinkSync(TEST_DB); } catch (e) { /* ok */ }
        global.m_serverconfig.m_configuration.account_storage_type = "file";
        global.m_serverconfig.m_configuration.file_db = TEST_DB;
        global.db_users = new dbUsers.db_user(TEST_DB);

        // Team A: admin account + one member login
        const adminCode = await createAdminAccount("vtu_admin_a@x.com");
        adminSession = await loginSession("vtu_admin_a@x.com", adminCode);

        const add = await teamOp(C.CONST_CMD_ADD_TEAM_USER, adminSession, {
            targetLoginName: "vtu_member_a@x.com",
            permission: "0xffffffff",
            accessCode: "membercodeA1",
            isAdmin: false,
        });
        assert.equal(replyError(add), C.CONST_ERROR_NON, "setup add member should succeed");
        memberCode = "membercodeA1";

        // Team B: a second, unrelated admin account
        const adminCodeB = await createAdminAccount("vtu_admin_b@x.com");
        global._vtuSessionB = await loginSession("vtu_admin_b@x.com", adminCodeB);
    });

    it("correct access code verifies ok", async () => {
        const reply = await teamOp(C.CONST_CMD_VERIFY_TEAM_USER, adminSession, {
            targetLoginName: "vtu_member_a@x.com",
            accessCode: memberCode,
        });
        assert.equal(replyError(reply), C.CONST_ERROR_NON);
        assert.equal(reply[C.CONST_ACCESS_CODE_PARAMETER], undefined,
            "reply must not echo the access code");
        assert.equal(reply.m_data, undefined,
            "reply must not carry record data (no hash leak)");
    });

    it("wrong access code is rejected", async () => {
        const reply = await teamOp(C.CONST_CMD_VERIFY_TEAM_USER, adminSession, {
            targetLoginName: "vtu_member_a@x.com",
            accessCode: "wrongcode",
        });
        assert.notEqual(replyError(reply), C.CONST_ERROR_NON);
    });

    it("missing access code is rejected", async () => {
        const reply = await teamOp(C.CONST_CMD_VERIFY_TEAM_USER, adminSession, {
            targetLoginName: "vtu_member_a@x.com",
        });
        assert.equal(replyError(reply), C.CONST_ERROR_INVALID_DATA);
    });

    it("unknown login name is rejected", async () => {
        const reply = await teamOp(C.CONST_CMD_VERIFY_TEAM_USER, adminSession, {
            targetLoginName: "vtu_nobody@x.com",
            accessCode: memberCode,
        });
        assert.notEqual(replyError(reply), C.CONST_ERROR_NON);
    });

    it("cannot verify a login belonging to another team", async () => {
        const reply = await teamOp(C.CONST_CMD_VERIFY_TEAM_USER, global._vtuSessionB, {
            targetLoginName: "vtu_member_a@x.com",
            accessCode: memberCode,
        });
        assert.notEqual(replyError(reply), C.CONST_ERROR_NON,
            "a correct code for a foreign team's login must not verify");
    });

    it("non-admin caller is rejected", async () => {
        const memberSession = await loginSession("vtu_member_a@x.com", memberCode);
        const reply = await teamOp(C.CONST_CMD_VERIFY_TEAM_USER, memberSession, {
            targetLoginName: "vtu_member_a@x.com",
            accessCode: memberCode,
        });
        assert.equal(replyError(reply), C.CONST_ERROR_NO_PERMISSION);
    });

    it("no session is rejected", async () => {
        const reply = await teamOp(C.CONST_CMD_VERIFY_TEAM_USER, null, {
            targetLoginName: "vtu_member_a@x.com",
            accessCode: memberCode,
        });
        assert.equal(replyError(reply), C.CONST_ERROR_SESSION_NOT_FOUND);
    });
});
