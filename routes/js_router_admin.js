"use strict";

const express = require('express');
const router = express.Router();
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const csrf = require('csurf');

// Configure session
router.use(session({
    secret: global.m_serverconfig.m_configuration.session_secret || 'change-this-secret-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: true, // HTTPS only
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Configure rate limiting for login attempts
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts per window
    message: { error: 'Too many login attempts, please try again later' }
});

// CSRF protection
const csrfProtection = csrf({ cookie: true });

// Authentication middleware
function requireAuth(req, res, next) {
    if (req.session && req.session.adminAuthenticated) {
        return next();
    }
    return res.redirect('/admin/login');
}

// Login page
router.get('/login', csrfProtection, (req, res) => {
    res.render('admin/login', {
        csrfToken: req.csrfToken(),
        error: req.session.error,
        title: 'Admin Login'
    });
    req.session.error = null;
});

// Login authentication
router.post('/login', loginLimiter, csrfProtection, (req, res) => {
    const { username, password } = req.body;
    const config = global.m_serverconfig.m_configuration;

    if (username === config.admin_username && password === config.admin_password) {
        req.session.adminAuthenticated = true;
        req.session.adminUsername = username;
        return res.redirect('/admin/dashboard');
    } else {
        req.session.error = 'Invalid username or password';
        return res.redirect('/admin/login');
    }
});

// Logout
router.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Error destroying session:', err);
        }
        res.redirect('/admin/login');
    });
});

// Dashboard (protected)
router.get('/dashboard', requireAuth, (req, res) => {
    res.render('admin/dashboard', {
        title: 'Admin Dashboard',
        adminUsername: req.session.adminUsername
    });
});

// Users page (protected)
router.get('/users', requireAuth, (req, res) => {
    res.render('admin/users', {
        title: 'User Management',
        adminUsername: req.session.adminUsername
    });
});

// Servers page (protected)
router.get('/servers', requireAuth, (req, res) => {
    res.render('admin/servers', {
        title: 'Server Status',
        adminUsername: req.session.adminUsername
    });
});

// API: Get all users
router.get('/api/users', requireAuth, async (req, res) => {
    try {
        console.log('[DEBUG] Fetching users for admin:', req.session.adminUsername);
        console.log('[DEBUG] Using global.db_users:', !!global.db_users);
        const users = global.db_users.fn_get_all_users_including_admins();
        console.log('[DEBUG] Users fetched:', Object.keys(users).length);
        res.json({ error: 0, users });
    } catch (error) {
        console.error('[ERROR] Error fetching users:', error);
        console.error('[ERROR] Stack:', error.stack);
        res.json({ error: 1, errorMessage: 'Failed to fetch users' });
    }
});

// API: Create user
router.post('/api/users', requireAuth, async (req, res) => {
    try {
        const { email, sid, prm, isadmin } = req.body;

        if (!email || !sid || !prm) {
            return res.json({ error: 1, errorMessage: 'Missing required fields' });
        }

        const { v4: uuidv4 } = require('uuid');
        const generatedAccessCode = uuidv4().replaceAll('-', '').substr(0, 12);

        // Use global.db_users instead of creating new instance
        const db = global.db_users;

        // Check if user already exists
        const existingUser = db.fn_get_record(email);

        if (existingUser) {
            // User exists, update instead - don't regenerate AccessCode
            await db.fn_update_record(email, { sid, AccessCode: existingUser.AccessCode, prm, isadmin: isadmin || false }, (reply) => {
                const errorCode = reply[global.c_CONSTANTS.CONST_ERROR.toString()];
                if (errorCode === global.c_CONSTANTS.CONST_ERROR_NON) {
                    res.json({ error: 0, AccessCode: existingUser.AccessCode });
                } else {
                    res.json({ error: errorCode, errorMessage: reply[global.c_CONSTANTS.CONST_ERROR_MSG.toString()] || 'Failed to update user' });
                }
            });
        } else {
            // New user, add record with auto-generated AccessCode
            await db.fn_add_record(email, { sid, AccessCode: generatedAccessCode, prm, isadmin: isadmin || false }, (reply) => {
                const errorCode = reply[global.c_CONSTANTS.CONST_ERROR.toString()];
                if (errorCode === global.c_CONSTANTS.CONST_ERROR_NON) {
                    res.json({ error: 0, AccessCode: generatedAccessCode });
                } else {
                    res.json({ error: errorCode, errorMessage: reply[global.c_CONSTANTS.CONST_ERROR_MSG.toString()] || 'Failed to create user' });
                }
            });
        }
    } catch (error) {
        console.error('Error creating user:', error);
        res.json({ error: 1, errorMessage: 'Failed to create user' });
    }
});

// API: Update user
router.put('/api/users/:email', requireAuth, async (req, res) => {
    try {
        const { email } = req.params;
        const { sid, prm, isadmin } = req.body;

        if (!sid || !prm) {
            return res.json({ error: 1, errorMessage: 'Missing required fields' });
        }

        // Use global.db_users instead of creating new instance
        const db = global.db_users;

        // Get existing user to preserve AccessCode
        const existingUser = db.fn_get_record(email);
        if (!existingUser) {
            return res.json({ error: 1, errorMessage: 'User not found' });
        }

        await db.fn_update_record(email, { sid, AccessCode: existingUser.AccessCode, prm, isadmin: isadmin || false }, (reply) => {
            const errorCode = reply[global.c_CONSTANTS.CONST_ERROR.toString()];
            if (errorCode === global.c_CONSTANTS.CONST_ERROR_NON) {
                res.json({ error: 0, AccessCode: existingUser.AccessCode });
            } else {
                res.json({ error: errorCode, errorMessage: reply[global.c_CONSTANTS.CONST_ERROR_MSG.toString()] || 'Failed to update user' });
            }
        });
    } catch (error) {
        console.error('Error updating user:', error);
        res.json({ error: 1, errorMessage: 'Failed to update user' });
    }
});

// API: Delete user
router.delete('/api/users/:email', requireAuth, async (req, res) => {
    try {
        const { email } = req.params;
        // Use global.db_users instead of creating new instance
        const db = global.db_users;

        await db.fn_delete_record(email);
        res.json({ error: 0 });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.json({ error: 1, errorMessage: 'Failed to delete user' });
    }
});

// API: Get server status
router.get('/api/servers', requireAuth, (req, res) => {
    try {
        const commServerManager = require('../auth_server/js_comm_server_manager');
        const serversList = commServerManager.getCommunicationServersList();

        const servers = Object.values(serversList).map(serverInfo => ({
            serverId: serverInfo.m_server.m_serverId,
            isOnline: serverInfo.m_server.m_isOnline,
            public_host: serverInfo.m_server.m_serverPublicIP,
            serverPort: serverInfo.m_server.m_serverPort,
            version: serverInfo.m_server.m_version,
            accounts: serverInfo.m_server.m_accounts || []
        }));

        res.json({ error: 0, servers });
    } catch (error) {
        console.error('Error fetching server status:', error);
        res.json({ error: 1, errorMessage: 'Failed to fetch server status' });
    }
});

module.exports = router;
