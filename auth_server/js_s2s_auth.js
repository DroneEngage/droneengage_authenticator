"use strict";

/**
 * Server-to-Server (S2S) authentication helper.
 *
 * Secures the S2S WebSocket channel using an Ed25519 public/private key pair with a
 * simple challenge-response handshake:
 *   1- The ACCEPTING side (holds the PUBLIC key) sends a random nonce challenge.
 *   2- The CONNECTING side (holds the PRIVATE key) signs the nonce and replies.
 *   3- The ACCEPTING side verifies the signature before trusting the peer.
 *
 * The Auth Server only ACCEPTS Communication Servers, so it uses the PUBLIC key.
 * No third-party dependency is used (Node built-in 'crypto').
 *
 * Config keys (in server config file):
 *   s2s_auth_enabled       : true/false   - enable the handshake on this node.
 *   s2s_trusted_server_keys: object       - mapping of server_id to public key file paths.
 *                                   Example: { "comm1": "./ssl/comm1_public.pem", "comm2": "./ssl/comm2_public.pem" }
 *
 * Key file paths are resolved relative to the repository root.
 */

const c_crypto = require('crypto');
const c_path = require('path');
const c_fs = require('fs');

const CONST_S2S_AUTH_CHALLENGE = 'challenge';
const CONST_S2S_AUTH_RESPONSE = 'response';
const CONST_S2S_AUTH_HANDSHAKE_TIMEOUT = 8000; // ms to complete handshake before drop.

let m_publicKeys = null;


/**
 * Returns true if S2S authentication is enabled in the config.
 */
function fn_isEnabled() {
    return global.m_serverconfig.m_configuration.s2s_auth_enabled === true;
}


function fn_resolvePath(p_path) {
    return c_path.resolve(__dirname, '..', p_path);
}


/**
 * Lazy-loads and caches the Ed25519 PUBLIC keys used to verify responses.
 * Returns an object mapping server_id to crypto PublicKey objects.
 */
function fn_getPublicKeys() {
    if (m_publicKeys != null) return m_publicKeys;

    const c_keys = global.m_serverconfig.m_configuration.s2s_trusted_server_keys;
    if (c_keys == null) {
        throw new Error("s2s_trusted_server_keys is not configured");
    }

    m_publicKeys = {};
    for (const v_serverId in c_keys) {
        const c_file = c_keys[v_serverId];
        const c_pem = c_fs.readFileSync(fn_resolvePath(c_file));
        m_publicKeys[v_serverId] = c_crypto.createPublicKey(c_pem);
    }

    return m_publicKeys;
}


/**
 * Generates a random nonce (challenge).
 */
function fn_generateNonce() {
    return c_crypto.randomBytes(32).toString('hex');
}


/**
 * Verifies a base64 signature against a nonce using the server-specific public key.
 * @param {string} p_nonce
 * @param {string} p_signature base64
 * @param {string} p_serverId the server ID to look up the public key for
 * @returns {boolean}
 */
function fn_verify(p_nonce, p_signature, p_serverId) {
    try {
        if ((p_nonce == null) || (p_signature == null) || (p_serverId == null)) return false;
        const c_keys = fn_getPublicKeys();
        const c_publicKey = c_keys[p_serverId];
        if (c_publicKey == null) {
            console.log(global.Colors.Error + "S2S verify error: unknown server_id " + p_serverId + global.Colors.Reset);
            return false;
        }
        return c_crypto.verify(null, Buffer.from(p_nonce), c_publicKey, Buffer.from(p_signature, 'base64'));
    }
    catch (ex) {
        console.log(global.Colors.Error + "S2S verify error: " + ex + global.Colors.Reset);
        return false;
    }
}


/**
 * Builds the challenge envelope (sent by the accepting side).
 * @param {string} p_nonce
 */
function fn_buildChallenge(p_nonce) {
    return JSON.stringify({ s2s_auth: CONST_S2S_AUTH_CHALLENGE, nonce: p_nonce });
}


/**
 * Parses a raw WS message (string or Buffer) into an S2S auth envelope.
 * Returns null if the message is not an S2S auth message (e.g. normal traffic).
 * @param {string|Buffer} p_msg
 */
function fn_parseEnvelope(p_msg) {
    try {
        if (Buffer.isBuffer(p_msg)) {
            if ((p_msg.length === 0) || (p_msg[0] !== 0x7b /* '{' */)) return null;
            p_msg = p_msg.toString('utf8');
        }
        if (typeof p_msg !== 'string') return null;
        const v_obj = JSON.parse(p_msg);
        if ((v_obj == null) || (v_obj.s2s_auth == null)) return null;
        return v_obj;
    }
    catch {
        return null;
    }
}


module.exports = {
    CONST_S2S_AUTH_CHALLENGE,
    CONST_S2S_AUTH_RESPONSE,
    CONST_S2S_AUTH_HANDSHAKE_TIMEOUT,
    fn_isEnabled,
    fn_generateNonce,
    fn_verify,
    fn_buildChallenge,
    fn_parseEnvelope
};
