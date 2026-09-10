"use strict";

const { describe, it, before, beforeEach } = require("node:test");
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

const TEST_DB = path.join(__dirname, "fixtures", "db_account_operation.test.db");
const C = c_CONSTANTS;

function replyError(reply) {
    return reply[C.CONST_ERROR];
}

/**
 * Create an account directly via the account manager (bypassing the auth
 * gate) and resolve with the plaintext access code. Used for test setup.
 */
function createAccountDirect(accountName, permission) {
    return new Promise((resolve) => {
        accountManager.fn_createAccessCode(accountName, permission, (reply) => {
            assert.equal(replyError(reply), C.CONST_ERROR_NON, "setup create should succeed");
            resolve(reply[C.CONST_ACCESS_CODE_PARAMETER]);
        });
    });
}

/**
 * Call fn_accountOperation and resolve with the reply.
 */
function accountOperation(subCommand, accountName, permission, accessCode, sessionID) {
    return new Promise((resolve, reject) => {
        authServer.fn_accountOperation(
            subCommand,
            accountName,
            permission != null ? permission : "",
            accessCode,   // pass null/undefined as-is; validator skips null
            (reply) => resolve(reply),
            () => reject(new Error("fn_error invoked")),
            sessionID
        );
    });
}

/**
 * Call fn_accountOperationFromAgent and resolve with the reply.
 */
function accountOperationFromAgent(subCommand, accountName, accessCode) {
    return new Promise((resolve, reject) => {
        authServer.fn_accountOperationFromAgent(
            subCommand,
            accountName,
            accessCode,   // pass null/undefined as-is
            "testapp",
            "testextra",
            (reply) => resolve(reply),
            () => reject(new Error("fn_error invoked"))
        );
    });
}

/**
 * Login via the session manager and resolve with { sessionID, loginCard }.
 */
function loginSession(accountName, accessCode, actorType) {
    return new Promise((resolve, reject) => {
        sessionManager.fn_createLoginCard(
            accountName,
            accessCode,
            actorType || "g",
            "testgroup",
            (reply) => {
                if (replyError(reply) !== C.CONST_ERROR_NON) {
                    reject(new Error("login failed in test setup"));
                    return;
                }
                resolve({ sessionID: reply.m_session_id, loginCard: reply });
            }
        );
    });
}


describe("js_account_operation — file mode", () => {
    let db;

    before(() => {
        try { fs.unlinkSync(TEST_DB); } catch (e) { /* ok */ }
        global.m_serverconfig.m_configuration.account_storage_type = "file";
        global.m_serverconfig.m_configuration.file_db = TEST_DB;
        db = new dbUsers.db_user(TEST_DB);
        global.db_users = db;
    });

    // Case 1: Create, no session, no permission requested → clamped default
    it("anonymous create clamps to safe default permission", async () => {
        const reply = await accountOperation(
            C.CONST_CMD_CREATE_ACCESSCODE,
            "op_create1@x.com",
            "",      // no permission requested
            null,    // no access code
            null     // no session
        );
        assert.equal(replyError(reply), C.CONST_ERROR_NON);
        const record = db.fn_get_record("op_create1@x.com");
        assert.ok(record, "record should exist");
        assert.equal(record.prm, C.CONST_DEFAULT_SELF_SERVICE_PERMISSION,
            "stored permission must be the safe default, not 0xffffffff");
        assert.notEqual(record.prm, "0xffffffff",
            "must not grant full control to anonymous self-registration");
    });

    // Case 2: Create, no session, permission=0xffffffff requested → still clamped
    it("anonymous create ignores requested 0xffffffff permission", async () => {
        const reply = await accountOperation(
            C.CONST_CMD_CREATE_ACCESSCODE,
            "op_create2@x.com",
            "0xffffffff",  // caller requests full control
            null,
            null
        );
        assert.equal(replyError(reply), C.CONST_ERROR_NON);
        const record = db.fn_get_record("op_create2@x.com");
        assert.equal(record.prm, C.CONST_DEFAULT_SELF_SERVICE_PERMISSION,
            "requested 0xffffffff must be ignored in favour of safe default");
    });

    // Case 3: Create, duplicate account name → rejected (regression)
    it("duplicate account name is rejected", async () => {
        await createAccountDirect("op_dup@x.com", "0x00001111");
        const reply = await accountOperation(
            C.CONST_CMD_CREATE_ACCESSCODE,
            "op_dup@x.com",
            "0x00001111",
            null,
            null
        );
        assert.notEqual(replyError(reply), C.CONST_ERROR_NON,
            "duplicate create must be rejected");
    });

    // Case 4: Regenerate, correct current AccessCode, no session → succeeds,
    // stored permission unchanged even if a different permission is requested
    it("regenerate with correct access code preserves existing permission", async () => {
        const accessCode = await createAccountDirect("op_regen4@x.com", "0x00001111");
        const reply = await accountOperation(
            C.CONST_CMD_REGENERATE_ACCESSCODE,
            "op_regen4@x.com",
            "0xffffffff",   // request full control — must be ignored
            accessCode,     // correct current access code
            null             // no session
        );
        assert.equal(replyError(reply), C.CONST_ERROR_NON, "regenerate should succeed");
        const newCode = reply[C.CONST_ACCESS_CODE_PARAMETER];
        assert.ok(newCode && newCode !== accessCode, "new access code should differ");

        const record = db.fn_get_record("op_regen4@x.com");
        assert.equal(record.prm, "0x00001111",
            "stored permission must be unchanged after regenerate");
    });

    // Case 5: Regenerate, wrong/missing AccessCode, no session → rejected,
    // and the target account's AccessCode + Permissions are provably unchanged
    it("regenerate with wrong access code is rejected and account unchanged", async () => {
        const accessCode = await createAccountDirect("op_regen5@x.com", "0x00001111");
        const recordBefore = db.fn_get_record("op_regen5@x.com");
        const storedHashBefore = recordBefore.AccessCode;
        const permBefore = recordBefore.prm;

        const reply = await accountOperation(
            C.CONST_CMD_REGENERATE_ACCESSCODE,
            "op_regen5@x.com",
            "0xffffffff",
            "wrongcode",     // wrong access code
            null
        );
        assert.equal(replyError(reply), C.CONST_ERROR_NO_PERMISSION,
            "must be rejected with permission error");

        const recordAfter = db.fn_get_record("op_regen5@x.com");
        assert.equal(recordAfter.AccessCode, storedHashBefore,
            "AccessCode hash must be unchanged after rejected regenerate");
        assert.equal(recordAfter.prm, permBefore,
            "Permissions must be unchanged after rejected regenerate");
    });

    it("regenerate with missing access code is rejected", async () => {
        await createAccountDirect("op_regen5b@x.com", "0x00001111");
        const reply = await accountOperation(
            C.CONST_CMD_REGENERATE_ACCESSCODE,
            "op_regen5b@x.com",
            "0xffffffff",
            null,   // missing access code
            null
        );
        assert.equal(replyError(reply), C.CONST_ERROR_NO_PERMISSION,
            "missing access code must be rejected");
    });

    // Case 6: Regenerate, valid session matching account → succeeds without AccessCode
    it("regenerate with matching session succeeds without access code", async () => {
        const accessCode = await createAccountDirect("op_regen6@x.com", "0xffffffff");
        const { sessionID } = await loginSession("op_regen6@x.com", accessCode);

        const reply = await accountOperation(
            C.CONST_CMD_REGENERATE_ACCESSCODE,
            "op_regen6@x.com",
            "0x00000001",   // request different permission — must be ignored
            null,            // no access code — session is the proof
            sessionID
        );
        assert.equal(replyError(reply), C.CONST_ERROR_NON,
            "session-based regenerate should succeed");
        const record = db.fn_get_record("op_regen6@x.com");
        assert.equal(record.prm, "0xffffffff",
            "permission must be preserved, not changed to requested value");
    });

    // Case 7: Regenerate, valid session for a DIFFERENT account → rejected
    it("regenerate with session for a different account is rejected", async () => {
        const accessCodeA = await createAccountDirect("op_acctA@x.com", "0x00001111");
        await createAccountDirect("op_acctB@x.com", "0x00001111");
        const { sessionID } = await loginSession("op_acctA@x.com", accessCodeA);

        const recordBefore = db.fn_get_record("op_acctB@x.com");
        const reply = await accountOperation(
            C.CONST_CMD_REGENERATE_ACCESSCODE,
            "op_acctB@x.com",   // target B
            "0xffffffff",
            null,
            sessionID           // session is for A
        );
        assert.equal(replyError(reply), C.CONST_ERROR_NO_PERMISSION,
            "cross-account session must be rejected");
        const recordAfter = db.fn_get_record("op_acctB@x.com");
        assert.equal(recordAfter.AccessCode, recordBefore.AccessCode,
            "target account must be unchanged after rejected cross-account regenerate");
    });

    // Case 10: GET_ACCOUNT_NAME unaffected (regression)
    it("getAccountName is unaffected by the fix", async () => {
        const accessCode = await createAccountDirect("op_getname@x.com", "0x00001111");
        const reply = await accountOperation(
            C.CONST_CMD_GET_ACCOUNT_NAME,
            "op_getname@x.com",
            "",
            accessCode,
            null
        );
        assert.equal(replyError(reply), C.CONST_ERROR_NON);
        assert.equal(reply[C.CONST_ACCOUNT_NAME_PARAMETER], "op_getname@x.com");
    });
});


describe("js_account_operation — agent path (file mode)", () => {
    let db;

    before(() => {
        try { fs.unlinkSync(TEST_DB); } catch (e) { /* ok */ }
        global.m_serverconfig.m_configuration.account_storage_type = "file";
        global.m_serverconfig.m_configuration.file_db = TEST_DB;
        db = new dbUsers.db_user(TEST_DB);
        global.db_users = db;
    });

    // Case 8a: agent create clamps to safe default (not 0xffffffff)
    it("agent create clamps permission to safe default", async () => {
        const reply = await accountOperationFromAgent(
            C.CONST_CMD_CREATE_ACCESSCODE,
            "agent_create@x.com",
            null
        );
        assert.equal(replyError(reply), C.CONST_ERROR_NON);
        const record = db.fn_get_record("agent_create@x.com");
        assert.equal(record.prm, C.CONST_DEFAULT_SELF_SERVICE_PERMISSION,
            "agent path must not grant 0xffffffff");
    });

    // Case 8b: agent regenerate with wrong access code is rejected
    it("agent regenerate with wrong access code is rejected", async () => {
        const accessCode = await createAccountDirect("agent_regen@x.com", "0x00001111");
        const recordBefore = db.fn_get_record("agent_regen@x.com");

        const reply = await accountOperationFromAgent(
            C.CONST_CMD_REGENERATE_ACCESSCODE,
            "agent_regen@x.com",
            "wrongcode"
        );
        assert.equal(replyError(reply), C.CONST_ERROR_NO_PERMISSION,
            "agent path must reject wrong access code, not default to full permission");

        const recordAfter = db.fn_get_record("agent_regen@x.com");
        assert.equal(recordAfter.AccessCode, recordBefore.AccessCode,
            "account must be unchanged after rejected agent regenerate");
    });

    // Case 8c: agent regenerate with correct access code succeeds and preserves permission
    it("agent regenerate with correct access code preserves permission", async () => {
        const accessCode = await createAccountDirect("agent_regen_ok@x.com", "0x00001111");
        const reply = await accountOperationFromAgent(
            C.CONST_CMD_REGENERATE_ACCESSCODE,
            "agent_regen_ok@x.com",
            accessCode
        );
        assert.equal(replyError(reply), C.CONST_ERROR_NON, "agent regenerate should succeed");
        const record = db.fn_get_record("agent_regen_ok@x.com");
        assert.equal(record.prm, "0x00001111",
            "permission must be preserved, not escalated");
    });
});


describe("js_account_operation — single mode", () => {
    before(() => {
        global.m_serverconfig.m_configuration.account_storage_type = "single";
        global.m_serverconfig.m_configuration.single_account_user_name = "single@airgap.droneengage.com";
        global.m_serverconfig.m_configuration.single_account_access_code = "test";
    });

    // Case 9a: single mode create returns prompt error (not hanging)
    it("create in single mode returns a prompt error", async () => {
        const reply = await accountOperation(
            C.CONST_CMD_CREATE_ACCESSCODE,
            "anyone@x.com",
            "0x00001111",
            null,
            null
        );
        assert.equal(replyError(reply), C.CONST_ERROR_NOT_SUPPORTED_SINGLE_MODE,
            "single-mode create must return the dedicated error code, not hang");
        assert.ok(reply[C.CONST_ERROR_MSG], "error message should be present");
    });

    // Case 9b: single mode regenerate returns prompt error (not hanging)
    it("regenerate in single mode returns a prompt error", async () => {
        const reply = await accountOperation(
            C.CONST_CMD_REGENERATE_ACCESSCODE,
            "anyone@x.com",
            "0x00001111",
            "somecode",
            null
        );
        assert.equal(replyError(reply), C.CONST_ERROR_NOT_SUPPORTED_SINGLE_MODE,
            "single-mode regenerate must return the dedicated error code, not hang");
        assert.ok(reply[C.CONST_ERROR_MSG], "error message should be present");
    });

    // Case 10 (single): GET_ACCOUNT_NAME still works in single mode
    it("getAccountName still works in single mode", async () => {
        const reply = await accountOperation(
            C.CONST_CMD_GET_ACCOUNT_NAME,
            null,
            "",
            "test",   // matches single_account_access_code
            null
        );
        assert.equal(replyError(reply), C.CONST_ERROR_NON);
        assert.equal(reply[C.CONST_ACCOUNT_NAME_PARAMETER], "single@airgap.droneengage.com");
    });
});
