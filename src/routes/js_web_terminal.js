"use strict";

/**
 * Web Terminal — PTY over WebSocket
 *
 * Attaches a WebSocket server to the views HTTP(S) server.  On connection
 * (after admin-session authentication) a persistent pseudo-terminal shell
 * is spawned with node-pty.  All PTY output is forwarded to the browser and
 * all keystrokes from the browser are written to the PTY — giving a real
 * interactive terminal that supports sudo password prompts, curses apps,
 * tab-completion, etc.
 *
 * Security:
 *   - Only the admin session (adminAuthenticated === true) may connect.
 *   - The feature must be enabled via webadmin_terminal_enabled in config.
 *   - The GUID gate is enforced: the upgrade URL must contain the GUID
 *     prefix when servers_admin_url_guid is configured.
 */

const pty = require('node-pty');
const WebSocket = require('ws');
const cookieParser = require('cookie-parser');
const { store } = require('../helpers/js_admin_session');

// Cookie parser configured WITH the session secret so that signed cookies
// (the s:VALUE.SIG format used by express-session) are automatically
// unsigned and placed in req.signedCookies.
const sessionSecret = global.m_serverconfig.m_configuration.session_secret || 'change-this-secret-in-production';
const parseCookies = cookieParser(sessionSecret);

// Session cookie name — express-session default
const SESSION_COOKIE_NAME = 'connect.sid';

/**
 * Extract and verify the admin session from a WebSocket upgrade request.
 * Calls back with (err, session) where session is the express-session
 * object or null if not authenticated.
 */
function authenticateUpgrade(req, callback) {
    parseCookies(req, {}, function () {
        // cookie-parser with a secret unsigns s:VALUE.SIG cookies and
        // puts the unsigned value in req.signedCookies.  If the signature
        // is invalid, the value is false.
        const sid = req.signedCookies && req.signedCookies[SESSION_COOKIE_NAME];
        if (!sid || sid === false) {
            return callback(null, null);
        }
        store.get(sid, function (err, session) {
            if (err || !session) {
                return callback(err, null);
            }
            callback(null, session);
        });
    });
}

/**
 * Check whether the terminal feature is enabled in config.
 */
function isTerminalEnabled() {
    const cfg = global.m_serverconfig.m_configuration;
    return cfg && cfg.webadmin_terminal_enabled !== false;
}

/**
 * Build the WebSocket path pattern that the upgrade handler should match.
 * Returns a RegExp that matches /admin/<guid>/api/terminal/ws or /admin/api/terminal/ws
 */
function buildPathRegex() {
    const guid = global.m_serverconfig.m_configuration.servers_admin_url_guid || '';
    if (guid) {
        // Match both /admin/<guid>/api/terminal/ws  (GUID in path)
        // and /admin/api/terminal/ws               (authenticated, no GUID)
        return new RegExp('^/admin/(?:' + escapeRegex(guid) + '/)?api/terminal/ws$');
    }
    return new RegExp('^/admin/api/terminal/ws$');
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Attach the WebSocket terminal handler to an HTTP(S) server.
 *
 * @param {http.Server} httpServer - the views server instance
 */
function attachWebSocketServer(httpServer) {
    const wss = new WebSocket.Server({ noServer: true });

    httpServer.on('upgrade', function (request, socket, head) {
        const url = new URL(request.url, 'http://localhost');
        const pathname = url.pathname;

        const pathRegex = buildPathRegex();
        if (!pathRegex.test(pathname)) {
            // Not our route — let other handlers deal with it (or drop)
            return;
        }

        // Feature disabled
        if (!isTerminalEnabled()) {
            socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
            socket.destroy();
            return;
        }

        // Origin check — prevent Cross-Site WebSocket Hijacking (CSWSH).
        // Browsers always send the Origin header on WebSocket upgrades; if it
        // is missing or does not match the Host header, reject the request.
        const origin = request.headers.origin;
        const host = request.headers.host;
        if (!origin || !host) {
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            socket.destroy();
            return;
        }
        let originHost;
        try {
            originHost = new URL(origin).host;
        } catch (e) {
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            socket.destroy();
            return;
        }
        if (originHost !== host) {
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            socket.destroy();
            return;
        }

        // Authenticate via session cookie
        authenticateUpgrade(request, function (err, session) {
            if (err || !session || !session.adminAuthenticated) {
                socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                socket.destroy();
                return;
            }

            // Accept the WebSocket upgrade
            wss.handleUpgrade(request, socket, head, function (ws) {
                handleConnection(ws, session);
            });
        });
    });

    wss.on('connection', function (ws, request) {
        // handleConnection is called from handleUpgrade callback
    });

    console.log(global.Colors.Success + "[OK] Web Terminal WebSocket handler attached" + global.Colors.Reset);
}

/**
 * Handle a single WebSocket connection — spawn a PTY and pipe data.
 */
function handleConnection(ws, session) {
    const shell = process.env.SHELL || '/bin/bash';
    const cwd = session.terminalCwd || process.cwd();
    const user = session.adminUsername || 'admin';

    let ptyProcess;
    try {
        ptyProcess = pty.spawn(shell, [], {
            name: 'xterm-256color',
            cols: 80,
            rows: 24,
            cwd: cwd,
            env: Object.assign({}, process.env, {
                TERM: 'xterm-256color',
                COLORTERM: 'truecolor'
            })
        });
    } catch (err) {
        console.error('[WebTerminal] Failed to spawn PTY:', err);
        ws.send(JSON.stringify({ type: 'error', message: 'Failed to spawn terminal: ' + err.message }));
        ws.close();
        return;
    }

    // PTY output → browser
    ptyProcess.onData(function (data) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'output', data: data }));
        }
    });

    // PTY exit → close WebSocket
    ptyProcess.onExit(function (e) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'exit', exitCode: e.exitCode, signal: e.signal }));
            ws.close();
        }
    });

    // Browser → PTY
    ws.on('message', function (msg) {
        try {
            const parsed = JSON.parse(msg);
            if (parsed.type === 'input') {
                ptyProcess.write(parsed.data);
            } else if (parsed.type === 'resize') {
                if (parsed.cols && parsed.rows) {
                    ptyProcess.resize(parsed.cols, parsed.rows);
                }
            }
        } catch (e) {
            // Non-JSON or invalid message — ignore
        }
    });

    // WebSocket close → kill PTY
    ws.on('close', function () {
        try {
            ptyProcess.kill();
        } catch (e) {
            // Already dead
        }
    });

    ws.on('error', function () {
        try {
            ptyProcess.kill();
        } catch (e) {
            // Already dead
        }
    });

    // Send initial greeting
    ws.send(JSON.stringify({
        type: 'ready',
        cwd: cwd,
        user: user,
        shell: shell
    }));
}

module.exports = {
    attachWebSocketServer: attachWebSocketServer
};
