"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { setupTestGlobals } = require("./test_helpers");
const validator = require("../src/auth_server/js_input_validator");
const hlp_string = require("droneengage_server_common").helpers.strings;
const c_CONSTANTS = require("../src/js_constants");

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

    it("rejects account names that exceed max length in account operations", () => {
        assert.equal(
            validator.validateAccountOperation({
                subCommand: "c",
                accountName: "a".repeat(c_CONSTANTS.CONST_ACCOUNT_NAME_MAX_LENGTH + 1),
                permission: "0xffffffff",
                accessCode: null,
            }),
            false
        );
    });

    it("validates emails in linear time (ReDoS regression)", () => {
        // Catastrophic-backtracking input class that hung the old regex.
        const redosInputs = [
            "a".repeat(40) + "@" + "a".repeat(40),
            "a".repeat(500) + "@" + "a".repeat(500),
            "a".repeat(120) + "-" + "a".repeat(120) + "@" + "a".repeat(120),
        ];
        for (const input of redosInputs) {
            const t0 = Date.now();
            assert.equal(hlp_string.fn_isEmail(input), false);
            assert.ok(Date.now() - t0 < 100, "isEmail took too long");
        }
    });

    it("accepts valid emails and rejects malformed ones", () => {
        assert.equal(hlp_string.fn_isEmail("user@domain.com"), true);
        assert.equal(hlp_string.fn_isEmail("a.b-c@sub.domain.org"), true);
        assert.equal(hlp_string.fn_isEmail("not-an-email"), false);
        assert.equal(hlp_string.fn_isEmail("a@b"), false);
        assert.equal(hlp_string.fn_isEmail("@x.com"), false);
        assert.equal(hlp_string.fn_isEmail("a..b@c.com"), false);
        assert.equal(hlp_string.fn_isEmail("a@b.com."), false);
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
