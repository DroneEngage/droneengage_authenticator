"use strict";

/**
 * Unit tests for auth_server/js_comm_server_manager.js UDP relay status (`j`)
 * handling and the account-aware `g` UDP-proxy block command, plus the admin
 * route that forwards the block request.
 */

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const { setupTestGlobals } = require("./test_helpers");

setupTestGlobals();

const commServerManager = require("../src/auth_server/js_comm_server_manager");
const adminRouter = require("../src/routes/js_router_admin");

const CONST_GUID = "test-comm-guid-1";

function fn_infoCmd(overrides = {}) {
    return JSON.stringify({
        c: "a", // CONST_CS_CMD_INFO
        d: Object.assign({
            isOnline: true,
            version: "1.0.0",
            serverId: "CS_TEST",
            public_host: "127.0.0.1",
            serverPort: 60008,
            accounts: [],
            accountDetails: {}
        }, overrides)
    });
}

function fn_relayStatusCmd(relayId, status, extra = {}) {
    return JSON.stringify({
        c: "j", // CONST_CS_CMD_UDP_RELAY_STATUS
        d: Object.assign({
            relay_id: relayId,
            host: "127.0.0.1",
            port: 50000,
            status: status,
            pairs: 2,
            error: null,
            timestamp: 1700000000
        }, extra)
    });
}

function fn_getServer(guid) {
    return commServerManager.getCommunicationServersList()[guid];
}

describe("js_comm_server_manager UDP relay status", () => {
    before(() => {
        commServerManager.fn_commServerMessageHandler(CONST_GUID, fn_infoCmd());
    });

    it("stores relay status from a `j` command keyed by relay_id", () => {
        commServerManager.fn_commServerMessageHandler(CONST_GUID, fn_relayStatusCmd("relay1", "cd"));

        const status = fn_getServer(CONST_GUID).m_server.m_udpRelayStatus;
        assert.ok(status);
        assert.equal(status.relay1.status, "cd");
        assert.equal(status.relay1.host, "127.0.0.1");
        assert.equal(status.relay1.port, 50000);
        assert.equal(status.relay1.pairs, 2);
    });

    it("tracks multiple relays independently on the same comm server", () => {
        commServerManager.fn_commServerMessageHandler(CONST_GUID, fn_relayStatusCmd("relay2", "cg"));

        const status = fn_getServer(CONST_GUID).m_server.m_udpRelayStatus;
        assert.equal(Object.keys(status).length, 2);
        assert.equal(status.relay1.status, "cd");
        assert.equal(status.relay2.status, "cg");
    });

    it("updates an existing relay entry on a later `j`", () => {
        commServerManager.fn_commServerMessageHandler(CONST_GUID, fn_relayStatusCmd("relay1", "er", { error: "ws closed" }));

        const status = fn_getServer(CONST_GUID).m_server.m_udpRelayStatus;
        assert.equal(status.relay1.status, "er");
        assert.equal(status.relay1.error, "ws closed");
    });

    it("preserves relay status across INFO heartbeats", () => {
        commServerManager.fn_commServerMessageHandler(CONST_GUID, fn_infoCmd({ version: "1.0.1" }));

        const status = fn_getServer(CONST_GUID).m_server.m_udpRelayStatus;
        assert.ok(status);
        assert.equal(status.relay1.status, "er");
    });

    it("leaves the field empty for a comm server that never sends `j`", () => {
        commServerManager.fn_commServerMessageHandler("guid-no-relay", fn_infoCmd());

        const server = fn_getServer("guid-no-relay");
        assert.ok(server);
        assert.equal(server.m_server.m_udpRelayStatus == null, true);
    });
});

describe("js_comm_server_manager fn_setUdpProxyBlocked", () => {
    it("sends `g` with name and account when the pair is relay-keyed", () => {
        const sent = [];
        commServerManager.fn_initialize();
        commServerManager.fn_sendMessage = (guid, msg) => sent.push({ guid, msg });

        const serverInfo = { m_server: { m_isOnline: true, m_commServerGUID: CONST_GUID } };
        commServerManager.fn_setUdpProxyBlocked(serverInfo, "UNIT1", true, "acc_hash_1", () => {}, () => {});

        assert.equal(sent.length, 1);
        assert.equal(sent[0].guid, CONST_GUID);
        const cmd = JSON.parse(sent[0].msg);
        assert.equal(cmd.c, "g"); // CONST_CS_CMD_SET_UDP_PROXY_STATE
        assert.equal(cmd.d.name, "UNIT1");
        assert.equal(cmd.d.blocked, true);
        assert.equal(cmd.d.account, "acc_hash_1");
    });

    it("omits account from `g` when none is given (built-in proxy)", () => {
        const sent = [];
        commServerManager.fn_sendMessage = (guid, msg) => sent.push({ guid, msg });

        const serverInfo = { m_server: { m_isOnline: true, m_commServerGUID: CONST_GUID } };
        commServerManager.fn_setUdpProxyBlocked(serverInfo, "UNIT1", false, null, () => {}, () => {});

        const cmd = JSON.parse(sent[0].msg);
        assert.equal(cmd.c, "g");
        assert.equal("account" in cmd.d, false);
    });
});

describe("admin route /api/servers/:guid/udp-proxy-state", () => {
    it("forwards name and account to fn_setUdpProxyBlocked", () => {
        const route = adminRouter.stack.find(
            (layer) => layer.route && layer.route.path === "/api/servers/:guid/udp-proxy-state"
        );
        assert.ok(route, "route layer not found");
        const handlers = route.route.stack.filter((s) => s.method === "post");
        const handler = handlers[handlers.length - 1].handle;

        const serverInfo = { m_server: { m_isOnline: true, m_commServerGUID: CONST_GUID } };
        const origList = commServerManager.getCommunicationServersList;
        const origBlocked = commServerManager.fn_setUdpProxyBlocked;
        const calls = [];
        commServerManager.getCommunicationServersList = () => ({ [CONST_GUID]: serverInfo });
        commServerManager.fn_setUdpProxyBlocked = (server, name, blocked, account, success, error) => {
            calls.push({ name, blocked, account });
            success([], { applied: true });
        };

        try {
            let reply = null;
            handler(
                { params: { guid: CONST_GUID }, body: { name: "UNIT1", blocked: true, account: "acc_hash_1" } },
                { json: (o) => { reply = o; } },
                () => {}
            );

            assert.equal(calls.length, 1);
            assert.equal(calls[0].name, "UNIT1");
            assert.equal(calls[0].blocked, true);
            assert.equal(calls[0].account, "acc_hash_1");
            assert.equal(reply.error, 0);
        } finally {
            commServerManager.getCommunicationServersList = origList;
            commServerManager.fn_setUdpProxyBlocked = origBlocked;
        }
    });
});
