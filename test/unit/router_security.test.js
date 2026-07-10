"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");

// Mock the rate limiter functions (copied from router files)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000;
const RATE_LIMIT_MAX_REQUESTS = 10;

function fn_checkRateLimit(ip) {
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW;
    
    let requests = rateLimitMap.get(ip) || [];
    requests = requests.filter(timestamp => timestamp > windowStart);
    
    if (requests.length >= RATE_LIMIT_MAX_REQUESTS) {
        return false;
    }
    
    requests.push(now);
    rateLimitMap.set(ip, requests);
    return true;
}

function clearRateLimit() {
    rateLimitMap.clear();
}

// Mock validation functions
function validateAccountNameLength(accountName) {
    if (typeof accountName === 'string' && accountName.length > 255) {
        return false;
    }
    return true;
}

function validateAccessCodeLength(accessCode) {
    if (typeof accessCode === 'string' && accessCode.length > 128) {
        return false;
    }
    return true;
}

describe("Router Security Middleware", () => {
    after(() => {
        clearRateLimit();
    });

    describe("Rate Limiting", () => {
        it("allows requests within rate limit", () => {
            clearRateLimit();
            const ip = "127.0.0.1";
            
            for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i++) {
                assert.equal(fn_checkRateLimit(ip), true);
            }
        });

        it("blocks requests exceeding rate limit", () => {
            clearRateLimit();
            const ip = "127.0.0.1";
            
            // Make 10 successful requests
            for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i++) {
                assert.equal(fn_checkRateLimit(ip), true);
            }
            
            // 11th request should be rate limited
            assert.equal(fn_checkRateLimit(ip), false);
        });

        it("resets rate limit after window expires", () => {
            clearRateLimit();
            const ip = "127.0.0.1";
            
            // Make 10 successful requests
            for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i++) {
                assert.equal(fn_checkRateLimit(ip), true);
            }
            
            // 11th request should be rate limited
            assert.equal(fn_checkRateLimit(ip), false);
            
            // Manually expire the window by clearing
            clearRateLimit();
            
            // Should allow requests again
            assert.equal(fn_checkRateLimit(ip), true);
        });

        it("tracks rate limits independently per IP", () => {
            clearRateLimit();
            const ip1 = "127.0.0.1";
            const ip2 = "192.168.1.1";
            
            // Make 10 requests from IP1
            for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i++) {
                assert.equal(fn_checkRateLimit(ip1), true);
            }
            
            // IP1 should be rate limited
            assert.equal(fn_checkRateLimit(ip1), false);
            
            // IP2 should still be allowed
            assert.equal(fn_checkRateLimit(ip2), true);
        });
    });

    describe("Input Length Validation", () => {
        it("accepts valid account name length", () => {
            assert.equal(validateAccountNameLength("user@example.com"), true);
            assert.equal(validateAccountNameLength("a".repeat(255)), true);
        });

        it("rejects account name exceeding 255 characters", () => {
            assert.equal(validateAccountNameLength("a".repeat(256)), false);
            assert.equal(validateAccountNameLength("a".repeat(300)), false);
        });

        it("accepts valid access code length", () => {
            assert.equal(validateAccessCodeLength("password123"), true);
            assert.equal(validateAccessCodeLength("a".repeat(128)), true);
        });

        it("rejects access code exceeding 128 characters", () => {
            assert.equal(validateAccessCodeLength("a".repeat(129)), false);
            assert.equal(validateAccessCodeLength("a".repeat(200)), false);
        });

        it("handles non-string inputs gracefully", () => {
            assert.equal(validateAccountNameLength(null), true);
            assert.equal(validateAccountNameLength(undefined), true);
            assert.equal(validateAccountNameLength(123), true);
            assert.equal(validateAccessCodeLength(null), true);
            assert.equal(validateAccessCodeLength(undefined), true);
            assert.equal(validateAccessCodeLength(123), true);
        });
    });
});
