"use strict";

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { setupTestGlobals } = require("./test_helpers");

setupTestGlobals();

const hlp_password = require("../src/helpers/hlp_password");
const dbUsers = require("../src/database/db_users");
const sessionManager = require("../src/auth_server/js_session_manager");
const accountManager = require("../src/auth_server/js_account_manager");
const c_CONSTANTS = require("../src/js_constants");

// Use a throwaway DB file for this test suite
const TEST_DB = path.join(__dirname, "fixtures", "db_password_hashing.test.db");

describe("js_password_hashing (2.4)", () => {
    let db;

    before(() => {
        // Start with a clean file
        try { require("fs").unlinkSync(TEST_DB); } catch (e) { /* ok */ }
        global.m_serverconfig.m_configuration.account_storage_type = "file";
        global.m_serverconfig.m_configuration.file_db = TEST_DB;
        db = new dbUsers.db_user(TEST_DB);
        global.db_users = db;
    });

    describe("hlp_password", () => {
        it("hashes plaintext and verifies it", () => {
            const plaintext = "abc123XYZ";
            const hash = hlp_password.hash(plaintext);
            assert.ok(hlp_password.isHashed(hash), "hash should be detected as bcrypt");
            assert.equal(hlp_password.isHashed(plaintext), false, "plaintext should not be detected as bcrypt");
            assert.equal(hlp_password.verify(plaintext, hash), true);
            assert.equal(hlp_password.verify("wrong", hash), false);
        });

        it("verifies legacy plaintext codes (backward compat)", () => {
            const legacy = "oldplaintext123";
            assert.equal(hlp_password.verify(legacy, legacy), true);
            assert.equal(hlp_password.verify("wrong", legacy), false);
        });

        it("verifyAndUpgrade returns a hash for legacy plaintext", () => {
            const legacy = "legacycode456";
            let upgraded = null;
            const ok = hlp_password.verifyAndUpgrade(legacy, legacy, (h) => { upgraded = h; });
            assert.equal(ok, true);
            assert.ok(hlp_password.isHashed(upgraded), "upgraded value should be a bcrypt hash");
        });
    });

    describe("file-mode login with hashed codes", () => {
        it("creates an account and stores a hash, not plaintext", async () => {
            await new Promise((resolve) => {
                accountManager.fn_createAccessCode("hash_test@email.com", "0xffffffff", (reply) => {
                    assert.equal(reply[c_CONSTANTS.CONST_ERROR], c_CONSTANTS.CONST_ERROR_NON);
                    const plaintext = reply[c_CONSTANTS.CONST_ACCESS_CODE_PARAMETER];
                    assert.ok(plaintext && plaintext.length > 0, "plaintext access code should be returned to caller");

                    // Verify the stored value is a hash, not the plaintext
                    const record = db.fn_get_record("hash_test@email.com");
                    assert.ok(record, "record should exist");
                    assert.ok(hlp_password.isHashed(record.AccessCode), "stored AccessCode should be a bcrypt hash");
                    assert.notEqual(record.AccessCode, plaintext, "stored hash must not equal the plaintext");
                    resolve();
                });
            });
        });

        it("logs in successfully with the plaintext access code via session manager", async () => {
            // First create an account
            const plaintext = await new Promise((resolve) => {
                accountManager.fn_createAccessCode("login_test@email.com", "0xffffffff", (reply) => {
                    resolve(reply[c_CONSTANTS.CONST_ACCESS_CODE_PARAMETER]);
                });
            });

            // Now login with the plaintext — should succeed against the stored hash
            await new Promise((resolve) => {
                sessionManager.fn_createLoginCard(
                    "login_test@email.com",
                    plaintext,
                    "d", // agent actor type — same path as js_router_agent.js
                    "testgroup",
                    (reply) => {
                        assert.equal(reply[c_CONSTANTS.CONST_ERROR], c_CONSTANTS.CONST_ERROR_NON);
                        assert.ok(reply.m_session_id, "session ID should be returned");
                        assert.equal(reply.m_actorType, "d");
                        resolve();
                    }
                );
            });
        });

        it("rejects login with wrong access code", async () => {
            await new Promise((resolve) => {
                sessionManager.fn_createLoginCard(
                    "login_test@email.com",
                    "wrongcode",
                    "d",
                    "testgroup",
                    (reply) => {
                        assert.equal(reply[c_CONSTANTS.CONST_ERROR], c_CONSTANTS.CONST_ERROR_ACCOUNT_NOT_FOUND);
                        resolve();
                    }
                );
            });
        });

        it("regenerates access code and stores new hash", async () => {
            // First create
            const oldPlaintext = await new Promise((resolve) => {
                accountManager.fn_createAccessCode("regen_test@email.com", "0xffffffff", (reply) => {
                    resolve(reply[c_CONSTANTS.CONST_ACCESS_CODE_PARAMETER]);
                });
            });

            // Regenerate
            await new Promise((resolve) => {
                accountManager.fn_regenerateAccessCode("regen_test@email.com", "0xffffffff", (reply) => {
                    assert.equal(reply[c_CONSTANTS.CONST_ERROR], c_CONSTANTS.CONST_ERROR_NON);
                    const newPlaintext = reply[c_CONSTANTS.CONST_ACCESS_CODE_PARAMETER];
                    assert.ok(newPlaintext && newPlaintext !== oldPlaintext, "new code should differ from old");

                    // Stored value should be a hash
                    const record = db.fn_get_record("regen_test@email.com");
                    assert.ok(hlp_password.isHashed(record.AccessCode), "regenerated AccessCode should be a hash");
                    resolve();
                });
            });
        });

        it("getAccountNameByAccessCode works with hashed storage", async () => {
            const plaintext = await new Promise((resolve) => {
                accountManager.fn_createAccessCode("getname_test@email.com", "0xffffffff", (reply) => {
                    resolve(reply[c_CONSTANTS.CONST_ACCESS_CODE_PARAMETER]);
                });
            });

            await new Promise((resolve) => {
                accountManager.fn_getAccountNameByAccessCode(plaintext, (reply) => {
                    assert.equal(reply[c_CONSTANTS.CONST_ERROR], c_CONSTANTS.CONST_ERROR_NON);
                    assert.equal(reply[c_CONSTANTS.CONST_ACCOUNT_NAME_PARAMETER], "getname_test@email.com");
                    resolve();
                });
            });
        });
    });
});
