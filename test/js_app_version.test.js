"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { setupTestGlobals } = require("./test_helpers");
const appVersion = require("../auth_server/js_app_version");
const c_CONSTANTS = require("../js_constants");

setupTestGlobals();

describe("js_app_version", () => {
    it("returns null for supported app versions", () => {
        assert.equal(appVersion.checkAppVersion("andruav", "4.00.00"), null);
        assert.equal(appVersion.checkAppVersion("de", "1.0.0"), null);
    });

    it("returns an error for unknown apps", () => {
        const reply = appVersion.checkAppVersion("unknown", "1.0.0");
        assert.equal(reply[c_CONSTANTS.CONST_ERROR], c_CONSTANTS.CONST_ERROR_OLD_APP_VERSION);
    });

    it("returns an error for outdated versions", () => {
        const reply = appVersion.checkAppVersion("andruav", "3.00.00");
        assert.equal(reply[c_CONSTANTS.CONST_ERROR], c_CONSTANTS.CONST_ERROR_OLD_APP_VERSION);
        assert.match(reply[c_CONSTANTS.CONST_ERROR_MSG], /upgrade/i);
    });
});
