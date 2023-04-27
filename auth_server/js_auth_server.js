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

const v_commServerManagerServer = require ("./js_comm_server_manager_server");
const v_commServerManager = require ("./js_comm_server_manager");
const v_sessionManager = require ("./js_session_manager");
const v_account_manager = require ("./js_account_manager");
const v_database_manager = require ("./js_database_manager");





/**
 * Main function to start Authentication Service.
 */
function fn_startServer ()
{
    console.log (global.Colors.Success + "[OK] Auth Server Started" + global.Colors.Reset);


    v_database_manager.fn_initialize ();
    v_sessionManager.fn_initialize();
    v_account_manager.fn_initialize();
    v_commServerManager.fn_initialize();
    // link communication server manager with communication server server and vice versa.
    v_commServerManagerServer.fn_onMessageReceived  = v_commServerManager.fn_commServerMessageHandler;
    v_commServerManagerServer.fn_onServerClosed     = v_commServerManager.fn_ServerUpdated;
    v_commServerManager.fn_sendMessage = v_commServerManagerServer.fn_sendMessage;


    // start web socket server
    v_commServerManagerServer.fn_startServer();
}


/**
 * Check agent application version info. SYNC function
 * @param {*} p_app 
 * @param {*} p_version 
 * @param {*} p_extra 
 * @returns null when there is no error.
 */
function fn_checkAppVersion (p_app, p_version, p_extra)
{
    const v_apps = JSON.parse(global.m_serverconfig.m_configuration.APPVERSION);
    
    if (v_apps[p_app] == null)
    {
        // unknown app !!!!
        console.log('unknown app ' + p_app);

        var v_reply = {};
        v_reply[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_OLD_APP_VERSION;
        v_reply[global.c_CONSTANTS.CONST_ERROR_MSG.toString()] = "Please upgrade your Mobile App to latest version.";
        v_reply[global.c_CONSTANTS.CONST_COMMAND.toString()] = 'v';
        
        return v_reply;

    }

    if (p_version < v_apps[p_app])
    {
        var v_reply = {};
        v_reply[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_OLD_APP_VERSION;
        v_reply[global.c_CONSTANTS.CONST_ERROR_MSG.toString()] = "Please upgrade your Mobile App to latest version.";
        v_reply[global.c_CONSTANTS.CONST_COMMAND.toString()] = 'v';

        return v_reply;
    
    }

    return null;
}

 /**
  * Request creating a new login card.
  * 
  * @param {*} p_accountName 
  * @param {*} p_accessCode 
  * @param {*} p_actorType should be g: gcs d: drone
  * @param {*} p_app 
  * @param {*} p_version 
  * @param {*} p_extra 
  * @param {*} fn_callback return data to app could be valid or error code
  * @param {*} fn_error result in 404 page error. This is mainly because of fake or invalid input mainly because of hacking.
  */
function fn_newLoginCard (p_accountName, p_accessCode, p_actorType, p_group, p_app, p_version, p_extra, p_mustGCS, fn_callback, fn_error)
{
    if (p_accountName != null)
    {
        p_accountName = p_accountName.trim();
    }
    
    if (p_accessCode != null)
    {   // avoid typo happens in android autocomplete
        p_accessCode = p_accessCode.trim();
    }
    
    if ((p_actorType == null) || (p_actorType.length !== 1))
    {   // avoid typo happens in android autocomplete
        if (fn_error != null)
        {
            fn_error();
        }
        return ;
    }
    
    if ((p_accountName == null) || (!p_accountName.fn_isEmail()))
    {
        // null or not alphanumeric
        if (fn_error != null)
        {
            fn_error();
        }
        return ;
    }
    if ((p_accessCode == null) || (!p_accessCode.fn_isAlphanumeric()) || (!p_accessCode.length>global.c_CONSTANTS.CONST_ACCESSCODE_MAX_LENGTH))
    {
        // null or not alphanumeric
        if (fn_error != null)
        {
            fn_error();
        }
        return ;
    }
    if ((p_group == null) || (!p_group.fn_isAlphanumeric()) || (!p_group.length>global.c_CONSTANTS.CONST_ACCESSCODE_MAX_LENGTH))
    {
        // null or not alphanumeric
        if (fn_error != null)
        {
            fn_error();
        }
        return ;
    }
    if ((p_app == null) || (!p_app.fn_isAlphanumeric()) || (!p_app.length>global.c_CONSTANTS.CONST_ACCESSCODE_MAX_LENGTH))
    {
        // null or not alphanumeric
        if (fn_error != null)
        {
            fn_error();
        }
        return ;
    }
    if ((p_version == null) || (!p_version.fn_isVersionFormat()))
    {
        // null or not alphanumeric
        if (fn_error != null)
        {
            fn_error();
        }
        return ;
    }
    if ((p_extra == null) || (!p_extra.fn_isAlphanumericSentence()))
    {
        // null or not alphanumeric
        if (fn_error != null)
        {
            fn_error();
        }
        return ;
    }
    

    const c_reply = fn_checkAppVersion (p_app, p_version, p_extra);

    if (c_reply != null)
    {
        
        fn_callback (c_reply);
    }

    v_sessionManager.fn_createLoginCard(p_accountName, p_accessCode, p_actorType, p_group,
        function (p_loginCard)
        {
            if (p_loginCard[global.c_CONSTANTS.CONST_ERROR] !== 0)
            {
                fn_callback (p_loginCard);
                return ;
            }
            
            // for example web should be GCS.
            if ((p_mustGCS===true) && (!v_sessionManager.fn_isGCS(p_loginCard)))
            {
                var ret = {};
                ret[global.c_CONSTANTS.CONST_ERROR.toString()]         = global.c_CONSTANTS.CONST_ERROR_NO_PERMISSION;
                ret[global.c_CONSTANTS.CONST_ERROR_MSG.toString()]     = "No enough permission. This is not a GCS account.";
                fn_callback(ret);
                return ;
            }

            if ((p_mustGCS===false) && (!v_sessionManager.fn_isAGN(p_loginCard)))
            {
                var ret = {};
                ret[global.c_CONSTANTS.CONST_ERROR.toString()]         = global.c_CONSTANTS.CONST_ERROR_NO_PERMISSION;
                ret[global.c_CONSTANTS.CONST_ERROR_MSG.toString()]     = "No enough permission. This is not a GCS account.";
                fn_callback(ret);
                return ;
            }
            
            // get candidate server that should this party should connect to.
            const c_selectedServer = v_commServerManager.fn_selectServerforAccount (p_loginCard);
            if (c_selectedServer == null)
            {
                // Report Error to Client
                var ret = {};
                ret[global.c_CONSTANTS.CONST_ERROR.toString()]         = global.c_CONSTANTS.CONST_ERROR_SERVER_NOT_AVAILABLE;
                ret[global.c_CONSTANTS.CONST_ERROR_MSG.toString()]     = "No available Server";
                fn_callback(ret);
                return ;
            }

            // request adding party to server
            v_commServerManager.fn_requestCommunicationLogin (p_loginCard, c_selectedServer, 
                // callback function
                function (p_andruavServerReply)
                {
                    const c_reply = v_sessionManager.fn_generateLoginReplyToParty (p_andruavServerReply);
                    fn_callback(c_reply);
                },
                // error function
                function (err)
                {
                    // Report Error to Client
                    var c_ret = {};
                    c_ret[c_CONSTANTS.CONST_ERROR.toString()]     = c_CONSTANTS.CONST_ERROR_SERVER_NOT_AVAILABLE;
                    fn_callback (c_ret);
                    return ;
                });

        });
}


/**
 * Enterance to all operations with @var v_account_manager .
 * @param {*} p_subCommand 
 * @param {*} p_accountName 
 * @param {*} p_accessCode 
 * @param {*} fn_callback return data to app could be valid or error code
 * @param {*} fn_error result in 404 page error. This is mainly because of fake or invalid input mainly because of hacking.
 */
function fn_accountOperation (p_subCommand, p_accountName, p_accessCode, fn_callback, fn_error, p_sessionID)
{
    if ((p_subCommand == null) || (p_subCommand.length > 3))
    {
        // null or too long command
        if (fn_error != null)
        {
            fn_error();
        }
        return ;
    }
    if ((p_accountName == null) && (p_accessCode == null))
    {
        if (fn_error != null)
        {
            fn_error();
        }
        return ;
    }
    
    if (p_accountName != null)
    {
        p_accountName = p_accountName.trim();
    }
    
    if ((p_accountName != null) && (!p_accountName.fn_isEmail()))
    {
        // null or not alphanumeric
        if (fn_error != null)
        {
            fn_error();
        }
        return ;
    }

    if (p_accessCode != null)
    {   // avoid typo happens in android autocomplete
        p_accessCode = p_accessCode.trim();
    }
    
    if ((p_accessCode != null) && (!p_accessCode.fn_isAlphanumeric()))
    {
        // null or not alphanumeric
        if (fn_error != null)
        {
            fn_error();
        }
        return ;
    }
    
    var p_loginCard = v_sessionManager.fn_getLoginCardBySessionID(p_sessionID);
    switch (p_subCommand)
    {
        case global.c_CONSTANTS.CONST_CMD_CREATE_ACCESSCODE:
            v_account_manager.fn_createAccessCode(p_accountName, function (p_reply)
            {
                p_reply[global.c_CONSTANTS.CONST_SUB_COMMAND] =global.c_CONSTANTS.CONST_CMD_CREATE_ACCESSCODE;

                fn_callback (p_reply);
            },
            p_loginCard);
            break;
        case global.c_CONSTANTS.CONST_CMD_REGENERATE_ACCESSCODE:
            v_account_manager.fn_regenerateAccessCode(p_accountName, function (p_reply)
            {
                p_reply[global.c_CONSTANTS.CONST_SUB_COMMAND] =global.c_CONSTANTS.CONST_CMD_REGENERATE_ACCESSCODE;

                fn_callback (p_reply);
            },
            p_loginCard);
            break;
        case global.c_CONSTANTS.CONST_CMD_GET_ACCOUNT_NAME:
            v_account_manager.fn_getAccountNameByAccessCode(p_accessCode, function (p_reply)
            {
                p_reply[global.c_CONSTANTS.CONST_SUB_COMMAND] =global.c_CONSTANTS.CONST_CMD_GET_ACCOUNT_NAME;

                fn_callback (p_reply);
            },
            p_loginCard);
            break;
    }

}


/**
 * Called by agent and calls are forward to @function fn_accountOperation.
 * @param {*} p_subCommand 
 * @param {*} p_accountName 
 * @param {*} p_app 
 * @param {*} p_version 
 * @param {*} p_extra 
 * @param {*} fn_callback return data to app could be valid or error code
 * @param {*} fn_error result in 404 page error. This is mainly because of fake or invalid input mainly because of hacking.
 */
function fn_accountOperationFromAgent (p_subCommand, p_accountName, p_accessCode, p_app, p_version, p_extra, fn_callback, fn_error)
{

    if ((p_app == null) || (typeof p_app != 'string') || (!p_app.fn_isAlphanumeric()))
    {
        // null or not alphanumeric
        if (fn_error != null)
        {
            fn_error();
        }
        return ;
    }
    if ((p_version == null) || (!p_version.fn_isVersionFormat()))
    {
        // null or not alphanumeric
        if (fn_error != null)
        {
            fn_error();
        }
        return ;
    }
    if ((p_extra == null) || (!p_extra.fn_isAlphanumericSentence()))
    {
        // null or not alphanumeric
        if (fn_error != null)
        {
            fn_error();
        }
        return ;
    }

    const c_reply = fn_checkAppVersion (p_app, p_version, p_extra);

    if (c_reply != null)
    {
        c_reply[global.c_CONSTANTS.CONST_SUB_COMMAND] = p_subCommand;
        
        fn_callback (c_reply);
        return ;
    }

    fn_accountOperation (p_subCommand, p_accountName, p_accessCode, fn_callback, fn_error);
}


/**
 * 
 * @param {*} p_subCommand for example CONST_CMD_VERIFY_HARDWARE_BY_ID
 * @param {*} p_sessionID active session that identifies account & unit to Auth.
 * @param {string} p_hardwareID string of (0-9 A-Z a-z) only identifies a particular hardware part. 
 * This can be generated by an algorithm. not necessary a CPUID or similar numbers.
 * @param {*} p_hardwareType type of hardware that is describes.
 */
function fn_hardwareOperationFromAgent (p_subCommand, p_sessionID, p_hardwareID, p_hardwareType, fn_callback, fn_error)
{
    if ((p_sessionID == null) || (typeof p_sessionID != 'string') || (!p_sessionID.fn_isAlphanumeric()))
    {
        // null or not alphanumeric
        if (fn_error != null)
        {
            fn_error();
        }
        return ;
    }

    if ((p_subCommand == null) || (typeof p_subCommand != 'string') || (!p_subCommand.fn_isAlphanumeric()))
    {
        // null or not alphanumeric
        if (fn_error != null)
        {
            fn_error();
        }
        return ;
    }

    if ((p_hardwareID == null) || (typeof p_hardwareID != 'string') || (!p_hardwareID.fn_isAlphanumeric()))
    {
        // null or not alphanumeric
        if (fn_error != null)
        {
            fn_error();
        }
        return ;
    }

    if ((p_hardwareType == null) || (typeof p_hardwareType != 'string') || (!p_hardwareType.fn_isAlphanumeric()))
    {
        // null or not alphanumeric
        if (fn_error != null)
        {
            fn_error();
        }
        return ;
    }
    

    switch (p_subCommand)
    {
        case global.c_CONSTANTS.CONST_CMD_VERIFY_HARDWARE_BY_ID:
            // get AccountSID of SessionSID
            const c_accountSID = v_sessionManager.fn_getLoginCardBySessionID(p_sessionID);
            if (c_accountSID == null)
            {
                // session not found! 
                // SessionID not found can happen if AUTH restarted.
                // Request Relogin !!!

                // Report Error to Client
                const c_reply = {};
                c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] =  "No hardware is found.";
                c_reply[c_CONSTANTS.CONST_ERROR.toString()] = c_CONSTANTS.CONST_ERROR_SESSION_NOT_FOUND;
                fn_callback (c_reply);
                return ;
                
            }

            // request hardware info
            v_account_manager.fn_do_verifyHardwareByAccountSID (c_accountSID.m_data.m_sid, p_hardwareID, p_hardwareType,
                // callback function
                function (p_andruavServerReply)
                {
                fn_callback(p_andruavServerReply);
                },
                // error function
                function (err)
                {
                    // Report Error to Client
                    var c_ret = {};
                    c_ret[c_CONSTANTS.CONST_ERROR.toString()]     = c_CONSTANTS.CONST_ERROR_SERVER_NOT_AVAILABLE;
                    fn_callback (c_ret);
                    return ;
                });
            
        break;
    }

   
}

/**
 * Invalidates Session, and signal other servers to invalidate related connections.
 * @param {*} p_sessionID 
 * @param {*} fn_Success 
 * @param {*} fn_error 
 */
function fn_logout (p_sessionID, fn_Success, fn_error)
{
    if ((p_sessionID == null) || (!p_sessionID.fn_isAlphanumeric()==null) || (!p_sessionID.length > global.c_CONSTANTS.CONST_SESSION_MAX_LENGTH))
    {
        if (fn_error != null)
        {
            // 404 Error
            fn_error();
        }
        return ;
    }


    const c_loginCard = v_sessionManager.fn_getLoginCard (p_sessionID);

    if (c_loginCard == null)
    {   // FAKE Session could be a hack
        // 404 Error
        fn_error();
    }

    v_commServerManager.fn_removePartyCommunicationSession (c_loginCard);
    v_sessionManager.fn_deleteOldCard (c_loginCard);

    if (fn_Success != null)
    {
        const c_rep = {};
        c_rep [global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_NON
        fn_Success (c_rep);
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
