"use strict";
const { v4: uuidv4 } = require('uuid');
const _common = require("droneengage_server_common");
const hlp_string = _common.helpers.strings;
const hlp_password = _common.password;
const v_database_manager = require("./js_database_manager");


/**
 * generates random string
 */
function fn_generateAccessCode() {
    return uuidv4().replaceAll('-', '').substr(0, 12);
}


/**
 *
 * @param {*} p_accountName
 * @param {*} p_permission
 * @param {*} fn_callback
 */
function fn_createAccessCode(p_accountName, p_permission, fn_callback, p_loginCard) {

    const v_accessCode = fn_generateAccessCode();

    if (p_permission == null) p_permission = '0xffffffff';

    if (m_serverconfig.m_configuration.account_storage_type.toLowerCase() === 'file') {

        global.db_users.fn_add_record(p_accountName, {
            sid: fn_generateAccessCode(),
            AccessCode: v_accessCode,
            prm: p_permission
        }, function (p_reply) {
            p_reply[global.c_CONSTANTS.CONST_ACCESS_CODE_PARAMETER.toString()] = v_accessCode;
            fn_callback(p_reply);
        });
    }
    else if (m_serverconfig.m_configuration.account_storage_type.toLowerCase() === 'db') {

        // Define a new account.
        v_database_manager.fn_createNewAccessCode(p_accountName, v_accessCode,
            function (p_reply) {

                if (p_reply[global.c_CONSTANTS.CONST_ERROR.toString()] != global.c_CONSTANTS.CONST_ERROR_NON) {
                    fn_callback(p_reply);
                    return;
                }
                else {
                    // Create sub login account that is used by andruav for actual login. 


                    v_database_manager.fn_createSubLogin(p_accountName, v_accessCode, p_permission,
                        function (p_reply) {
                            p_reply[global.c_CONSTANTS.CONST_ACCESS_CODE_PARAMETER.toString()] = v_accessCode;
                            fn_callback(p_reply);
                        });
                }
            }
            , p_loginCard);
    }

}


/**
 * Generates new access code.
 * This deletes all accout sub-logins, and create a new one.
 * @param {*} p_accountName 
 * @param {*} p_permission
 * @param {*} fn_callback 
 */
function fn_regenerateAccessCode(p_accountName, p_permission, fn_callback) {
    const v_accessCode = fn_generateAccessCode();

    if (m_serverconfig.m_configuration.account_storage_type.toLowerCase() === 'file') {

        global.db_users.fn_update_record(p_accountName, {
            sid: fn_generateAccessCode(),
            AccessCode: v_accessCode,
            prm: p_permission
        }, function (p_reply) {
            p_reply[global.c_CONSTANTS.CONST_ACCESS_CODE_PARAMETER.toString()] = v_accessCode;
            fn_callback(p_reply);
        });
    }
    else if (m_serverconfig.m_configuration.account_storage_type.toLowerCase() === 'db') {

        // Define a new account.
        v_database_manager.fn_deleteSubLogins(p_accountName, p_permission,
            function (p_reply) {

                if (p_reply[global.c_CONSTANTS.CONST_ERROR.toString()] != global.c_CONSTANTS.CONST_ERROR_NON) {
                    fn_callback(p_reply);
                }
                else {
                    // Create sub login account that is used by andruav for actual login. 
                    if (p_permission == null) p_permission = '0xffffffff';
                    v_database_manager.fn_createSubLogin(p_accountName, v_accessCode, p_permission,
                        function (p_reply) {
                            p_reply[global.c_CONSTANTS.CONST_ACCESS_CODE_PARAMETER.toString()] = v_accessCode;
                            fn_callback(p_reply);
                        });
                }
            });
    }
}

/**
 * Retrieve user name or email using access code.
 * Please note that multiple access code may exist for the same username.
 * @param {*} p_accessCode 
 * @param {*} fn_callback 
 */
function fn_getAccountNameByAccessCode(p_accessCode, fn_callback) {
    const p_reply = {};

    if (m_serverconfig.m_configuration.account_storage_type.toLowerCase() === 'single') {
        // use single logic account
        if ((m_serverconfig.m_configuration.hasOwnProperty('single_account_user_name') === true)
            && (m_serverconfig.m_configuration.hasOwnProperty('single_account_access_code') === true)) {

            if (hlp_password.verify(p_accessCode, m_serverconfig.m_configuration.single_account_access_code) !== true) {
                p_reply[global.c_CONSTANTS.CONST_ERROR_MSG] = "Account Not Found.";
                p_reply[global.c_CONSTANTS.CONST_ERROR] = global.c_CONSTANTS.CONST_ERROR_ACCOUNT_NOT_FOUND;
                fn_callback(p_reply);
                return;
            }

            p_reply[global.c_CONSTANTS.CONST_ACCOUNT_NAME_PARAMETER.toString()] = m_serverconfig.m_configuration.single_account_user_name;
            p_reply[global.c_CONSTANTS.CONST_ERROR] = global.c_CONSTANTS.CONST_ERROR_NON;
            fn_callback(p_reply);

            return;
        }

        return;
    }

    if (m_serverconfig.m_configuration.account_storage_type.toLowerCase() === 'file') {
        if (m_serverconfig.m_configuration.hasOwnProperty('file_db') === true) {

            const account_record = global.db_users.fn_get_user_by_accesscode(p_accessCode);
            if (account_record == null) {

                p_reply[global.c_CONSTANTS.CONST_ERROR_MSG] = "Account Not Found.";
                p_reply[global.c_CONSTANTS.CONST_ERROR] = global.c_CONSTANTS.CONST_ERROR_ACCOUNT_NOT_FOUND;
                fn_callback(p_reply);
                return;
            }

            p_reply[global.c_CONSTANTS.CONST_ACCOUNT_NAME_PARAMETER.toString()] = account_record.acc;
            p_reply[global.c_CONSTANTS.CONST_ERROR] = global.c_CONSTANTS.CONST_ERROR_NON;
            fn_callback(p_reply);

            return;

        }
    }

    if (m_serverconfig.m_configuration.account_storage_type.toLowerCase() === 'db') {

        // login via database
        v_database_manager.fn_do_getAccountNameByAccessCode(p_accessCode,
            function (p_reply) {
                if (p_reply[global.c_CONSTANTS.CONST_ERROR.toString()] != global.c_CONSTANTS.CONST_ERROR_NON) {
                    fn_callback(p_reply);


                }
                else {
                    const c_reply = {};
                    c_reply[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_NON;
                    c_reply[global.c_CONSTANTS.CONST_ACCOUNT_NAME_PARAMETER.toString()] = p_reply.m_data.m_accountName;
                    fn_callback(c_reply);
                }
            });

        return;
    }

    console.log(global.Colors.BError + "FATAL ERROR:" + global.Colors.FgYellow + " account_storage_type or file_db or db connection" + global.Colors.Reset + " are not specified in config file. ");
}


/**
 * Retrieves account associated hardware and compare given hardware gievn on and returns uccess if found valid.
 * @param {*} p_accountSID Account_SID
 * @param {*} p_hardwareID HardwareID
 * @param {*} p_hardwareType type: cpu, generated, ...etc.
 * @param {*} fn_callback call back to http response.
 */
function fn_do_verifyHardwareByAccountSID(p_accountSID, p_hardwareID, p_hardwareType, fn_callback) {
    // Skip hardware validation if explicitly enabled in config
    if (global.m_serverconfig.m_configuration.skip_hardware_validation !== false) {
        const c_reply = {};
        c_reply[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_NON;
        fn_callback(c_reply);
        return;
    }

    // Hardware validation requires db storage mode (team_hardware table)
    const storageType = global.m_serverconfig.m_configuration.account_storage_type.toLowerCase();
    if (storageType !== 'db') {
        console.log(global.Colors.Warn + "[WARN] Hardware validation is enabled but account_storage_type is '" + storageType + "' — hardware validation requires 'db' mode. Skipping hardware check." + global.Colors.Reset);
        const c_reply = {};
        c_reply[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_NON;
        fn_callback(c_reply);
        return;
    }

    v_database_manager.fn_do_getHardwareVerifyByAccountSID(p_accountSID,
        function (p_reply) {

            if (p_reply[global.c_CONSTANTS.CONST_ERROR.toString()] != global.c_CONSTANTS.CONST_ERROR_NON) {
                // No Data or Error
                fn_callback(p_reply);
            }
            else {   // Data Found
                // Search if HW required exists in the return list.
                const m_hwIDKeys = Object.keys(p_reply.m_data.m_hwID);
                const m_len = m_hwIDKeys.length;

                for (let i = 0; i < m_len; ++i) {
                    const c_key = m_hwIDKeys[i];
                    if (c_key == p_hardwareID) {
                        const c_hwCard = p_reply.m_data.m_hwID[c_key];
                        if (p_hardwareType == c_hwCard.m_hwType) {
                            const c_reply = {};
                            c_reply[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_NON;

                            fn_callback(c_reply);
                            return;
                        }
                    }
                }
                const c_reply = {};
                c_reply[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_HARDWARE_NOT_FOUND;
                c_reply[global.c_CONSTANTS.CONST_ERROR_MSG.toString()] = "Hardware not authorized";

                fn_callback(c_reply);
            }
        });
}

/**
 * Dispatcher for team user administration operations (list/add/edit/delete
 * logins within the caller's own team, plus read-only team info).
 *
 * Security model:
 *   - p_loginCard is the authenticated caller's session card.  The TeamID
 *     is read from it and NEVER from the client request body.
 *   - The caller must have isadmin === true on the login card.
 *   - Every storage operation is scoped to the caller's TeamID.
 *   - Deleting or demoting (isadmin -> false) the last admin of a team is
 *     rejected to avoid lockout.
 *   - Self-deletion is rejected.
 *
 * @param {string} p_subCommand  one of CONST_CMD_* team-admin sub-commands
 * @param {object} p_loginCard   the caller's login card (from session manager)
 * @param {object} p_params      { targetLoginName, permission, accessCode, isAdmin }
 * @param {function} fn_callback reply callback
 */
function fn_teamUserOperation(p_subCommand, p_loginCard, p_params, fn_callback) {
    const C = global.c_CONSTANTS;
    const c_reply = {};

    // The caller must be authenticated.
    if (!p_loginCard || !p_loginCard.m_data || p_loginCard.m_data.m_sid == null) {
        c_reply[C.CONST_ERROR_MSG.toString()] = 'Session not found.';
        c_reply[C.CONST_ERROR.toString()] = C.CONST_ERROR_SESSION_NOT_FOUND;
        fn_callback(c_reply);
        return;
    }

    // Only admins may manage team members.
    if (p_loginCard.m_isadmin !== true) {
        c_reply[C.CONST_ERROR_MSG.toString()] = 'You do not have admin permission.';
        c_reply[C.CONST_ERROR.toString()] = C.CONST_ERROR_NO_PERMISSION;
        fn_callback(c_reply);
        return;
    }

    const c_teamId = p_loginCard.m_data.m_sid;
    const c_storageType = m_serverconfig.m_configuration.account_storage_type.toLowerCase();

    // Team administration is not available in single-account mode.
    if (c_storageType === 'single') {
        c_reply[C.CONST_ERROR_MSG.toString()] = 'Team administration is not available in single-account mode.';
        c_reply[C.CONST_ERROR.toString()] = C.CONST_ERROR_NO_PERMISSION;
        fn_callback(c_reply);
        return;
    }

    const c_params = p_params || {};
    const c_targetLoginName = c_params.targetLoginName;
    const c_permission = c_params.permission || '0xffffffff';
    const c_accessCode = c_params.accessCode;
    const c_isAdmin = c_params.isAdmin === true;

    // Helper: validate a login name.
    function validLoginName(name) {
        return name != null && hlp_string.fn_isValidAccountName(name);
    }

    // Helper: validate a permission hex string.
    function validPermission(perm) {
        return typeof perm === 'string' && /^0x[0-9a-fA-F]{8}$/.test(perm);
    }

    // ── GET TEAM INFO ──────────────────────────────────────────────────────
    if (p_subCommand === C.CONST_CMD_GET_TEAM_INFO) {
        if (c_storageType === 'file') {
            const info = global.db_users.fn_get_team_info(c_teamId);
            if (!info) {
                c_reply[C.CONST_ERROR_MSG.toString()] = 'Team not found.';
                c_reply[C.CONST_ERROR.toString()] = C.CONST_ERROR_ACCOUNT_NOT_FOUND;
            } else {
                c_reply[C.CONST_ERROR.toString()] = C.CONST_ERROR_NON;
                c_reply.m_data = info;
            }
            fn_callback(c_reply);
            return;
        }
        if (c_storageType === 'db') {
            v_database_manager.fn_getTeamInfo(c_teamId, fn_callback);
            return;
        }
        c_reply[C.CONST_ERROR_MSG.toString()] = 'Unsupported storage type.';
        c_reply[C.CONST_ERROR.toString()] = C.CONST_ERROR_DATA_DATABASE_ERROR;
        fn_callback(c_reply);
        return;
    }

    // ── LIST TEAM USERS ────────────────────────────────────────────────────
    if (p_subCommand === C.CONST_CMD_LIST_TEAM_USERS) {
        if (c_storageType === 'file') {
            const logins = global.db_users.fn_get_team_logins(c_teamId);
            c_reply[C.CONST_ERROR.toString()] = C.CONST_ERROR_NON;
            c_reply.m_data = logins;
            fn_callback(c_reply);
            return;
        }
        if (c_storageType === 'db') {
            v_database_manager.fn_getTeamLogins(c_teamId, fn_callback);
            return;
        }
        c_reply[C.CONST_ERROR_MSG.toString()] = 'Unsupported storage type.';
        c_reply[C.CONST_ERROR.toString()] = C.CONST_ERROR_DATA_DATABASE_ERROR;
        fn_callback(c_reply);
        return;
    }

    // ── ADD TEAM USER ──────────────────────────────────────────────────────
    if (p_subCommand === C.CONST_CMD_ADD_TEAM_USER) {
        if (!validLoginName(c_targetLoginName)) {
            c_reply[C.CONST_ERROR_MSG.toString()] = 'Invalid login name.';
            c_reply[C.CONST_ERROR.toString()] = C.CONST_ERROR_INVALID_DATA;
            fn_callback(c_reply);
            return;
        }
        if (!validPermission(c_permission)) {
            c_reply[C.CONST_ERROR_MSG.toString()] = 'Invalid permission value.';
            c_reply[C.CONST_ERROR.toString()] = C.CONST_ERROR_INVALID_DATA;
            fn_callback(c_reply);
            return;
        }

        if (c_storageType === 'file') {
            global.db_users.fn_add_team_login(c_teamId, c_targetLoginName, c_accessCode, c_permission, c_isAdmin, fn_callback);
            return;
        }
        if (c_storageType === 'db') {
            v_database_manager.fn_addTeamLogin(c_teamId, c_targetLoginName, c_accessCode, c_permission, c_isAdmin, fn_callback);
            return;
        }
        c_reply[C.CONST_ERROR_MSG.toString()] = 'Unsupported storage type.';
        c_reply[C.CONST_ERROR.toString()] = C.CONST_ERROR_DATA_DATABASE_ERROR;
        fn_callback(c_reply);
        return;
    }

    // ── UPDATE TEAM USER ───────────────────────────────────────────────────
    if (p_subCommand === C.CONST_CMD_UPDATE_TEAM_USER) {
        if (!validLoginName(c_targetLoginName)) {
            c_reply[C.CONST_ERROR_MSG.toString()] = 'Invalid target login name.';
            c_reply[C.CONST_ERROR.toString()] = C.CONST_ERROR_INVALID_DATA;
            fn_callback(c_reply);
            return;
        }
        if (!validPermission(c_permission)) {
            c_reply[C.CONST_ERROR_MSG.toString()] = 'Invalid permission value.';
            c_reply[C.CONST_ERROR.toString()] = C.CONST_ERROR_INVALID_DATA;
            fn_callback(c_reply);
            return;
        }

        // Last-admin protection: if demoting an admin to non-admin, ensure at
        // least one other admin remains.  This is an async check in db mode.
        const doUpdate = function () {
            if (c_storageType === 'file') {
                global.db_users.fn_update_team_login(c_teamId, c_targetLoginName, c_accessCode, c_permission, c_isAdmin, fn_callback);
                return;
            }
            if (c_storageType === 'db') {
                v_database_manager.fn_updateTeamLogin(c_teamId, c_targetLoginName, c_accessCode, c_permission, c_isAdmin, fn_callback);
                return;
            }
            c_reply[C.CONST_ERROR_MSG.toString()] = 'Unsupported storage type.';
            c_reply[C.CONST_ERROR.toString()] = C.CONST_ERROR_DATA_DATABASE_ERROR;
            fn_callback(c_reply);
        };

        // We only need the admin-count guard when demoting.  Fetch current
        // admin status of the target first.
        const checkLastAdmin = function (targetIsAdmin) {
            if (targetIsAdmin === true && c_isAdmin === false) {
                // Demoting an admin — count admins.
                if (c_storageType === 'file') {
                    const count = global.db_users.fn_count_team_admins(c_teamId);
                    if (count <= 1) {
                        c_reply[C.CONST_ERROR_MSG.toString()] = 'Cannot demote the last admin of the team.';
                        c_reply[C.CONST_ERROR.toString()] = C.CONST_ERROR_NO_PERMISSION;
                        fn_callback(c_reply);
                        return;
                    }
                    doUpdate();
                    return;
                }
                if (c_storageType === 'db') {
                    v_database_manager.fn_countTeamAdmins(c_teamId, function (cntReply) {
                        if (cntReply[C.CONST_ERROR.toString()] !== C.CONST_ERROR_NON) {
                            fn_callback(cntReply);
                            return;
                        }
                        if (cntReply.m_count <= 1) {
                            c_reply[C.CONST_ERROR_MSG.toString()] = 'Cannot demote the last admin of the team.';
                            c_reply[C.CONST_ERROR.toString()] = C.CONST_ERROR_NO_PERMISSION;
                            fn_callback(c_reply);
                            return;
                        }
                        doUpdate();
                    });
                    return;
                }
            } else {
                doUpdate();
            }
        };

        // Look up the target's current IsAdmin.
        if (c_storageType === 'file') {
            const logins = global.db_users.fn_get_team_logins(c_teamId);
            const target = logins.find(function (l) { return l.LoginName === c_targetLoginName; });
            if (!target) {
                c_reply[C.CONST_ERROR_MSG.toString()] = 'Login not found in this team.';
                c_reply[C.CONST_ERROR.toString()] = C.CONST_ERROR_ACCOUNT_NOT_FOUND;
                fn_callback(c_reply);
                return;
            }
            checkLastAdmin(target.IsAdmin);
            return;
        }
        if (c_storageType === 'db') {
            v_database_manager.fn_getTeamLogins(c_teamId, function (listReply) {
                if (listReply[C.CONST_ERROR.toString()] !== C.CONST_ERROR_NON) {
                    fn_callback(listReply);
                    return;
                }
                const target = (listReply.m_data || []).find(function (l) { return l.LoginName === c_targetLoginName; });
                if (!target) {
                    c_reply[C.CONST_ERROR_MSG.toString()] = 'Login not found in this team.';
                    c_reply[C.CONST_ERROR.toString()] = C.CONST_ERROR_ACCOUNT_NOT_FOUND;
                    fn_callback(c_reply);
                    return;
                }
                checkLastAdmin(target.IsAdmin);
            });
            return;
        }

        c_reply[C.CONST_ERROR_MSG.toString()] = 'Unsupported storage type.';
        c_reply[C.CONST_ERROR.toString()] = C.CONST_ERROR_DATA_DATABASE_ERROR;
        fn_callback(c_reply);
        return;
    }

    // ── DELETE TEAM USER ───────────────────────────────────────────────────
    if (p_subCommand === C.CONST_CMD_DELETE_TEAM_USER) {
        if (!validLoginName(c_targetLoginName)) {
            c_reply[C.CONST_ERROR_MSG.toString()] = 'Invalid target login name.';
            c_reply[C.CONST_ERROR.toString()] = C.CONST_ERROR_INVALID_DATA;
            fn_callback(c_reply);
            return;
        }

        // Prevent self-deletion.
        if (c_targetLoginName === p_loginCard.m_login_name) {
            c_reply[C.CONST_ERROR_MSG.toString()] = 'You cannot delete your own account.';
            c_reply[C.CONST_ERROR.toString()] = C.CONST_ERROR_NO_PERMISSION;
            fn_callback(c_reply);
            return;
        }

        // Last-admin protection: if deleting an admin, ensure another admin
        // remains.
        const doDelete = function () {
            if (c_storageType === 'file') {
                global.db_users.fn_delete_team_login(c_teamId, c_targetLoginName, fn_callback);
                return;
            }
            if (c_storageType === 'db') {
                v_database_manager.fn_deleteTeamLogin(c_teamId, c_targetLoginName, fn_callback);
                return;
            }
            c_reply[C.CONST_ERROR_MSG.toString()] = 'Unsupported storage type.';
            c_reply[C.CONST_ERROR.toString()] = C.CONST_ERROR_DATA_DATABASE_ERROR;
            fn_callback(c_reply);
        };

        if (c_storageType === 'file') {
            const logins = global.db_users.fn_get_team_logins(c_teamId);
            const target = logins.find(function (l) { return l.LoginName === c_targetLoginName; });
            if (!target) {
                c_reply[C.CONST_ERROR_MSG.toString()] = 'Login not found in this team.';
                c_reply[C.CONST_ERROR.toString()] = C.CONST_ERROR_ACCOUNT_NOT_FOUND;
                fn_callback(c_reply);
                return;
            }
            if (target.IsAdmin === true) {
                const count = global.db_users.fn_count_team_admins(c_teamId);
                if (count <= 1) {
                    c_reply[C.CONST_ERROR_MSG.toString()] = 'Cannot delete the last admin of the team.';
                    c_reply[C.CONST_ERROR.toString()] = C.CONST_ERROR_NO_PERMISSION;
                    fn_callback(c_reply);
                    return;
                }
            }
            doDelete();
            return;
        }
        if (c_storageType === 'db') {
            v_database_manager.fn_getTeamLogins(c_teamId, function (listReply) {
                if (listReply[C.CONST_ERROR.toString()] !== C.CONST_ERROR_NON) {
                    fn_callback(listReply);
                    return;
                }
                const target = (listReply.m_data || []).find(function (l) { return l.LoginName === c_targetLoginName; });
                if (!target) {
                    c_reply[C.CONST_ERROR_MSG.toString()] = 'Login not found in this team.';
                    c_reply[C.CONST_ERROR.toString()] = C.CONST_ERROR_ACCOUNT_NOT_FOUND;
                    fn_callback(c_reply);
                    return;
                }
                if (target.IsAdmin === true) {
                    v_database_manager.fn_countTeamAdmins(c_teamId, function (cntReply) {
                        if (cntReply[C.CONST_ERROR.toString()] !== C.CONST_ERROR_NON) {
                            fn_callback(cntReply);
                            return;
                        }
                        if (cntReply.m_count <= 1) {
                            c_reply[C.CONST_ERROR_MSG.toString()] = 'Cannot delete the last admin of the team.';
                            c_reply[C.CONST_ERROR.toString()] = C.CONST_ERROR_NO_PERMISSION;
                            fn_callback(c_reply);
                            return;
                        }
                        doDelete();
                    });
                    return;
                }
                doDelete();
            });
            return;
        }

        c_reply[C.CONST_ERROR_MSG.toString()] = 'Unsupported storage type.';
        c_reply[C.CONST_ERROR.toString()] = C.CONST_ERROR_DATA_DATABASE_ERROR;
        fn_callback(c_reply);
        return;
    }

    // Unknown sub-command
    c_reply[C.CONST_ERROR_MSG.toString()] = 'Unknown team operation.';
    c_reply[C.CONST_ERROR.toString()] = C.CONST_ERROR_INVALID_DATA;
    fn_callback(c_reply);
}


module.exports =
{
    fn_createAccessCode: fn_createAccessCode,
    fn_regenerateAccessCode: fn_regenerateAccessCode,
    fn_getAccountNameByAccessCode: fn_getAccountNameByAccessCode,
    fn_do_verifyHardwareByAccountSID: fn_do_verifyHardwareByAccountSID,
    fn_teamUserOperation: fn_teamUserOperation,
}