"use strict";

/**
 * Server Manager Server is a websocket server that listen to 
 * communication servers.
 * This Server handles traffic between Auth Server and Communication Server(s).
 * However this module is not responsible for parsing and processing this traffic.
 */

const uuid = require('uuid');

var Me;
const m_ws = {};


/**
 * Called when a communication server connects using websocket to this AuthServer.
 * @param {communication server client websocket} v_webSocket 
 * @param {websocket request} p_request 
 */
function fn_onConnect_Handler(v_webSocket,p_request)
{
    v_webSocket.upgradeReq = p_request;
    v_webSocket.m_guid = uuid.v4();

    m_ws[v_webSocket.m_guid] = v_webSocket;

    function fn_onWsMessage (p_msg)
    {
        Me.fn_onMessageReceived(this.m_guid, p_msg);
    }


    function fn_onWsClose (p_code)
    {
        console.log (global.Colors.Error + "[ATTENTION!!] Closed with Communication Server"  + global.Colors.Reset);
        Me.fn_onServerClosed (v_webSocket.m_guid,p_code);
        if (m_ws.hasOwnProperty(v_webSocket.m_guid) === true)
        {
            delete m_ws[v_webSocket.m_guid];
        }
    }


    function fn_onWsError (p_err)
    {
        console.log (global.Colors.Error + "[ATTENTION!!] Closed with Communication Server"  + global.Colors.Reset + p_err);

    }

    v_webSocket.on('message', fn_onWsMessage);
    v_webSocket.on('close', fn_onWsClose);
    v_webSocket.on('error', fn_onWsError);

}

/**
 * Sends data to a communication server.
 * @param {web socket guid} p_conn_guid 
 * @param {message to send.} p_message 
 */
function fn_sendMessage (p_conn_guid,p_message)
{
    try
    {
    if (m_ws.hasOwnProperty(p_conn_guid)===true)
    {
        const c_ws = m_ws[p_conn_guid];
        c_ws.send(p_message);
    }
    }
    catch (e)
    {
        console.log('broadcast :ws:' + p_conn_guid + ' Orphan socket Error:' + e);
        console.log('========================================');
        if (c_ws != null)
        { // Most propably this is the same socket disconnected silently.
            try
            {
                delete c_ws [p_conn_guid]

            }
            catch (e)
            {
                console.error (e);
            }
        }  
    }
}

/**
 * Starts WebSocket Server that listens to Communication Servers.
 * This is server-server connection.
 */
function fn_startWebSocketListener()
{

    const v_express           = require('express');
    const v_fs                = require('fs');
    const v_path              = require('path');
    const v_WebSocketServer   = require('ws').Server;
    const c_https             = require('https');

    
    const options = {
        key:  v_fs.readFileSync(v_path.join(__dirname, "../" + global.m_serverconfig.m_configuration.ssl_key_file.toString())),
        cert: v_fs.readFileSync(v_path.join(__dirname, "../" + global.m_serverconfig.m_configuration.ssl_cert_file.toString()))
		};


    const wserver = c_https.createServer(options, new v_express());
    wserver.listen(global.m_serverconfig.m_configuration.s2s_ws_listening_port,global.m_serverconfig.m_configuration.s2s_ws_listening_ip); // start websocket server [secure]	

    const v_wss = new v_WebSocketServer(
    {
        server: wserver
    }); 

    v_wss.on('connection', fn_onConnect_Handler)

}

function fn_startServer ()
{
    Me = this;

    console.log (global.Colors.Success + "[OK] Comm Server Manager Started at port " + global.m_serverconfig.m_configuration.s2s_ws_listening_port  + global.Colors.Reset);

    fn_startWebSocketListener();
}

/**
 * 
 */
exports.fn_onMessageReceived = function (p_p_conn_guid, p_msg){};
exports.fn_onServerClosed = function (p_p_conn_guid, p_code){};

module.exports = {
    fn_startServer: fn_startServer,
    fn_sendMessage: fn_sendMessage
};