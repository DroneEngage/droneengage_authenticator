/*
################RELEASE NOTES
## Last update 22 Dec 2013 adding Message Display and version
## Last update 29 Dec 2014 adding URL decode -- version 1.0.18 Andruav
## Last Update 22 Jan 2015 adding multiple server serving.... cancelled later as not useful ... as same SID needs same process.
## Last Update 23 Jan 2015 converting to python. Load balancing 

##Last Update 08 Sep 2015 converting to NodeJS. Load balancing.
##Last Update 12 Apr 2016 reply messages are in JSON.
##Last Update 30 APr 2016 disable email notification when adding nemail=true 
##Last Update 22 May 2016 sending back a url hen changing AccessCode. if a cb back is passed. 
##Last update 02 Jun 2016 andother back url function when retrieving andruav code.
##Last update 04 Jun 2016 enable HTTPS Server.
##Last update 05 Jun 2016 Subscription message Editing
##Last Update 09 Jul 2016 Offline Message Support
##Last Update 03 Aug 2016 .replaceAll() to avoid SQL Injection
##Last Update 03 Sep 2016 fixing multiservers [EXTERNAL Module]
##Last Update 13 Apr 2017 Access Codes. with permissions.
##Last Update 21 Jul 2017 UDP Sockets with Andruav Servers
##Last Update 16 Nov 2017 SID is encrypted by Keys 
## http://www.andruav.com/www/createaccount.php?cmd=c&acc=rcmobilestuff@gmail.com

MAJOR CHANGE Sep 2019: change app structure and add EXPRESS Server

*/

"use strict";

const v_commServerManagerServer = require("./js_comm_server_manager_server");
const v_commServerManager = require("./js_comm_server_manager");
const v_sessionManager = require("./js_session_manager");
const v_account_manager = require("./js_account_manager");
const v_database_manager = require("./js_database_manager");
const v_inputValidator = require("./js_input_validator");
const hlp_password = require("droneengage_server_common").password;

function invokeError(fn_error) {
    if (fn_error != null) {
        fn_error();
    }
}

function buildPermissionError(message) {
    const ret = {};
    ret[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_NO_PERMISSION;
    ret[global.c_CONSTANTS.CONST_ERROR_MSG.toString()] = message;
    return ret;
}

function buildServerUnavailableError() {
    const ret = {};
    ret[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_SERVER_NOT_AVAILABLE;
    ret[global.c_CONSTANTS.CONST_ERROR_MSG.toString()] = "No available Server";
    return ret;
}

function buildAccountNotFoundError() {
    const ret = {};
    ret[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_ACCOUNT_NOT_FOUND;
    ret[global.c_CONSTANTS.CONST_ERROR_MSG.toString()] = "Account Not Found.";
    return ret;
}

function buildSingleModeError() {
    const ret = {};
    ret[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_NOT_SUPPORTED_SINGLE_MODE;
    ret[global.c_CONSTANTS.CONST_ERROR_MSG.toString()] = "Account create/regenerate is not supported in single-account mode.";
    return ret;
}

/**
 * Normalize a permission value (number or hex string) into a hex string,
 * so it can be passed back to the storage layer which expects strings.
 */
function fn_normalizePermissionToHex(p_permission) {
    if (p_permission == null) return null;
    if (typeof p_permission === "number") {
        return "0x" + (p_permission >>> 0).toString(16);
    }
    return String(p_permission);
}

/**
 * Verify the caller owns/controls the target account before a credential
 * rotation. Proof accepted (any one):
 *  (a) A live session whose login card identifies the same account
 *      (p_loginCard.m_login_name === p_accountName) — skips the AccessCode
 *      check.
 *  (b) The correct current AccessCode for the account, verified against the
 *      stored hash via the same path the login flow uses.
 * On success, also returns the account's existing stored permission so the
 * caller can preserve it (regenerate must not change the grant).
 *
 * Callback shape: { proven: bool, existingPermission: string|null, error: obj|null }
 */
function fn_verifyAccountOwnership(p_accountName, p_accessCode, p_loginCard, fn_callback) {
    // (a) Session-based ownership: a live session for the same account is
    // sufficient proof and skips the AccessCode check.
    if (p_loginCard != null && p_loginCard.m_login_name === p_accountName) {
        const c_existingPerm = fn_normalizePermissionToHex(
            p_loginCard.m_data != null ? p_loginCard.m_data.m_prm : null
        );
        fn_callback({ proven: true, existingPermission: c_existingPerm, error: null });
        return;
    }

    const c_storageType = (global.m_serverconfig.m_configuration.account_storage_type || "").toLowerCase();

    if (c_storageType === "single") {
        fn_callback({ proven: false, existingPermission: null, error: buildSingleModeError() });
        return;
    }

    if (c_storageType === "file") {
        const c_record = global.db_users.fn_get_record(p_accountName);
        if (c_record == null) {
            fn_callback({ proven: false, existingPermission: null, error: buildAccountNotFoundError() });
            return;
        }
        const c_storedCode = c_record.AccessCode || c_record.pwd;
        if (!p_accessCode || hlp_password.verify(p_accessCode, c_storedCode) !== true) {
            fn_callback({
                proven: false,
                existingPermission: null,
                error: buildPermissionError("Wrong or missing access code. Cannot regenerate account credential."),
            });
            return;
        }
        fn_callback({ proven: true, existingPermission: c_record.prm, error: null });
        return;
    }

    if (c_storageType === "db") {
        if (!p_accessCode) {
            fn_callback({
                proven: false,
                existingPermission: null,
                error: buildPermissionError("Wrong or missing access code. Cannot regenerate account credential."),
            });
            return;
        }
        v_database_manager.fn_do_loginAccount(p_accountName, p_accessCode, function (p_reply) {
            if (p_reply[global.c_CONSTANTS.CONST_ERROR.toString()] !== global.c_CONSTANTS.CONST_ERROR_NON) {
                fn_callback({ proven: false, existingPermission: null, error: p_reply });
                return;
            }
            fn_callback({ proven: true, existingPermission: p_reply.m_data.m_prm, error: null });
        });
        return;
    }

    fn_callback({
        proven: false,
        existingPermission: null,
        error: buildPermissionError("Unsupported account storage type."),
    });
}


/**
 * Look up the stored permission for an account WITHOUT requiring the
 * access code. Used by the public web regenerate path ("forgot my access
 * code" flow) to preserve the existing permission. Returns '0xffffffff'
 * as a safe default if the account is not found.
 */
function fn_getExistingPermission(p_accountName, fn_callback) {
    const c_storageType = (global.m_serverconfig.m_configuration.account_storage_type || "").toLowerCase();

    if (c_storageType === "file") {
        const c_record = global.db_users.fn_get_record(p_accountName);
        if (c_record == null) {
            fn_callback('0xffffffff');
            return;
        }
        let perm = c_record.prm;
        if (perm == null || perm === 'D1G1T3R4V5C6') perm = '0xffffffff';
        fn_callback(perm);
        return;
    }

    if (c_storageType === "db") {
        v_database_manager.fn_getAccountPermission(p_accountName, fn_callback);
        return;
    }

    fn_callback('0xffffffff');
}





/**
 * Main function to start Authentication Service.
 */
function fn_startServer() {
    console.log(global.Colors.Success + "[OK] Auth Server Started" + global.Colors.Reset);

    v_database_manager.fn_initialize();
    v_sessionManager.fn_initialize();
    v_commServerManager.fn_initialize();
    v_commServerManagerServer.fn_onMessageReceived = v_commServerManager.fn_commServerMessageHandler;
    v_commServerManagerServer.fn_onServerClosed = v_commServerManager.fn_ServerUpdated;
    v_commServerManager.fn_sendMessage = v_commServerManagerServer.fn_sendMessage;

    v_commServerManagerServer.fn_startServer();
}


/**
 * Request creating a new login card.
 */
function fn_newLoginCard(
    p_accountName,
    p_accessCode,
    p_actorType,
    p_group,
    p_app,
    p_extra,
    p_login_as_GCS,
    fn_callback,
    fn_error
) {
    const fields = v_inputValidator.normalizeLoginFields({
        accountName: p_accountName,
        accessCode: p_accessCode,
        actorType: p_actorType,
        group: p_group,
        app: p_app,
        extra: p_extra,
    });

    if (!v_inputValidator.validateLoginRequest(fields)) {
        invokeError(fn_error);
        return;
    }

    v_sessionManager.fn_createLoginCard(
        fields.accountName,
        fields.accessCode,
        fields.actorType,
        fields.group,
        function (p_loginCard) {
            if (p_loginCard[global.c_CONSTANTS.CONST_ERROR] !== 0) {
                fn_callback(p_loginCard);
                return;
            }

            if (p_login_as_GCS === true && !v_sessionManager.fn_isGCSLogin(p_loginCard)) {
                fn_callback(
                    buildPermissionError("No enough permission. This is not a GCS account.")
                );
                return;
            }

            // View-mode normalization: a view-mode GCS account (bit 29 set)
            // is clamped to exactly 0xa0000000 (GCS login + view mode) so a
            // misconfigured admin cannot sneak control/category bits into a
            // read-only account. The comm server's per-bit map already
            // rejects all mapped actions for a no-category-bit account, and
            // the WebClient helpers override to false in view mode; this
            // clamp is defense-in-depth at the source of truth.
            if (p_login_as_GCS === true && v_sessionManager.fn_isViewMode(p_loginCard)) {
                p_loginCard.m_data.m_prm = (0x80000000 | 0x20000000) >>> 0;
            }

            if (p_login_as_GCS === false && !v_sessionManager.fn_isUnitLogin(p_loginCard)) {
                fn_callback(
                    buildPermissionError("No enough permission. This is not a GCS account.")
                );
                return;
            }

            const c_selectedServer = v_commServerManager.fn_selectServerforAccount(p_loginCard);
            if (c_selectedServer == null) {
                fn_callback(buildServerUnavailableError());
                return;
            }

            v_commServerManager.fn_requestCommunicationLogin(
                p_loginCard,
                c_selectedServer,
                function (p_andruavServerReply) {
                    const c_reply = v_sessionManager.fn_generateLoginReplyToParty(p_andruavServerReply);
                    fn_callback(c_reply);
                },
                function () {
                    const c_ret = {};
                    c_ret[global.c_CONSTANTS.CONST_ERROR.toString()] =
                        global.c_CONSTANTS.CONST_ERROR_SERVER_NOT_AVAILABLE;
                    fn_callback(c_ret);
                }
            );
        }
    );
}


/**
 * Entrance to all operations with account manager.
 *
 * Authorization rules applied here (the single choke point both routers funnel
 * through):
 *  - CREATE_ACCESSCODE: the caller's requested permission is honoured. This
 *    is safe because CREATE can only mint a brand-new account — both storage
 *    backends reject duplicates (db: SQLITE_CONSTRAINT, file: duplicate
 *    check), so there is no takeover vector. The caller IS the owner of the
 *    new account and full control (0xffffffff) is appropriate for the public
 *    registration page. The agent path (fn_accountOperationFromAgent) passes
 *    CONST_DEFAULT_SELF_SERVICE_PERMISSION explicitly, so vehicles still get
 *    the limited bitmask.
 *  - REGENERATE_ACCESSCODE: when p_enforceOwnership is true (agent path),
 *    the caller must prove ownership — a live session for the same account OR
 *    the correct current AccessCode. When p_enforceOwnership is falsy (public
 *    web path), the ownership check is skipped — the "Regenerate" button on
 *    the public accounts page is the "forgot my access code" flow, gated by
 *    captcha + rate limiting. In both cases the client-supplied permission
 *    is ignored and the account's existing stored permission is preserved
 *    (rotating a credential must not silently escalate the grant).
 *  - GET_ACCOUNT_NAME: unchanged (requires the AccessCode to look up the
 *    owning account — the credential itself is the proof).
 *  - single-account mode: create/regenerate return a prompt error (there is
 *    no team/account model to operate against); get is unaffected.
 *
 * For team-admin sub-commands (ltu/atu/utu/dtu/gti) the caller's session is
 * the credential: p_sessionID resolves the login card, and the card's TeamID
 * + isadmin flag gate the operation.  p_targetLoginName and p_isAdmin carry
 * the target login and admin flag for add/edit.
 */
function fn_accountOperation(
    p_subCommand,
    p_accountName,
    p_permission,
    p_accessCode,
    fn_callback,
    fn_error,
    p_sessionID,
    p_targetLoginName,
    p_isAdmin,
    p_enforceOwnership
) {
    const C = global.c_CONSTANTS;

    // Team-admin sub-commands use the session as the credential and do not
    // need the legacy accountName/accessCode validation path.
    const c_isTeamAdminCmd =
        p_subCommand === C.CONST_CMD_LIST_TEAM_USERS ||
        p_subCommand === C.CONST_CMD_ADD_TEAM_USER ||
        p_subCommand === C.CONST_CMD_UPDATE_TEAM_USER ||
        p_subCommand === C.CONST_CMD_DELETE_TEAM_USER ||
        p_subCommand === C.CONST_CMD_GET_TEAM_INFO;

    if (c_isTeamAdminCmd) {
        // Resolve the caller's login card from the session.
        const c_loginCard = v_sessionManager.fn_getLoginCardBySessionID(p_sessionID);
        if (c_loginCard == null) {
            const c_reply = {};
            c_reply[C.CONST_ERROR_MSG.toString()] = 'Session not found.';
            c_reply[C.CONST_ERROR.toString()] = C.CONST_ERROR_SESSION_NOT_FOUND;
            c_reply[C.CONST_SUB_COMMAND.toString()] = p_subCommand;
            fn_callback(c_reply);
            return;
        }

        v_account_manager.fn_teamUserOperation(
            p_subCommand,
            c_loginCard,
            {
                targetLoginName: p_targetLoginName || p_accountName,
                permission: p_permission,
                accessCode: p_accessCode,
                isAdmin: p_isAdmin,
            },
            function (p_reply) {
                p_reply[C.CONST_SUB_COMMAND.toString()] = p_subCommand;
                fn_callback(p_reply);
            }
        );
        return;
    }

    if (
        !v_inputValidator.validateAccountOperation({
            subCommand: p_subCommand,
            accountName: p_accountName,
            permission: p_permission,
            accessCode: p_accessCode,
        })
    ) {
        invokeError(fn_error);
        return;
    }

    const trimmedAccount = v_inputValidator.trim(p_accountName);
    const trimmedPermission = p_permission.trim();
    const trimmedAccessCode = v_inputValidator.trim(p_accessCode);
    const p_loginCard = v_sessionManager.fn_getLoginCardBySessionID(p_sessionID);

    const c_storageType = (global.m_serverconfig.m_configuration.account_storage_type || "").toLowerCase();

    switch (p_subCommand) {
        case global.c_CONSTANTS.CONST_CMD_CREATE_ACCESSCODE: {
            // single-account mode has no team/account model to create against.
            if (c_storageType === "single") {
                fn_callback(buildSingleModeError());
                return;
            }

            // CREATE always mints a brand-new account — both storage backends
            // (db: SQLITE_CONSTRAINT on duplicate TeamName, file: duplicate
            // check in fn_add_record) reject creating over an existing one.
            // So there is no takeover risk in honouring the caller's requested
            // permission: the caller IS the owner of the new account.
            // The agent path (fn_accountOperationFromAgent) passes
            // CONST_DEFAULT_SELF_SERVICE_PERMISSION explicitly, so vehicles
            // still get the limited bitmask regardless of this branch.
            let c_effectivePermission = trimmedPermission;
            if (!c_effectivePermission) {
                c_effectivePermission = '0xffffffff';
            }

            v_account_manager.fn_createAccessCode(
                trimmedAccount,
                c_effectivePermission,
                function (p_reply) {
                    p_reply[global.c_CONSTANTS.CONST_SUB_COMMAND] =
                        global.c_CONSTANTS.CONST_CMD_CREATE_ACCESSCODE;
                    fn_callback(p_reply);
                },
                p_loginCard
            );
            break;
        }
        case global.c_CONSTANTS.CONST_CMD_REGENERATE_ACCESSCODE: {
            // single-account mode has no team/account model to regenerate against.
            if (c_storageType === "single") {
                fn_callback(buildSingleModeError());
                return;
            }

            // The agent path (p_enforceOwnership === true) must prove ownership
            // before the credential can be rotated — a live session for the
            // same account OR the correct current AccessCode.
            // The public web path (p_enforceOwnership !== true) skips the
            // ownership check: the "Regenerate" button on the public accounts
            // page is the "forgot my access code" flow, gated by captcha +
            // rate limiting. The existing stored permission is always
            // preserved (regenerating must not silently escalate the grant).
            const c_doRegenerate = function (p_existingPermission) {
                v_account_manager.fn_regenerateAccessCode(
                    trimmedAccount,
                    p_existingPermission,
                    function (p_reply) {
                        p_reply[global.c_CONSTANTS.CONST_SUB_COMMAND] =
                            global.c_CONSTANTS.CONST_CMD_REGENERATE_ACCESSCODE;
                        fn_callback(p_reply);
                    }
                );
            };

            if (p_enforceOwnership === true) {
                fn_verifyAccountOwnership(trimmedAccount, trimmedAccessCode, p_loginCard, function (p_result) {
                    if (!p_result.proven) {
                        fn_callback(p_result.error || buildPermissionError("Ownership verification failed."));
                        return;
                    }
                    c_doRegenerate(p_result.existingPermission);
                });
            } else {
                // Public web path: look up the existing permission to preserve it.
                fn_getExistingPermission(trimmedAccount, function (p_perm) {
                    c_doRegenerate(p_perm);
                });
            }
            break;
        }
        case global.c_CONSTANTS.CONST_CMD_GET_ACCOUNT_NAME:
            v_account_manager.fn_getAccountNameByAccessCode(
                trimmedAccessCode,
                function (p_reply) {
                    p_reply[global.c_CONSTANTS.CONST_SUB_COMMAND] =
                        global.c_CONSTANTS.CONST_CMD_GET_ACCOUNT_NAME;
                    fn_callback(p_reply);
                },
                p_loginCard
            );
            break;
    }
}


/**
 * Called by agent and calls are forward to fn_accountOperation.
 *
 * The agent path has no session parameter today. It always passes
 * CONST_DEFAULT_SELF_SERVICE_PERMISSION as the permission, so agent-created
 * accounts get the limited bitmask (no GCS_LOGIN bit — vehicles login as
 * units, not as GCS). Regenerate must prove ownership via the current
 * AccessCode (fn_accountOperation ignores the permission for regenerate in
 * favour of the preserved existing permission).
 */
function fn_accountOperationFromAgent(
    p_subCommand,
    p_accountName,
    p_accessCode,
    p_app,
    p_extra,
    fn_callback,
    fn_error
) {
    if (!v_inputValidator.validateAgentMetadata({ app: p_app, extra: p_extra })) {
        invokeError(fn_error);
        return;
    }

    fn_accountOperation(
        p_subCommand,
        p_accountName,
        global.c_CONSTANTS.CONST_DEFAULT_SELF_SERVICE_PERMISSION,
        p_accessCode,
        fn_callback,
        fn_error,
        null,       // p_sessionID — agent path has no session
        null,       // p_targetLoginName
        null,       // p_isAdmin
        true        // p_enforceOwnership — agent must prove ownership for regenerate
    );
}


/**
 * Hardware verification operations from agent clients.
 */
function fn_hardwareOperationFromAgent(
    p_subCommand,
    p_sessionID,
    p_hardwareID,
    p_hardwareType,
    fn_callback,
    fn_error
) {
    if (
        !v_inputValidator.validateHardwareOperation({
            sessionID: p_sessionID,
            subCommand: p_subCommand,
            hardwareID: p_hardwareID,
            hardwareType: p_hardwareType,
        })
    ) {
        invokeError(fn_error);
        return;
    }

    switch (p_subCommand) {
        case global.c_CONSTANTS.CONST_CMD_VERIFY_HARDWARE_BY_ID: {
            const c_accountSID = v_sessionManager.fn_getLoginCardBySessionID(p_sessionID);
            if (c_accountSID == null) {
                const c_reply = {};
                c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] = "No hardware is found.";
                c_reply[global.c_CONSTANTS.CONST_ERROR.toString()] =
                    global.c_CONSTANTS.CONST_ERROR_SESSION_NOT_FOUND;
                fn_callback(c_reply);
                return;
            }

            v_account_manager.fn_do_verifyHardwareByAccountSID(
                c_accountSID.m_data.m_sid,
                p_hardwareID,
                p_hardwareType,
                function (p_andruavServerReply) {
                    fn_callback(p_andruavServerReply);
                },
                function () {
                    const c_ret = {};
                    c_ret[global.c_CONSTANTS.CONST_ERROR.toString()] =
                        global.c_CONSTANTS.CONST_ERROR_SERVER_NOT_AVAILABLE;
                    fn_callback(c_ret);
                }
            );
            break;
        }
    }
}

/**
 * Invalidates Session, and signal other servers to invalidate related connections.
 * @param {*} p_sessionID 
 * @param {*} fn_Success 
 * @param {*} fn_error 
 */
function fn_logout(p_sessionID, fn_Success, fn_error) {
    if (!v_inputValidator.validateSessionID(p_sessionID)) {
        invokeError(fn_error);
        return;
    }

    const c_loginCard = v_sessionManager.fn_getLoginCardBySessionID(p_sessionID);
    if (c_loginCard == null) {
        invokeError(fn_error);
        return;
    }

    v_commServerManager.fn_removePartyCommunicationSession(c_loginCard);
    v_sessionManager.fn_deleteOldCard(c_loginCard.m_session_id);

    if (fn_Success != null) {
        const c_rep = {};
        c_rep[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_NON;
        fn_Success(c_rep);
    }
}

module.exports = {
    fn_startServer: fn_startServer,
    fn_newLoginCard: fn_newLoginCard,
    fn_logout: fn_logout,
    fn_accountOperation: fn_accountOperation,
    fn_accountOperationFromAgent: fn_accountOperationFromAgent,
    fn_hardwareOperationFromAgent: fn_hardwareOperationFromAgent,
};  
