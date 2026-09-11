"use strict";

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { setupTestGlobals } = require("./test_helpers");

setupTestGlobals();

const dbUsers = require("../src/database/db_users");
global.db_users = new dbUsers.db_user(path.join(__dirname, "fixtures", "db_users.test.db"));

const sessionManager = require("../src/auth_server/js_session_manager");
const c_CONSTANTS = require("../src/js_constants");

describe("js_session_manager", () => {
    before(() => {
        global.m_serverconfig.m_configuration.account_storage_type = "file";
        global.m_serverconfig.m_configuration.file_db = path.join(__dirname, "fixtures", "db_users.test.db");
    });

    it("creates a login card for valid file-backed credentials", async () => {
        await new Promise((resolve) => {
            sessionManager.fn_createLoginCard(
                "testc@email.com",
                "0000",
                "g",
                "group1",
                (reply) => {
                    assert.equal(reply[c_CONSTANTS.CONST_ERROR], c_CONSTANTS.CONST_ERROR_NON);
                    assert.ok(reply.m_session_id);
                    assert.equal(reply.m_actorType, "g");
                    assert.equal(reply[c_CONSTANTS.CONST_CS_GROUP_ID], "group1");
                    resolve();
                }
            );
        });
    });

    it("rejects invalid credentials", async () => {
        await new Promise((resolve) => {
            sessionManager.fn_createLoginCard(
                "testc@email.com",
                "wrong",
                "g",
                "group1",
                (reply) => {
                    assert.equal(reply[c_CONSTANTS.CONST_ERROR], c_CONSTANTS.CONST_ERROR_ACCOUNT_NOT_FOUND);
                    resolve();
                }
            );
        });
    });

    it("checks GCS and agent permissions", () => {
        const gcsCard = {
            m_data: {
                m_prm: 0xffffffff,
            },
        };
        const agentCard = {
            m_data: {
                m_prm: 0x00000010,
            },
        };

        assert.equal(sessionManager.fn_isGCS(gcsCard), true);
        assert.equal(sessionManager.fn_isAGN(agentCard), true);
        assert.equal(sessionManager.fn_isGCS(agentCard), false);
    });

    it("checks GCS-login and unit-login account-type bits", () => {
        const fullCard = { m_data: { m_prm: 0xffffffff } };
        const gcsOnlyCard = { m_data: { m_prm: 0x80000000 } };
        const unitOnlyCard = { m_data: { m_prm: 0x40000000 } };
        const neitherCard = { m_data: { m_prm: 0x00000001 } };

        assert.equal(sessionManager.fn_isGCSLogin(fullCard), true);
        assert.equal(sessionManager.fn_isUnitLogin(fullCard), true);
        assert.equal(sessionManager.fn_isGCSLogin(gcsOnlyCard), true);
        assert.equal(sessionManager.fn_isUnitLogin(gcsOnlyCard), false);
        assert.equal(sessionManager.fn_isGCSLogin(unitOnlyCard), false);
        assert.equal(sessionManager.fn_isUnitLogin(unitOnlyCard), true);
        assert.equal(sessionManager.fn_isGCSLogin(neitherCard), false);
        assert.equal(sessionManager.fn_isUnitLogin(neitherCard), false);
    });

    it("checks the view-mode bit (fn_isViewMode)", () => {
        // 0xa0000000 = GCS login + view mode — the canonical view-mode mask.
        // It is accepted as a GCS login and rejected as a unit login.
        const viewModeCard = { m_data: { m_prm: 0xa0000000 } };
        assert.equal(sessionManager.fn_isViewMode(viewModeCard), true);
        assert.equal(sessionManager.fn_isGCSLogin(viewModeCard), true);
        assert.equal(sessionManager.fn_isUnitLogin(viewModeCard), false);

        // A plain GCS-login account (0x80000000) is NOT view mode.
        const gcsOnlyCard = { m_data: { m_prm: 0x80000000 } };
        assert.equal(sessionManager.fn_isViewMode(gcsOnlyCard), false);

        // Full-control account (0xffffffff) has bit 29 set BUT also has
        // category/action bits, so it is NOT view-mode.
        const fullCard = { m_data: { m_prm: 0xffffffff } };
        assert.equal(sessionManager.fn_isViewMode(fullCard), false);

        // null/missing data is safe.
        assert.equal(sessionManager.fn_isViewMode(null), false);
        assert.equal(sessionManager.fn_isViewMode({ m_data: null }), false);
    });
});
