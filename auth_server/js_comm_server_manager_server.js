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
const http = require('http');
const c_s2s_auth = require('./js_s2s_auth.js');

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

    // S2S authentication: a Communication Server must prove ownership of the private key
    // before any of its traffic is trusted. Until then the connection is unauthenticated.
    v_webSocket.m_s2s_authed = false;
    let v_authTimer = null;
    if (c_s2s_auth.fn_isEnabled() === true) {
        const c_nonce = c_s2s_auth.fn_generateNonce();
        v_webSocket.m_s2s_nonce = c_nonce;
        v_webSocket.send(c_s2s_auth.fn_buildChallenge(c_nonce));

        v_authTimer = setTimeout(function () {
            if (v_webSocket.m_s2s_authed !== true) {
                console.log(global.Colors.Error + "[ATTENTION!!] Communication Server failed S2S handshake (timeout)" + global.Colors.Reset);
                if (global.m_logger) global.m_logger.Warn('S2S handshake timeout', 'fn_onConnect_Handler');
                v_webSocket.terminate();
            }
        }, c_s2s_auth.CONST_S2S_AUTH_HANDSHAKE_TIMEOUT);
    }
    else {
        v_webSocket.m_s2s_authed = true;
    }

    /**
     * Handles incoming WebSocket messages.
     * @param {string} p_msg - The message received from the WebSocket.
     */
    function fn_onWsMessage(p_msg) {
        // Handshake gate: ignore all traffic until the peer is authenticated.
        if (this.m_s2s_authed !== true) {
            const c_env = c_s2s_auth.fn_parseEnvelope(p_msg);
            if ((c_env != null)
                && (c_env.s2s_auth === c_s2s_auth.CONST_S2S_AUTH_RESPONSE)
                && (c_env.id != null)
                && (c_s2s_auth.fn_verify(this.m_s2s_nonce, c_env.sig, c_env.id) === true)) {
                this.m_s2s_authed = true;
                this.m_s2s_server_id = c_env.id;
                if (v_authTimer != null) clearTimeout(v_authTimer);
                console.log(global.Colors.Success + "[OK] Communication Server passed S2S handshake [" + c_env.id + "]" + global.Colors.Reset);
                if (global.m_logger) global.m_logger.Info('S2S handshake OK', 'fn_onWsMessage', null, c_env.id);
            }
            else {
                console.log(global.Colors.Error + "[ATTENTION!!] Communication Server failed S2S handshake (bad signature or missing id)" + global.Colors.Reset);
                if (global.m_logger) global.m_logger.Warn('S2S handshake rejected', 'fn_onWsMessage');
                this.terminate();
            }
            return;
        }

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
    let wserver;

    if (global.m_serverconfig.m_configuration.enable_SSL === true) {
        const v_keyPath = path.isAbsolute(global.m_serverconfig.m_configuration.ssl_key_file) ? global.m_serverconfig.m_configuration.ssl_key_file : path.join(__dirname, "../" + global.m_serverconfig.m_configuration.ssl_key_file);
        const v_certPath = path.isAbsolute(global.m_serverconfig.m_configuration.ssl_cert_file) ? global.m_serverconfig.m_configuration.ssl_cert_file : path.join(__dirname, "../" + global.m_serverconfig.m_configuration.ssl_cert_file);
        let error = false;

        // Check if SSL files exist before attempting to read them
        if (!fs.existsSync(v_keyPath)) {
            console.error(global.Colors.Error + "[ERROR] Communication Server: Missing SSL key file not found: " + v_keyPath + global.Colors.Reset);
            error = true;
        }

        if (!fs.existsSync(v_certPath)) {
            console.error(global.Colors.Error + "[ERROR] Communication Server: Missing SSL certificate file not found: " + v_certPath + global.Colors.Reset);
            error = true;
        }

        if (error === true) {
            process.exit(1);
        }

        const options = {
            key: fs.readFileSync(v_keyPath),
            cert: fs.readFileSync(v_certPath)
        };

        wserver = https.createServer(options, app);
    } else {
        wserver = http.createServer(app);
    }

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