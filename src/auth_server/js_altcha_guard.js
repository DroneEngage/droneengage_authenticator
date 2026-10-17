/*************************************************************************************
 *
 *   A L T C H A   G U A R D   —  proof-of-work captcha for public endpoints
 *
 *   Issues ALTCHA challenges (GET /w/cc) and verifies solved payloads
 *   submitted as 'cp' on the public account-management commands
 *   (create/regenerate access code). Self-hosted — no third-party service,
 *   so it also works on airgapped deployments.
 *
 *   Config (server.config / server.config.local):
 *     "altcha_enabled"      : true|false   — default true; false disables
 *                                         the challenge endpoint AND the
 *                                         payload check (trusted LAN installs)
 *     "altcha_hmac_secret"  : "..."        — HMAC key signing challenges.
 *                                         Empty → ephemeral per-boot secret
 *                                         (in-flight challenges die on restart)
 *     "altcha_max_number"   : 100000       — PoW difficulty ceiling
 *     "altcha_ttl_sec"      : 300          — challenge expiry
 *
 *************************************************************************************/
"use strict";

const crypto = require('crypto');
const C = global.c_CONSTANTS;

const CHALLENGE_TTL_DEFAULT_SEC = 300;
const MAX_NUMBER_DEFAULT = 100000;
// Keep replay entries a bit longer than the challenge TTL so an expired
// challenge can't slip back in through the replay-window edge.
const REPLAY_RETENTION_MS = 30 * 60 * 1000;

let m_initPromise = null;
let m_altcha = null;          // lazily imported ESM module (altcha-lib)
let m_enabled = false;
let m_secret = null;
let m_maxNumber = MAX_NUMBER_DEFAULT;
let m_ttlMs = CHALLENGE_TTL_DEFAULT_SEC * 1000;

// challenge hex -> expiry timestamp; consumed/seen challenges (anti-replay)
const m_usedChallenges = new Map();


function fn_purgeUsedChallenges() {
    const now = Date.now();
    for (const [challenge, expiry] of m_usedChallenges) {
        if (expiry < now) m_usedChallenges.delete(challenge);
    }
}


function fn_init() {
    if (m_initPromise) return m_initPromise;
    m_initPromise = (async () => {
        const cfg = global.m_serverconfig.m_configuration || {};
        m_enabled = cfg.altcha_enabled !== false;
        if (!m_enabled) {
            console.log('ALTCHA: disabled by config (altcha_enabled=false)');
            return;
        }
        m_maxNumber = Number.isInteger(cfg.altcha_max_number) ? cfg.altcha_max_number : MAX_NUMBER_DEFAULT;
        m_ttlMs = (Number.isInteger(cfg.altcha_ttl_sec) ? cfg.altcha_ttl_sec : CHALLENGE_TTL_DEFAULT_SEC) * 1000;
        m_secret = cfg.altcha_hmac_secret || crypto.randomBytes(32).toString('hex');
        if (!cfg.altcha_hmac_secret) {
            console.log('ALTCHA: no altcha_hmac_secret configured — using ephemeral per-boot secret');
        }
        m_altcha = await import('altcha-lib');
        console.log('ALTCHA: enabled — challenge endpoint /w' + C.CONST_CAPTCHA_CHALLENGE);
    })();
    return m_initPromise;
}


function fn_isEnabled() {
    return m_enabled;
}


async function fn_issueChallenge() {
    await fn_init();
    if (!m_enabled) return null;
    return await m_altcha.createChallenge({
        hmacKey: m_secret,
        maxNumber: m_maxNumber,
        expires: new Date(Date.now() + m_ttlMs)
    });
}


/**
 * Verifies a solved ALTCHA payload (base64 JSON from the widget).
 * Enforces single-use: a challenge that verifies once can never verify again.
 * @param {string} p_payload - base64-encoded ALTCHA payload ('cp' field).
 * @returns {Promise<boolean>} true when the payload is valid and fresh.
 */
async function fn_verifyPayload(p_payload) {
    await fn_init();
    if (!m_enabled) return true;                    // guard off → open
    if (typeof p_payload !== 'string' || p_payload.length === 0 || p_payload.length > 8192) {
        return false;
    }
    try {
        const ok = await m_altcha.verifySolution(p_payload, m_secret, true);
        if (!ok) return false;

        // Replay protection — the challenge id is inside the verified payload
        const decoded = JSON.parse(Buffer.from(p_payload, 'base64').toString('utf8'));
        fn_purgeUsedChallenges();
        if (m_usedChallenges.has(decoded.challenge)) return false;
        m_usedChallenges.set(decoded.challenge, Date.now() + REPLAY_RETENTION_MS);
        return true;
    } catch (ex) {
        return false;
    }
}


module.exports = {
    fn_isEnabled,
    fn_issueChallenge,
    fn_verifyPayload
};
