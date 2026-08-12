"use strict";

/**
 * Config Handler
 *
 * Processes special directives in the server configuration:
 *   - $$HASH$$('plaintext')  → replaced with a bcrypt hash
 *
 * On startup, the handler walks the parsed config object in memory and
 * replaces any $$HASH$$('...') string value with the corresponding bcrypt
 * hash.  It then persists those hashes back to the config FILE, replacing
 * only the $$HASH$$('...') substrings — all comments, whitespace, and
 * other values remain untouched.
 *
 * After the first run the file contains the raw hash directly, so
 * subsequent starts are a no-op.
 */

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const BCRYPT_SALT_ROUNDS = 10;

// Safe console helpers — global.Colors may not be available in all contexts
const C = {
    Log:     () => global.Colors ? global.Colors.Log     : '',
    Success: () => global.Colors ? global.Colors.Success : '',
    Error:   () => global.Colors ? global.Colors.Error   : '',
    Warn:    () => global.Colors ? global.Colors.FgYellow : ''
};

// In-memory pattern — after JSON.parse single and double quotes are
// indistinguishable, so accept either.
//   $$HASH$$('secret')   or   $$HASH$$("secret")
const HASH_PATTERN_MEMORY = /\$\$HASH\$\$\(\s*['"]([^'"]+)['"]\s*\)/;

// File-raw pattern — in the JSON file double quotes are escaped as \",
// so we must handle \"...\"  as well as '...'.
//   $$HASH$$('secret')     →  group 1
//   $$HASH$$(\"secret\")   →  group 2
//   $$HASH$$("secret")     →  group 2  (invalid JSON but tolerant)
const HASH_PATTERN_FILE = /\$\$HASH\$\$\(\s*(?:'([^']+)'|\\?"([^"\\]+)\\?")\s*\)/g;

/**
 * If *value* is a $$HASH$$('...') directive, return the extracted
 * plaintext password.  Otherwise return null.
 */
function extractHashDirective(value) {
    if (typeof value !== 'string') return null;
    const m = value.match(HASH_PATTERN_MEMORY);
    return m ? m[1] : null;
}

/**
 * Return true if *value* looks like a bcrypt hash.
 */
function isBcryptHash(value) {
    return typeof value === 'string' && /^\$2[abxy]\$\d{2}\$/.test(value);
}

/**
 * Walk a config object (one level deep) and replace every
 * $$HASH$$('...') string value with a bcrypt hash in-place.
 * Returns true if at least one value was changed.
 */
function processConfigInMemory(config) {
    let changed = false;
    for (const key of Object.keys(config)) {
        const val = config[key];
        if (typeof val !== 'string') continue;

        const plaintext = extractHashDirective(val);
        if (plaintext === null) continue;

        const hash = bcrypt.hashSync(plaintext, BCRYPT_SALT_ROUNDS);
        config[key] = hash;
        changed = true;
        console.log(C.Log() +
            '[ConfigHandler] Hashed sensitive config value: ' + key +
            (global.Colors ? global.Colors.Reset : ''));
    }
    return changed;
}

/**
 * Read the raw config file text and replace every $$HASH$$('...') literal
 * with the computed bcrypt hash string.  Only the directive substring is
 * replaced — surrounding quotes, comments, whitespace and all other values
 * are preserved exactly as-is.
 *
 * Returns true if the file was modified.
 */
function persistHashes(configFilePath) {
    let raw;
    try {
        raw = fs.readFileSync(configFilePath, 'utf8');
    } catch (err) {
        console.error(C.Error() +
            '[ConfigHandler] Cannot read config file for persistence: ' +
            err.message + (global.Colors ? global.Colors.Reset : ''));
        return false;
    }

    let changed = false;
    const updated = raw.replace(HASH_PATTERN_FILE, function (match, sq, dq) {
        const plaintext = sq !== undefined ? sq : dq;
        if (!plaintext) return match;
        changed = true;
        return bcrypt.hashSync(plaintext, BCRYPT_SALT_ROUNDS);
    });

    if (!changed) return false;

    try {
        fs.writeFileSync(configFilePath, updated, 'utf8');
        console.log(C.Success() +
            '[ConfigHandler] Config file updated — hashed values persisted.' +
            (global.Colors ? global.Colors.Reset : ''));
    } catch (err) {
        console.error(C.Error() +
            '[ConfigHandler] Failed to write config file: ' + err.message +
            (global.Colors ? global.Colors.Reset : ''));
    }
    return changed;
}

/**
 * Entry point — call right after the config is parsed.
 * Replaces $$HASH$$ directives in memory, then persists to disk.
 */
function handleConfig(config, configFilePath) {
    const changed = processConfigInMemory(config);
    if (changed) {
        persistHashes(configFilePath);
    }
}

module.exports = {
    handleConfig,
    processConfigInMemory,
    persistHashes,
    extractHashDirective,
    isBcryptHash,
    HASH_PATTERN_MEMORY
};
