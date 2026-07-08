"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { setupTestGlobals } = require("./test_helpers");
const validator = require("../auth_server/js_input_validator");
const c_CONSTANTS = require("../js_constants");

setupTestGlobals();

describe("js_input_validator", () => {
    it("accepts a valid login request", () => {
        assert.equal(
            validator.validateLoginRequest({
                accountName: "user@example.com",
                accessCode: "abc123",
                actorType: "g",
                group: "group1",
                app: "andruav",
                version: "4.00.00",
                extra: "device info 123",
            }),
            true
        );
    });

    it("rejects invalid email addresses", () => {
        assert.equal(
            validator.validateLoginRequest({
                accountName: "not-an-email",
                accessCode: "abc123",
                actorType: "g",
                group: "group1",
                app: "andruav",
                version: "4.00.00",
                extra: "device info 123",
            }),
            false
        );
    });

    it("rejects access codes that exceed max length", () => {
        assert.equal(
            validator.validateLoginRequest({
                accountName: "user@example.com",
                accessCode: "a".repeat(c_CONSTANTS.CONST_ACCESSCODE_MAX_LENGTH + 1),
                actorType: "g",
                group: "group1",
                app: "andruav",
                version: "4.00.00",
                extra: "device info 123",
            }),
            false
        );
    });

    it("validates account operations", () => {
        assert.equal(
            validator.validateAccountOperation({
                subCommand: "c",
                accountName: "user@example.com",
                permission: "0xffffffff",
                accessCode: null,
            }),
            true
        );

        assert.equal(
            validator.validateAccountOperation({
                subCommand: "toolong",
                accountName: "user@example.com",
                permission: "0xffffffff",
                accessCode: null,
            }),
            false
        );
    });

    it("validates session ids", () => {
        assert.equal(validator.validateSessionID("abc123"), true);
        assert.equal(validator.validateSessionID("bad id"), false);
        assert.equal(
            validator.validateSessionID("a".repeat(c_CONSTANTS.CONST_SESSION_MAX_LENGTH + 1)),
            false
        );
    });
});
