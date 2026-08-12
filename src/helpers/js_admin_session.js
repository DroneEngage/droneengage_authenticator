"use strict";

/**
 * Shared admin session store + middleware.
 *
 * The session middleware is used by the admin Express router, while the
 * store is also needed by the WebSocket terminal handler to authenticate
 * upgrade requests (which bypass Express middleware).
 */

const session = require('express-session');

const sessionSecret = global.m_serverconfig.m_configuration.session_secret || 'change-this-secret-in-production';

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
    store: store
};
