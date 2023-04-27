"use strict";

/***
 * Handles Communication Server Status.
 * Also handles access request to communication servers by parties.
 * This module handles communication logic but physical communication is done in comm_server_manager_server.
 */
"use strict";
const c_uuidv4 = require('uuid');
const CONST_LOGIN_REQUEST_TIMEOUT = 15000;
const m_communicationServersList  = {};
const m_waitingForServerLogin = {};
var m_bestServer = null;
var Me = this;




 /**
 * Decrypt message from Communication server. 
 * @todo: NOT IMPLEMENTED
 * @param {raw message from Auth} p_msg 
 */
function fn_decryptCommunicationMessage (p_msg)
{
    try
    {
        const v_msg =  JSON.parse(p_msg);

        return v_msg;
    }
    catch (ex)
    {

    }

    return null;
}


/**
 * Returns current server that already handles communication for a given accountID
 * @param {*} p_loginCard 
 */
function fn_getServerCurrentlyServerAccountID (p_loginCard)
{
    const c_keys = Object.keys(m_communicationServersList);
    const c_len = c_keys.length;
    
    for (let i=0; i< c_len; ++i)
    {
       const c_serverCard = m_communicationServersList[c_keys[i]];
       const c_acc_len = c_serverCard.m_server.m_accounts.length; 
       for (let j=0;j<c_acc_len;++j)
       {
            if (c_serverCard.m_server.m_accounts[j] == p_loginCard.m_acc_id_hashed)
            {
                if (c_serverCard.m_server.m_isOnline === false)
                {
                    return null;
                }
            
                return c_serverCard;
            }
       }
    }

    return null;
}


/**
 * Called when two servers handles the same account
 * @param {*} p_server1 
 * @param {*} p_server2 
 * @param {*} p_accountOfConflict 
 */
function fn_onAccountConflicts (p_server1, p_server2, p_accountOfConflict)
{
    // get server that handle account.

    // send invalidation
}


/**
 * Called when communication server is first added.
 * @param {*} p_serverInfo 
 */
function fn_onServerAdded (p_serverInfo)
{
    console.log (global.Colors.Log +  "[INFO] Communication Server [%s] has been added" + global.Colors.Reset, p_serverInfo.m_server.m_serverId);
}


/**
 * Called when communication server reconnects again.
 * @param {*} p_serverInfo 
 */
function fn_onServerRestored (p_serverInfo)
{
    console.log ("[INFO] Communication Server [%s] has been disconnected", p_serverInfo.m_server.m_serverId);

    p_serverInfo.m_server.m_isOnline = true; 

}


/**
 * Called when a communication server disconnects websocket.
 * @param {*} p_serverInfo 
 */
function fn_onServerDisconnect (p_serverInfo)
{
    console.log (global.Colors.Error + "[ATTENTION!!] Communication Server [%s] has been disconnected"  + global.Colors.Reset, p_serverInfo.m_server.m_serverId);

    // disable server. it could be attached to a session object.
    p_serverInfo.m_server.m_isOnline = false; 
    // remove it from selection list
}


/**
 * called to select"m_bestServer" best available server based on selection criteria.
 * "m_bestServer" contains serverInfo that should a new account get attatched to.
 * Save communication server handles the same account.
 * server should be available and online.
 * @todo: NOT IMPLEMENTED ... store status in Database.
 */
function fn_SelectBestServer ()
{
    const now = Date.now();
    const c_servers= Object.keys(m_communicationServersList); // node v6 compatible instead of using object.values
    const c_count = c_servers.length;
    
    let v_serverInfo;
	for (var i = 0 ; i< c_count; ++i )
	{
		v_serverInfo = m_communicationServersList[c_servers[i]];
		
        if (v_serverInfo.m_server.m_isOnline == true)
        {    
            if ((m_bestServer == null) || (m_bestServer.m_isOnline === false))
            {
                m_bestServer = v_serverInfo;
                //console.log ('best server is %s', m_bestServer.server.m_serverId);
            }
            else
            {
                if (v_serverInfo.m_server.m_accounts.length < m_bestServer.m_server.m_accounts.length)
                {
                    // this is a less used server;
                    if (m_bestServer !== v_serverInfo)
                    {
                        m_bestServer = v_serverInfo;       
                        //console.log ('best server is %s', m_bestServer.server.m_serverId);
                    }
                    
                    //console.log ('best server is %s', m_bestServer.server.m_serverId);
                }
            }
        }
        	
    }
}



/**
 * Handles info messages sent by communication servers.
 * This helps to maintain list of available servers.
 * @param {decrypted raw command} p_cmd 
 */
function fn_handleServerInfo (p_cmd)
{
    try
    {
        const p_server = p_cmd.d;
        var v_msg = {};
                // used for obfuscation
                v_msg.m_isOnline            = p_server.isOnline;
                v_msg.m_version             = p_server.version;
                v_msg.m_serverId            = p_server.serverId;
                v_msg.m_serverPublicIP      = p_server.public_host;
                v_msg.m_serverPort          = p_server.serverPort;
                //v_msg.m_wsauthkey           = p_server.wsauthkey;
                v_msg.m_accounts            = p_server.accounts;
                v_msg.m_commServerGUID      = p_cmd.m_commServerGUID;

        p_server.m_commServerGUID = p_cmd.m_commServerGUID;

        //console.log (JSON.stringify(server));
        p_server.lastActiveTime = Date.now();

        if (m_communicationServersList.hasOwnProperty(p_server.m_commServerGUID))
        {
            // Server is already defined.
            var v_srvInfo = m_communicationServersList[p_server.m_commServerGUID];
            

            if (v_srvInfo.m_server.m_isOnline != v_msg.m_isOnline)
            {   // isOnline Changed

                v_srvInfo.m_server = p_server;
                if (v_msg.m_isOnline == true)
                {  // server is online again
                    fn_onServerRestored(v_srvInfo);
                }
                else
                {   // server is offline
                    fn_onServerDisconnect (v_srvInfo);        
                }
                    
            }
            else
            {   // no change .. update other parameters if any
                v_srvInfo.m_server = v_msg;
            }
                
        }
        else
        {
            // Define a new server
            m_communicationServersList[p_server.m_commServerGUID] = {
                m_server : v_msg,
            };

            fn_onServerAdded (m_communicationServersList[p_server.m_commServerGUID]);
                
            
        }

        fn_SelectBestServer();
    }
    catch (ex)
    {
        
    }
}

/**
 * Handles login response for a login request.
 * This function contains reply from Andruav Comm Server regarding the request of joining a unit/web to Andruav Comm Server chat.
 * @param {decrypted raw command} p_cmd 
 */
function fn_handleLoginResponses (p_cmd)
{

    const c_rep = {};
    const c_RequestID = p_cmd.d[global.c_CONSTANTS.CONST_CS_REQUEST_ID]; 
    const c_sessionRequest = m_waitingForServerLogin[c_RequestID];

    if ((c_sessionRequest == null) || (p_cmd.d[global.c_CONSTANTS.CONST_CS_ERROR.toString()] !== global.c_CONSTANTS.CONST_ERROR_NON))
    {
        // c_sessionRequest == null if CONST_LOGIN_REQUEST_TIMEOUT triggered

        // send failure to client
        c_rep[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_SERVER_NOT_AVAILABLE;
        c_sessionRequest.m_client_conn_feedback (c_rep);
        return ;
    }


    c_sessionRequest.m_loginCard.m_commServerGUID = p_cmd.m_commServerGUID;

    c_rep[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_NON;
    c_rep[global.c_CONSTANTS.CONST_SESSION_ID.toString()] = c_sessionRequest.m_loginCard.m_session_id;
    c_rep[global.c_CONSTANTS.CONST_PERMISSION.toString()] = c_sessionRequest.m_loginCard.m_data.m_permission;
    c_rep[global.c_CONSTANTS.CONST_PERMISSION2.toString()] = c_sessionRequest.m_loginCard.m_data.m_prm;
    
    const c_commServer = {};
    c_commServer[global.c_CONSTANTS.CONST_CS_LOGIN_TEMP_KEY.toString()] = p_cmd.d[global.c_CONSTANTS.CONST_CS_LOGIN_TEMP_KEY];
    c_commServer[global.c_CONSTANTS.CONST_CS_SERVER_PUBLIC_HOST.toString()] = p_cmd.d[global.c_CONSTANTS.CONST_CS_SERVER_PUBLIC_HOST.toString()];
    c_commServer[global.c_CONSTANTS.CONST_CS_SERVER_PORT.toString()] = p_cmd.d[global.c_CONSTANTS.CONST_CS_SERVER_PORT.toString()];
    c_sessionRequest.m_loginCard.m_serverInfo = c_commServer;
    //c_rep[global.c_CONSTANTS.CONST_COMM_SERVER.toString()] = c_commServer;
    
    c_sessionRequest.m_client_conn_feedback (c_sessionRequest.m_loginCard);

    delete m_waitingForServerLogin[c_RequestID];
}


/**
 * Handles communication servers all messages.
 * @param {a GUID identifies connection instance. this refers to websocket client in case of using websockets.} p_conn_GUID 
 * @param {raw encrypted message from communication servers} p_msg 
 */
function fn_commServerMessageHandler (p_conn_GUID,p_msg)
{
    try
    {
        const p_cmd = fn_decryptCommunicationMessage (p_msg);
        p_cmd['m_commServerGUID'] = p_conn_GUID;
        if (p_cmd == null)
        {
            // invalid command
            return;
        }

        if (p_cmd.c === global.c_CONSTANTS.CONST_CS_CMD_INFO)
        {   // send once when connection established
            fn_handleServerInfo (p_cmd);
        }
        else if (p_cmd.c === global.c_CONSTANTS.CONST_CS_CMD_LOGIN_REQUEST)
        {   // send as reply to LOGIN REQUEST
            fn_handleLoginResponses (p_cmd);
        }
    }
    catch (ex)
    {
        console.log ("err:fn_commServerMessageHandler:" + ex);
    }
}


/**
 *  check if server is available and if this particular account is handlered by a specific server.
 *    
 * @param {*} p_loginCard 
 * @param {*} fn_callback 
 */
function fn_selectServerforAccount (p_loginCard)
{
    
    var selectedServer = fn_getServerCurrentlyServerAccountID (p_loginCard);
    if (selectedServer != null)
    {
        // there is a server already serving this account.
    }
    else 
    {
        fn_SelectBestServer();
        // this is a fresh account then use "m_bestServer"
        selectedServer = m_bestServer;
    }

    if ((selectedServer == null) || (selectedServer.m_server.m_isOnline == false))
    {
        return null;
    }

    return selectedServer;
}



/**
 * Generate Login key from available Communication Server.
 * @param {*} p_loginCard 
 * @param {server proposed by system to handle communication} p_server 
 * @param {*} fn_success 
 * @param {leads to final reply with CONST_ERROR_SERVER_NOT_AVAILABLE} fn_error 
 */
function fn_requestCommunicationLogin (p_loginCard, p_server, fn_success, fn_error)
{

    var c_requestId=null;
    try
    {
    const c_fn_success = fn_success; 
    if ((p_server == null) || (p_server.m_server.m_isOnline == false))
    {
        fn_error ();

        return ;
    }

    c_requestId =   c_uuidv4.v4(); // p_loginCard.m_acc_id_hashed; //m_senderID;
    m_waitingForServerLogin [c_requestId] = 
        {
            'm_loginCard': p_loginCard,
            'm_client_conn_feedback': c_fn_success,
            'm_timestamp': new Date()
        }


    const c_reply = {
        'c': global.c_CONSTANTS.CONST_CS_CMD_LOGIN_REQUEST, // request party login
        'd': {}
    };
    
    c_reply.d [global.c_CONSTANTS.CONST_CS_REQUEST_ID.toString()]  =  c_requestId;
    c_reply.d [global.c_CONSTANTS.CONST_CS_ACCOUNT_ID.toString()]  =  p_loginCard.m_acc_id_hashed; // account sid needed as it is the parent of room chat.
    c_reply.d [global.c_CONSTANTS.CONST_CS_GROUP_ID.toString()]    =  p_loginCard[global.c_CONSTANTS.CONST_CS_GROUP_ID.toString()]; // group ID as it is the room chat id
    c_reply.d [global.c_CONSTANTS.CONST_ACTOR_TYPE.toString()]     =  p_loginCard.m_actorType;
    c_reply.d [global.c_CONSTANTS.CONST_INSTANCE_LIMIT.toString()] =  p_loginCard.m_data.m_instance_limit;
    c_reply.d [global.c_CONSTANTS.CONST_PERMISSION2.toString()]    =  p_loginCard.m_data.m_prm;
    

    Me.fn_sendMessage (p_server.m_server.m_commServerGUID, JSON.stringify(c_reply));
    }

    finally
    {
        // COMMENT TO ALLOW DEBUGGING
        // setTimeout (function ()
        // {
        //     // in case there no reply from AndruavServer then AndruavAuth should reply to agent to close the waiting connection.
        //     if (c_senderID==null) return ;

        //     if (m_waitingForServerLogin.hasOwnProperty(c_senderID))
        //     {
        //         // connection is still waiting -unless there is racing- so delete then close connection.
        //         delete m_waitingForServerLogin [c_senderID];
        //         fn_error ();
        //     }
            
        // }, CONST_LOGIN_REQUEST_TIMEOUT);
    }
}

/**
 * @todo NOT IMPLEMENTED
 * @param {server to communicate with.} p_selectedServer 
 */
function fn_removePartyCommunicationSession (p_loginCard)
{
    if ((p_loginCard == null) || (p_loginCard.hasOwnProperty('m_commServerGUID')===false))
    {
        // no broadcast yet
        // @todo: you may enable broadcast later if needed.
        return ; 
    }

    //const c_serverInfo = c_sessionRequest.m_loginCard.m_commServerGUID;

    const c_req = {
        'c':global.c_CONSTANTS.CONST_CS_CMD_LOGOUT_REQUEST, // request party remove        
        'd': {}
    };

    c_req.d[global.c_CONSTANTS.CONST_CS_SENDER_ID.toString()] = p_loginCard.m_senderID;

    Me.fn_sendMessage (p_loginCard.m_commServerGUID,JSON.stringify(c_req));
}


/**
 * Callback function linked to @module js_comm_server_manager 
 * @param {*} p_conn_guid 
 * @param {*} p_code 
 */
function fn_ServerUpdated (p_conn_guid, p_code)
{
    if (m_communicationServersList.hasOwnProperty(p_conn_guid) === true)
    {
        m_bestServer  = null;
        
        fn_onServerDisconnect (m_communicationServersList[p_conn_guid]);
        delete m_communicationServersList[p_conn_guid];

    }

    fn_SelectBestServer();
}


function fn_initialize ()
{
    Me = this;
}

exports.fn_sendMessage = function () {};

module.exports = {
    fn_ServerUpdated:  fn_ServerUpdated,
    fn_commServerMessageHandler: fn_commServerMessageHandler,
    fn_selectServerforAccount: fn_selectServerforAccount,
    fn_getServerCurrentlyServerAccountID:fn_getServerCurrentlyServerAccountID,
    fn_removePartyCommunicationSession: fn_removePartyCommunicationSession,
    fn_requestCommunicationLogin:fn_requestCommunicationLogin,
    fn_initialize:fn_initialize
};