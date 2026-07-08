"use strict";

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { setupTestGlobals } = require("./test_helpers");

setupTestGlobals();

const dbUsers = require("../database/db_users");
global.db_users = new dbUsers.db_user(path.join(__dirname, "fixtures", "db_users.test.db"));

const sessionManager = require("../auth_server/js_session_manager");
const c_CONSTANTS = require("../js_constants");

describe("js_session_manager", () => {
    before(() => {
        global.m_serverconfig.m_configuration.account_storage_type = "file";
        global.m_serverconfig.m_configuration.db_users = path.join("test", "fixtures", "db_users.test.db");
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
});
