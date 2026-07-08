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
const v_appVersion = require("./js_app_version");

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





/**
 * Main function to start Authentication Service.
 */
function fn_startServer() {
    console.log(global.Colors.Success + "[OK] Auth Server Started" + global.Colors.Reset);

    v_database_manager.fn_initialize();
    v_sessionManager.fn_initialize();
    v_account_manager.fn_initialize();
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
    p_version,
    p_extra,
    p_mustGCS,
    fn_callback,
    fn_error
) {
    const fields = v_inputValidator.normalizeLoginFields({
        accountName: p_accountName,
        accessCode: p_accessCode,
        actorType: p_actorType,
        group: p_group,
        app: p_app,
        version: p_version,
        extra: p_extra,
    });

    if (!v_inputValidator.validateLoginRequest(fields)) {
        invokeError(fn_error);
        return;
    }

    const versionReply = v_appVersion.checkAppVersion(fields.app, fields.version);
    if (versionReply != null) {
        fn_callback(versionReply);
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

            if (p_mustGCS === true && !v_sessionManager.fn_isGCS(p_loginCard)) {
                fn_callback(
                    buildPermissionError("No enough permission. This is not a GCS account.")
                );
                return;
            }

            if (p_mustGCS === false && !v_sessionManager.fn_isAGN(p_loginCard)) {
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
 */
function fn_accountOperation(
    p_subCommand,
    p_accountName,
    p_permission,
    p_accessCode,
    fn_callback,
    fn_error,
    p_sessionID
) {
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

    switch (p_subCommand) {
        case global.c_CONSTANTS.CONST_CMD_CREATE_ACCESSCODE:
            v_account_manager.fn_createAccessCode(
                trimmedAccount,
                trimmedPermission,
                function (p_reply) {
                    p_reply[global.c_CONSTANTS.CONST_SUB_COMMAND] =
                        global.c_CONSTANTS.CONST_CMD_CREATE_ACCESSCODE;
                    fn_callback(p_reply);
                },
                p_loginCard
            );
            break;
        case global.c_CONSTANTS.CONST_CMD_REGENERATE_ACCESSCODE:
            v_account_manager.fn_regenerateAccessCode(
                trimmedAccount,
                trimmedPermission,
                function (p_reply) {
                    p_reply[global.c_CONSTANTS.CONST_SUB_COMMAND] =
                        global.c_CONSTANTS.CONST_CMD_REGENERATE_ACCESSCODE;
                    fn_callback(p_reply);
                },
                p_loginCard
            );
            break;
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
 */
function fn_accountOperationFromAgent(
    p_subCommand,
    p_accountName,
    p_accessCode,
    p_app,
    p_version,
    p_extra,
    fn_callback,
    fn_error
) {
    if (!v_inputValidator.validateAgentMetadata({ app: p_app, version: p_version, extra: p_extra })) {
        invokeError(fn_error);
        return;
    }

    const versionReply = v_appVersion.checkAppVersion(p_app, p_version);
    if (versionReply != null) {
        versionReply[global.c_CONSTANTS.CONST_SUB_COMMAND] = p_subCommand;
        fn_callback(versionReply);
        return;
    }

    fn_accountOperation(p_subCommand, p_accountName, "0xffffffff", p_accessCode, fn_callback, fn_error);
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
