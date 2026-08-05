"use strict";

const c_CONSTANTS = require("../js_constants");
const hlp_string = require("../helpers/hlp_string");

function trim(value) {
    return value == null ? value : value.trim();
}

function isInvalidLoginId(accountName) {
    return accountName == null || !hlp_string.fn_isValidAccountName(accountName);
}

function exceedsMaxLength(value, maxLength) {
    return value != null && value.length > maxLength;
}

function isInvalidAlphanumeric(value, maxLength) {
    return value == null || !hlp_string.fn_isAlphanumeric(value) || exceedsMaxLength(value, maxLength);
}

function validateLoginRequest({
    accountName,
    accessCode,
    actorType,
    group,
    app,
    version,
    extra,
}) {
    const trimmedAccount = trim(accountName);
    const trimmedAccessCode = trim(accessCode);

    if (actorType == null || actorType.length !== 1) {
        return false;
    }
    if (isInvalidLoginId(trimmedAccount)) {
        return false;
    }
    if (isInvalidAlphanumeric(trimmedAccessCode, c_CONSTANTS.CONST_ACCESSCODE_MAX_LENGTH)) {
        return false;
    }
    if (isInvalidAlphanumeric(group, c_CONSTANTS.CONST_ACCESSCODE_MAX_LENGTH)) {
        return false;
    }
    if (isInvalidAlphanumeric(app, c_CONSTANTS.CONST_ACCESSCODE_MAX_LENGTH)) {
        return false;
    }
    if (version == null || !hlp_string.fn_isVersionFormat(version)) {
        return false;
    }
    if (extra == null || !hlp_string.fn_isAlphanumericSentence(extra)) {
        return false;
    }

    return true;
}

function validateAccountOperation({
    subCommand,
    accountName,
    permission,
    accessCode,
}) {
    if (subCommand == null || subCommand.length > 3) {
        return false;
    }
    if (accountName == null && accessCode == null) {
        return false;
    }

    const trimmedAccount = trim(accountName);
    if (trimmedAccount != null && !hlp_string.fn_isValidAccountName(trimmedAccount)) {
        return false;
    }
    if (permission == null || typeof permission !== "string") {
        return false;
    }

    const trimmedAccessCode = trim(accessCode);
    if (trimmedAccessCode != null && !hlp_string.fn_isAlphanumeric(trimmedAccessCode)) {
        return false;
    }

    return true;
}

function validateAgentMetadata({ app, version, extra }) {
    if (app == null || typeof app !== "string" || !hlp_string.fn_isAlphanumeric(app)) {
        return false;
    }
    if (version == null || !hlp_string.fn_isVersionFormat(version)) {
        return false;
    }
    if (extra == null || !hlp_string.fn_isAlphanumericSentence(extra)) {
        return false;
    }
    return true;
}

function validateHardwareOperation({ sessionID, subCommand, hardwareID, hardwareType }) {
    if (sessionID == null || typeof sessionID !== "string" || !hlp_string.fn_isAlphanumeric(sessionID)) {
        return false;
    }
    if (subCommand == null || typeof subCommand !== "string" || !hlp_string.fn_isAlphanumeric(subCommand)) {
        return false;
    }
    if (hardwareID == null || typeof hardwareID !== "string" || !hlp_string.fn_isAlphanumeric(hardwareID)) {
        return false;
    }
    if (hardwareType == null || typeof hardwareType !== "string" || !hlp_string.fn_isAlphanumeric(hardwareType)) {
        return false;
    }
    return true;
}

function validateSessionID(sessionID) {
    return (
        sessionID != null &&
        hlp_string.fn_isAlphanumeric(sessionID) &&
        !exceedsMaxLength(sessionID, c_CONSTANTS.CONST_SESSION_MAX_LENGTH)
    );
}

function normalizeLoginFields(fields) {
    return {
        accountName: trim(fields.accountName),
        accessCode: trim(fields.accessCode),
        actorType: fields.actorType,
        group: fields.group,
        app: fields.app,
        version: fields.version,
        extra: fields.extra,
    };
}

module.exports = {
    trim,
    validateLoginRequest,
    validateAccountOperation,
    validateAgentMetadata,
    validateHardwareOperation,
    validateSessionID,
    normalizeLoginFields,
};
