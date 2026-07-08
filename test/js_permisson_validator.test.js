"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const permission = require("../auth_server/js_permisson_validator");

describe("js_permisson_validator", () => {
    it("converts hex permission strings to integers", () => {
        assert.equal(permission.fn_convertPermissiontoInt("0xffffffff"), 0xffffffff);
        assert.equal(permission.fn_convertPermissiontoInt(null), 0xffffffff);
    });

    it("accepts numeric permission values", () => {
        assert.equal(permission.fn_convertPermissiontoInt(0x00000001), 0x00000001);
    });

    it("validates permission flags", () => {
        const flags = permission.AndruavMessageTypes;
        assert.equal(
            permission.fn_validatePermission("0xffffffff", flags.CONST_ALLOW_GCS),
            true
        );
        assert.equal(
            permission.fn_validatePermission("0x00000010", flags.CONST_ALLOW_GCS),
            false
        );
        assert.equal(
            permission.fn_validatePermission(0x00000011, flags.CONST_ALLOW_GCS),
            true
        );
    });
});
