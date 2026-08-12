"use strict";

/**
 * Shared admin session store + middleware.
 *
 * The session middleware is used by the admin Express router, while the
 * store is also needed by the WebSocket terminal handler to authenticate
 * upgrade requests (which bypass Express middleware).
 */

const session = require('express-session');

const DEFAULT_SESSION_SECRET = 'change-this-secret-in-production';

// Fail hard if session_secret is missing or still the shipped default.
// A weak/absent secret makes session cookies forgeable, so this is a
// hard startup error — same policy already applied to webadmin_listening_ip.
const sessionSecret = global.m_serverconfig.m_configuration.session_secret;
if (!sessionSecret || sessionSecret === DEFAULT_SESSION_SECRET) {
    console.log(global.Colors.BError + 'FATAL ERROR:' + global.Colors.FgYellow +
        ' session_secret ' + global.Colors.Reset +
        ' is missing or still set to the default value in the config file. ' +
        'Set a unique, high-entropy secret before starting the server.');
    process.exit(1);
}

// Use the default in-memory store (same behaviour as before, but now shared)
const store = new session.MemoryStore();

const sessionMiddleware = session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: store,
    cookie: {
        secure: global.m_serverconfig.m_configuration.enable_SSL || false,
        httpOnly: true,
        sameSite: 'strict',
        maxAge: 2 * 60 * 60 * 1000 // 2 hours
    }
});

module.exports = {
    sessionMiddleware: sessionMiddleware,
    store: store,
    sessionSecret: sessionSecret
};
