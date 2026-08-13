"use strict";

/**
 * Password hashing helper.
 *
 * Access codes (password-equivalent credentials) are hashed with bcrypt before
 * being stored in the database or file store. This module centralises hashing,
 * verification, and backward-compatible handling of legacy plaintext codes.
 *
 * Legacy plaintext codes (created before hashing was introduced) are detected
 * at verification time: if the stored value is not a bcrypt hash, a direct
 * comparison is performed and, on success, the caller can lazily upgrade the
 * stored value to a bcrypt hash.
 */
const bcrypt = require("bcrypt");

const BCRYPT_ROUNDS = 10;

// bcrypt hashes always start with $2a$, $2b$, or $2y$
const BCRYPT_RE = /^\$2[aby]\$\d{2}\$/;

/**
 * Returns true if the stored value is a bcrypt hash.
 * @param {string} stored
 * @returns {boolean}
 */
function isHashed(stored) {
    return typeof stored === "string" && BCRYPT_RE.test(stored);
}

/**
 * Hash a plaintext access code with bcrypt.
 * @param {string} plaintext
 * @returns {string} bcrypt hash
 */
function hash(plaintext) {
    return bcrypt.hashSync(plaintext, BCRYPT_ROUNDS);
}

/**
 * Verify a plaintext access code against a stored value.
 *
 * Supports both bcrypt hashes and legacy plaintext codes:
 *  - If `stored` is a bcrypt hash, use bcrypt.compare.
 *  - Otherwise, fall back to a direct (constant-time-ish) string comparison
 *    so existing plaintext codes still work until they are lazily upgraded.
 *
 * @param {string} plaintext - the credential supplied by the user
 * @param {string} stored - the value loaded from the DB/file
 * @returns {boolean} true if the credential matches
 */
function verify(plaintext, stored) {
    if (plaintext == null || stored == null) return false;
    if (isHashed(stored)) {
        return bcrypt.compareSync(plaintext, stored);
    }
    // Legacy plaintext fallback (pre-hashing codes).
    return plaintext === stored;
}

/**
 * Verify and, if the stored value is a legacy plaintext that matches, invoke
 * the upgrade callback with a fresh bcrypt hash so the caller can persist it.
 *
 * @param {string} plaintext - the credential supplied by the user
 * @param {string} stored - the value loaded from the DB/file
 * @param {function(string): void} [onUpgrade] - called with the new hash when
 *        a legacy plaintext code is verified and should be upgraded.
 * @returns {boolean} true if the credential matches
 */
function verifyAndUpgrade(plaintext, stored, onUpgrade) {
    if (plaintext == null || stored == null) return false;
    if (isHashed(stored)) {
        return bcrypt.compareSync(plaintext, stored);
    }
    // Legacy plaintext: direct compare, then offer upgrade.
    if (plaintext === stored) {
        if (typeof onUpgrade === "function") {
            try {
                onUpgrade(hash(plaintext));
            } catch (e) {
                console.error("[hlp_password] upgrade hash failed:", e);
            }
        }
        return true;
    }
    return false;
}

module.exports = {
    isHashed,
    hash,
    verify,
    verifyAndUpgrade,
    BCRYPT_ROUNDS,
};
