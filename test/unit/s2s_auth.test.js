"use strict";

/**
 * Unit tests for auth_server/js_s2s_auth.js
 *
 * Tests the Ed25519 challenge-response authentication helper for the Auth Server.
 * Focuses on envelope building/parsing, nonce generation, and verification logic.
 * The Auth Server only accepts connections, so it does not have signing capability.
 */

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { installFakeGlobals, restoreGlobals } = require('../../test/helpers/test_globals.js');
const c_s2s_auth = require('../../auth_server/js_s2s_auth.js');

let g_tempDir = null;

function fn_makeTempKeys() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 's2s-test-'));
    g_tempDir = tempDir;
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    const privatePath = path.join(tempDir, 'test_private.pem');
    const publicPath = path.join(tempDir, 'test_public.pem');
    fs.writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
    fs.writeFileSync(publicPath, publicKey.export({ type: 'spki', format: 'pem' }));
    return { privatePath, publicPath };
}

test.afterEach(() => {
    restoreGlobals();
    c_s2s_auth.fn_resetKeyCache();
    if (g_tempDir != null) {
        fs.rmSync(g_tempDir, { recursive: true, force: true });
        g_tempDir = null;
    }
});


// ---------------------------------------------------------------------------
// fn_isEnabled
// ---------------------------------------------------------------------------

test('fn_isEnabled returns false when s2s_auth_enabled is not set', () => {
    installFakeGlobals({});
    assert.strictEqual(c_s2s_auth.fn_isEnabled(), false);
});

test('fn_isEnabled returns false when s2s_auth_enabled is false', () => {
    installFakeGlobals({ s2s_auth_enabled: false });
    assert.strictEqual(c_s2s_auth.fn_isEnabled(), false);
});

test('fn_isEnabled returns true when s2s_auth_enabled is true', () => {
    installFakeGlobals({ s2s_auth_enabled: true });
    assert.strictEqual(c_s2s_auth.fn_isEnabled(), true);
});


// ---------------------------------------------------------------------------
// fn_generateNonce
// ---------------------------------------------------------------------------

test('fn_generateNonce returns a 64-character hex string (32 bytes)', () => {
    const nonce = c_s2s_auth.fn_generateNonce();
    assert.strictEqual(typeof nonce, 'string');
    assert.strictEqual(nonce.length, 64);
    assert.match(nonce, /^[0-9a-f]{64}$/);
});

test('fn_generateNonce returns different values on each call', () => {
    const nonce1 = c_s2s_auth.fn_generateNonce();
    const nonce2 = c_s2s_auth.fn_generateNonce();
    assert.notStrictEqual(nonce1, nonce2);
});


// ---------------------------------------------------------------------------
// fn_buildChallenge / fn_parseEnvelope
// ---------------------------------------------------------------------------

test('fn_buildChallenge creates valid challenge envelope', () => {
    const nonce = 'abc123';
    const challenge = c_s2s_auth.fn_buildChallenge(nonce);
    const parsed = JSON.parse(challenge);
    assert.strictEqual(parsed.s2s_auth, 'challenge');
    assert.strictEqual(parsed.nonce, nonce);
});

test('fn_parseEnvelope parses challenge envelope', () => {
    const nonce = 'abc123';
    const challenge = c_s2s_auth.fn_buildChallenge(nonce);
    const parsed = c_s2s_auth.fn_parseEnvelope(challenge);
    assert.strictEqual(parsed.s2s_auth, 'challenge');
    assert.strictEqual(parsed.nonce, nonce);
});

test('fn_parseEnvelope parses response envelope', () => {
    const response = JSON.stringify({ s2s_auth: 'response', sig: 'xyz', id: 'server1' });
    const parsed = c_s2s_auth.fn_parseEnvelope(response);
    assert.strictEqual(parsed.s2s_auth, 'response');
    assert.strictEqual(parsed.sig, 'xyz');
    assert.strictEqual(parsed.id, 'server1');
});

test('fn_parseEnvelope returns null for non-S2S messages', () => {
    assert.strictEqual(c_s2s_auth.fn_parseEnvelope('{"normal":"message"}'), null);
    assert.strictEqual(c_s2s_auth.fn_parseEnvelope('random string'), null);
});

test('fn_parseEnvelope returns null for binary payload not starting with {', () => {
    const buffer = Buffer.from([0x00, 0x01, 0x02]);
    assert.strictEqual(c_s2s_auth.fn_parseEnvelope(buffer), null);
});

test('fn_parseEnvelope handles binary JSON starting with {', () => {
    const json = JSON.stringify({ s2s_auth: 'challenge', nonce: 'abc' });
    const buffer = Buffer.from(json);
    const parsed = c_s2s_auth.fn_parseEnvelope(buffer);
    assert.strictEqual(parsed.s2s_auth, 'challenge');
});


// ---------------------------------------------------------------------------
// fn_verify (integration with real keys)
// ---------------------------------------------------------------------------

function fn_signNonce(p_nonce, p_privateKey) {
    return crypto.sign(null, Buffer.from(p_nonce), p_privateKey).toString('base64');
}

test('fn_verify works with matching key pair', () => {
    const { privatePath, publicPath } = fn_makeTempKeys();
    const privateKey = crypto.createPrivateKey(fs.readFileSync(privatePath));
    installFakeGlobals({
        s2s_trusted_server_keys: { test: publicPath }
    });

    const nonce = 'test_nonce_123';
    const signature = fn_signNonce(nonce, privateKey);
    const isValid = c_s2s_auth.fn_verify(nonce, signature, 'test');
    assert.strictEqual(isValid, true);
});

test('fn_verify returns false for incorrect signature', () => {
    const { publicPath } = fn_makeTempKeys();
    installFakeGlobals({
        s2s_trusted_server_keys: { test: publicPath }
    });

    const nonce = 'test_nonce_123';
    const wrongSignature = 'invalid_signature_base64';
    const isValid = c_s2s_auth.fn_verify(nonce, wrongSignature, 'test');
    assert.strictEqual(isValid, false);
});

test('fn_verify returns false for unknown server_id', () => {
    const { privatePath, publicPath } = fn_makeTempKeys();
    const privateKey = crypto.createPrivateKey(fs.readFileSync(privatePath));
    installFakeGlobals({
        s2s_trusted_server_keys: { test: publicPath }
    });

    const nonce = 'test_nonce_123';
    const signature = fn_signNonce(nonce, privateKey);
    const isValid = c_s2s_auth.fn_verify(nonce, signature, 'unknown_server');
    assert.strictEqual(isValid, false);
});

test('fn_verify returns false for null parameters', () => {
    const { publicPath } = fn_makeTempKeys();
    installFakeGlobals({ s2s_trusted_server_keys: { test: publicPath } });
    assert.strictEqual(c_s2s_auth.fn_verify(null, 'sig', 'id'), false);
    assert.strictEqual(c_s2s_auth.fn_verify('nonce', null, 'id'), false);
    assert.strictEqual(c_s2s_auth.fn_verify('nonce', 'sig', null), false);
});


// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

test('fn_getPublicKeys throws when s2s_trusted_server_keys not configured', () => {
    installFakeGlobals({});
    c_s2s_auth.fn_resetKeyCache();
    assert.throws(() => c_s2s_auth.fn_getPublicKeys(), /s2s_trusted_server_keys is not configured/);
});


// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

test('CONST_S2S_AUTH_CHALLENGE is "challenge"', () => {
    assert.strictEqual(c_s2s_auth.CONST_S2S_AUTH_CHALLENGE, 'challenge');
});

test('CONST_S2S_AUTH_RESPONSE is "response"', () => {
    assert.strictEqual(c_s2s_auth.CONST_S2S_AUTH_RESPONSE, 'response');
});

test('CONST_S2S_AUTH_HANDSHAKE_TIMEOUT is 8000ms', () => {
    assert.strictEqual(c_s2s_auth.CONST_S2S_AUTH_HANDSHAKE_TIMEOUT, 8000);
});


// ---------------------------------------------------------------------------
// Auth server does not export fn_sign or fn_buildResponse
// ---------------------------------------------------------------------------

test('Auth server S2S helper does not export fn_sign', () => {
    assert.strictEqual(c_s2s_auth.fn_sign, undefined);
});

test('Auth server S2S helper does not export fn_buildResponse', () => {
    assert.strictEqual(c_s2s_auth.fn_buildResponse, undefined);
});
