"use strict";
const { v4: uuidv4 } = require('uuid');
const hlp_string = require("../helpers/hlp_string.js");
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

            if ((m_serverconfig.m_configuration.single_account_access_code != p_accessCode)) {
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
        if (m_serverconfig.m_configuration.hasOwnProperty('db_users') === true) {

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

    console.log(global.Colors.BError + "FATAL ERROR:" + global.Colors.FgYellow + " account_storage_type or db_users or db connection" + global.Colors.Reset + " are not specified in config file. ");
}


/**
 * Retrieves account associated hardware and compare given hardware gievn on and returns uccess if found valid.
 * @param {*} p_accountSID Account_SID
 * @param {*} p_hardwareID HardwareID
 * @param {*} p_hardwareType type: cpu, generated, ...etc.
 * @param {*} fn_callback call back to http response.
 */
function fn_do_verifyHardwareByAccountSID(p_accountSID, p_hardwareID, p_hardwareType, fn_callback) {
    v_database_manager.fn_do_getHardwareVerifyByAccountSID(p_accountSID,
        function (p_reply) {

            if (p_reply[global.c_CONSTANTS.CONST_ERROR.toString()] != global.c_CONSTANTS.CONST_ERROR_NON) {
                /**
                 * exits if no validation is required however we still go to database as we may need to 
                 * store HW for future restrictions.
                 */
                if (global.m_serverconfig.m_configuration.skip_hardware_validation === true) {
                    // skip hardware validation
                    const c_reply = {};
                    c_reply[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_NON;

                    fn_callback(c_reply);
                    return;
                }

                // No Data or Error
                fn_callback(p_reply);
            }
            else {   // Data Found
                // Search if HW required exists in the return list.
                const m_hwIDKeys = Object.keys(p_reply.m_data.m_hwID);
                const m_len = m_hwIDKeys.length;

                if (global.m_serverconfig.m_configuration.skip_hardware_validation === true) {
                    // skip hardware validation
                    const c_reply = {};
                    c_reply[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_NON;

                    fn_callback(c_reply);
                    return;
                }

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

module.exports =
{
    fn_createAccessCode: fn_createAccessCode,
    fn_regenerateAccessCode: fn_regenerateAccessCode,
    fn_getAccountNameByAccessCode: fn_getAccountNameByAccessCode,
    fn_do_verifyHardwareByAccountSID: fn_do_verifyHardwareByAccountSID,
}