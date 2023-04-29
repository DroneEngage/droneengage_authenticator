/**
 * This module handles session with web or agent.
 * It stores expires ..etc. sessions
 * 
 * 
 * 
 */


"use strict";
const c_uuidv4 = require('uuid');
const hlp_string = require("../helpers/hlp_string.js");
const v_database_manager = require("./js_database_manager");
const c_permission = require ("./js_permisson_validator.js");
const v_user = require ("../database/db_users");

const m_loginCardList = {};

function fn_initialize ()
{

}

/**
 * This function is used to generated correspondant number for SID 
 * that is used with AndruavServer and other modues that needs to identify account_sid
 * without revealing true SID in database.
 * @param {*} p_SID_TRUE 
 */
function fn_generateSenderID(p_SID_TRUE) {
    return p_SID_TRUE+"xx";
    //return c_uuidv4.uuid().split('-')[0].substr(0, 8);
}

/**
 * returns true if permission allows GCS Web
 * @param {*} p_permission 
 */
function fn_isGCS (p_loginCard)
{
    if ((p_loginCard == null) || ((p_loginCard.m_data == null))) return 0;

    return c_permission.fn_validatePermission(p_loginCard.m_data.m_prm, c_permission.AndruavMessageTypes.CONST_ALLOW_GCS);
}

/**
 * returns true if permission allows Agents(Units) are allowed.
 * @param {*} p_permission 
 */
function fn_isAGN (p_loginCard)
{
    if ((p_loginCard == null) || ((p_loginCard.m_data == null))) return 0;

    return c_permission.fn_validatePermission(p_loginCard.m_data.m_prm, c_permission.AndruavMessageTypes.CONST_ALLOW_UNIT);
}

/**
 * SessionID used to communicate with Authentication server .
 */
function fn_generateSessionID() {

    return c_uuidv4.v4().replaceAll("-", "") + process.hrtime()[1].toString();  
}

/**
 * used to create login card in AndruavAuth. Also ANdruavServer session is created and a key is returned to connect to AndruavServer.
 * @param {*} p_accountName email or username
 * @param {*} p_accessCode password
 * @param {*} p_group group name or number
 * @param {*} fn_callback 
 */
function fn_createLoginCard (p_accountName, p_accessCode, p_actorType, p_group, fn_callback)
{
    
    if (m_serverconfig.m_configuration.account_storage_type.toLowerCase() === 'single') {
        // use single logic account
        if ((m_serverconfig.m_configuration.hasOwnProperty('single_account_user_name') === true)    
        && (m_serverconfig.m_configuration.hasOwnProperty('single_account_access_code') === true))
        {
            var p_reply = {};
            
            if ((m_serverconfig.m_configuration.single_account_user_name != p_accountName)
            || (m_serverconfig.m_configuration.single_account_access_code != p_accessCode))
            {
                p_reply[global.c_CONSTANTS.CONST_ERROR_MSG] =  "Account Not Found.";
                p_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_ACCOUNT_NOT_FOUND;
                fn_callback (p_reply);
                return ;
            }

            p_reply.m_data ={};
            p_reply.m_timestamp = new Date();
            p_reply.m_data.m_prm = c_permission.fn_convertPermissiontoInt('0xffffffff'); // single account should have all permissions.
            p_reply.m_data.m_permission ='D1G1T3R4V5C6';
            p_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_NON;
            p_reply[global.c_CONSTANTS.CONST_CS_GROUP_ID.toString()] = p_group;
            p_reply.m_actorType = p_actorType;
            p_reply.m_session_id     = fn_generateSessionID();
            p_reply.m_acc_id_hashed  = fn_generateSenderID('1');
            m_loginCardList[p_reply.m_session_id] = p_reply;
            fn_callback (p_reply);
            
            return ;
        }    
        
    } 

    if (m_serverconfig.m_configuration.account_storage_type.toLowerCase() === 'file') {
        if (m_serverconfig.m_configuration.hasOwnProperty('db_users') === true) {
     
            var p_reply = {};
            
            var account_record = global.db_users.fn_get_record(p_accountName);
            if ((account_record==null)
            ||  (account_record.hasOwnProperty('pwd')===false) 
            ||  (account_record.pwd != p_accessCode)){

                p_reply[global.c_CONSTANTS.CONST_ERROR_MSG] =  "Account Not Found.";
                p_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_ACCOUNT_NOT_FOUND;
                fn_callback (p_reply);
                return ;
            }

            p_reply.m_data ={};
            p_reply.m_timestamp = new Date();
            p_reply.m_data.m_prm = c_permission.fn_convertPermissiontoInt(account_record.prm); 
            p_reply.m_data.m_permission ='D1G1T3R4V5C6';
            p_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_NON;
            p_reply[global.c_CONSTANTS.CONST_CS_GROUP_ID.toString()] = p_group;
            p_reply.m_actorType = p_actorType;
            p_reply.m_session_id     = fn_generateSessionID();
            p_reply.m_acc_id_hashed  = fn_generateSenderID(account_record.sid);
            m_loginCardList[p_reply.m_session_id] = p_reply;
            fn_callback (p_reply);
                
            return ;

        }
    }

    if (m_serverconfig.m_configuration.account_storage_type.toLowerCase() === 'db') {
    
        // login via database
        v_database_manager.fn_do_loginAccount (p_accountName, p_accessCode, 
            function (p_reply)
            {
                if (p_reply [global.c_CONSTANTS.CONST_ERROR.toString()] != global.c_CONSTANTS.CONST_ERROR_NON)
                {
                    fn_callback (p_reply);
                }
                else
                {
                    p_reply.m_data.m_prm = c_permission.fn_convertPermissiontoInt(p_reply.m_data.m_prm); // backward compatibility
                    p_reply.m_timestamp = new Date();
                    p_reply[global.c_CONSTANTS.CONST_CS_GROUP_ID.toString()] = p_group;
                    p_reply.m_actorType = p_actorType;
                    p_reply.m_session_id     = fn_generateSessionID();
                    p_reply.m_acc_id_hashed  = fn_generateSenderID(p_reply.m_data.m_sid);
                    m_loginCardList[p_reply.m_session_id] = p_reply;
                    fn_callback (p_reply);
                }
            });
        
        return ;
    }

    console.log (global.Colors.BError + "FATAL ERROR:" + global.Colors.FgYellow + " account_storage_type or db_users or db connection" +  global.Colors.Reset + " are not specified in config file. ");

}


/**
 * generate JSON reply that is sent to the original requester.
 * @param {*} p_loginCard 
 */
function fn_generateLoginReplyToParty (p_loginCard)
{
    const reply = {};
    reply [global.c_CONSTANTS.CONST_ERROR.toString()] = p_loginCard[global.c_CONSTANTS.CONST_ERROR.toString()];
    if (p_loginCard[global.c_CONSTANTS.CONST_ERROR.toString()]!= global.c_CONSTANTS.CONST_ERROR_NON)
    {
        reply [global.c_CONSTANTS.CONST_ERROR_MSG.toString()] = p_loginCard[global.c_CONSTANTS.CONST_ERROR_MSG.toString()];
    }
    else
    {
        reply [global.c_CONSTANTS.CONST_SESSION_ID.toString()] = p_loginCard.m_session_id;
        reply [global.c_CONSTANTS.CONST_PERMISSION] = p_loginCard.m_data.m_permission;
        reply [global.c_CONSTANTS.CONST_PERMISSION2] = p_loginCard.m_data.m_prm;
        reply [global.c_CONSTANTS.CONST_COMM_SERVER.toString()] = p_loginCard.m_serverInfo;
    }

    return reply;
}


function fn_getLoginCardBySessionID (p_sessionID)
{
    return m_loginCardList[p_sessionID];
}

module.exports =
{
    fn_initialize: fn_initialize,
    fn_createLoginCard: fn_createLoginCard,
    fn_generateLoginReplyToParty: fn_generateLoginReplyToParty,
    fn_isGCS: fn_isGCS,
    fn_isAGN: fn_isAGN,
    fn_getLoginCardBySessionID: fn_getLoginCardBySessionID,
}