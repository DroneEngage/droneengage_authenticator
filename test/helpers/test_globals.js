"use strict";

/**
 * Test harness helpers for the Auth Server.
 *
 * Minimal fake globals needed for unit testing without a live server.
 */

const GLOBAL_KEYS = [
    'm_serverconfig',
    'm_logger',
    'Colors'
];

let v_saved = null;

function installFakeGlobals(p_config) {
    if (v_saved === null) {
        v_saved = {};
        for (const c_key of GLOBAL_KEYS) {
            v_saved[c_key] = Object.prototype.hasOwnProperty.call(global, c_key)
                ? { present: true, value: global[c_key] }
                : { present: false };
        }
    }

    const c_harness = {
        config: Object.assign({
            server_id: 'AuthTest'
        }, p_config || {})
    };

    global.m_serverconfig = { m_configuration: c_harness.config };
    global.m_logger = null;
    global.Colors = { Error: '', Reset: '' };

    return c_harness;
}

function restoreGlobals() {
    if (v_saved === null) return;
    for (const c_key of GLOBAL_KEYS) {
        const c_entry = v_saved[c_key];
        if (c_entry.present) {
            global[c_key] = c_entry.value;
        } else {
            delete global[c_key];
        }
    }
    v_saved = null;
}

module.exports = {
    installFakeGlobals,
    restoreGlobals
};
