"use strict";

/**
 * Server Manager Server is a websocket server that listens to 
 * communication servers.
 * This server handles traffic between the Auth Server and Communication Server(s).
 * However, this module is not responsible for parsing and processing this traffic.
 */

const uuidv4 = require('uuid').v4;
const express = require('express');
const fs = require('fs');
const path = require('path');
const WebSocketServer = require('ws').Server;
const https = require('https');

let Me;
const m_ws = {}; // Stores connected WebSocket clients

/**
 * Called when a communication server connects using WebSocket to this AuthServer.
 * @param {WebSocket} v_webSocket - The WebSocket connection instance.
 * @param {Object} p_request - The WebSocket request object.
 */
function fn_onConnect_Handler(v_webSocket, p_request) {
    v_webSocket.upgradeReq = p_request;
    v_webSocket.m_guid = uuidv4(); // Generate a unique GUID for the connection

    m_ws[v_webSocket.m_guid] = v_webSocket; // Store the WebSocket connection

    if (global.m_logger) {
        global.m_logger.Info('Communication server connecting...', 'fn_onConnect_Handler');
    }

    /**
     * Handles incoming WebSocket messages.
     * @param {string} p_msg - The message received from the WebSocket.
     */
    function fn_onWsMessage(p_msg) {
        if (global.m_logger) {
            global.m_logger.Debug('WS Msg', 'fn_onWsMessage', null, p_msg);
        }
        Me.fn_onMessageReceived(this.m_guid, p_msg);
    }

    /**
     * Handles WebSocket connection close events.
     * @param {number} p_code - The close code.
     */
    function fn_onWsClose(p_code) {
        console.log(global.Colors.Error + "[ATTENTION!!] Closed with Communication Server" + global.Colors.Reset);
        if (global.m_logger) {
            global.m_logger.Warn('WS Closing', 'fn_onWsClose');
        }

        Me.fn_onServerClosed(v_webSocket.m_guid, p_code);
        if (m_ws[v_webSocket.m_guid]) {
            delete m_ws[v_webSocket.m_guid]; // Clean up the WebSocket connection
        }
    }

    /**
     * Handles WebSocket errors.
     * @param {Error} p_err - The error object.
     */
    function fn_onWsError(p_err) {
        console.log(global.Colors.Error + "[ATTENTION!!] Error with Communication Server" + global.Colors.Reset, p_err);
        if (global.m_logger) {
            global.m_logger.Error('WS Error', 'fn_onWsError', null, p_err);
        }
    }

    // Attach event listeners to the WebSocket
    v_webSocket.on('message', fn_onWsMessage);
    v_webSocket.on('close', fn_onWsClose);
    v_webSocket.on('error', fn_onWsError);
}

/**
 * Sends data to a communication server.
 * @param {string} p_conn_guid - The GUID of the WebSocket connection.
 * @param {string} p_message - The message to send.
 */
function fn_sendMessage(p_conn_guid, p_message) {
    try {
        if (m_ws[p_conn_guid]) {
            const c_ws = m_ws[p_conn_guid];
            c_ws.send(p_message);
        }
    } catch (e) {
        console.error('broadcast :ws:' + p_conn_guid + ' Orphan socket Error:', e);
        if (m_ws[p_conn_guid]) {
            try {
                delete m_ws[p_conn_guid]; // Clean up the orphaned WebSocket connection
            } catch (e) {
                console.error('Error deleting WebSocket connection:', e);
            }
        }
    }
}

/**
 * Starts the WebSocket server that listens to Communication Servers.
 * This is a server-server connection.
 */
function fn_startWebSocketListener() {
    const app = express();
    const options = {
        key: fs.readFileSync(path.join(__dirname, "../" + global.m_serverconfig.m_configuration.ssl_key_file)),
        cert: fs.readFileSync(path.join(__dirname, "../" + global.m_serverconfig.m_configuration.ssl_cert_file))
    };

    const wserver = https.createServer(options, app);
    wserver.listen(global.m_serverconfig.m_configuration.s2s_ws_listening_port, global.m_serverconfig.m_configuration.s2s_ws_listening_ip);

    const v_wss = new WebSocketServer({ server: wserver });
    v_wss.on('connection', fn_onConnect_Handler);
}

/**
 * Starts the server.
 */
function fn_startServer() {
    Me = this;

    console.log(global.Colors.Success + "[OK] Comm Server Manager Started at port " + global.m_serverconfig.m_configuration.s2s_ws_listening_port + global.Colors.Reset);

    fn_startWebSocketListener();
}

// Export functions
module.exports = {
    fn_startServer,
    fn_sendMessage
};