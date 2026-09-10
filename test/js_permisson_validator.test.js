"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const permission = require("../src/auth_server/js_permisson_validator");

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

    it("validates GCS-login and unit-login account-type bits", () => {
        const flags = permission.AndruavMessageTypes;
        // 0xffffffff has all bits set including 31/30
        assert.equal(permission.fn_validatePermission("0xffffffff", flags.CONST_ALLOW_GCS_LOGIN), true);
        assert.equal(permission.fn_validatePermission("0xffffffff", flags.CONST_ALLOW_UNIT_LOGIN), true);
        // 0x80000000 = bit 31 only (GCS login)
        assert.equal(permission.fn_validatePermission("0x80000000", flags.CONST_ALLOW_GCS_LOGIN), true);
        assert.equal(permission.fn_validatePermission("0x80000000", flags.CONST_ALLOW_UNIT_LOGIN), false);
        // 0x40000000 = bit 30 only (unit login)
        assert.equal(permission.fn_validatePermission("0x40000000", flags.CONST_ALLOW_GCS_LOGIN), false);
        assert.equal(permission.fn_validatePermission("0x40000000", flags.CONST_ALLOW_UNIT_LOGIN), true);
        // 0x00000001 = neither account-type bit
        assert.equal(permission.fn_validatePermission("0x00000001", flags.CONST_ALLOW_GCS_LOGIN), false);
        assert.equal(permission.fn_validatePermission("0x00000001", flags.CONST_ALLOW_UNIT_LOGIN), false);
    });
});
