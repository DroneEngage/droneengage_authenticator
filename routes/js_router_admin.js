"use strict";

const express = require('express');
const router = express.Router();
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const csrf = require('csurf');
const helmet = require('helmet');
const { isValidAdminUsername, isValidAdminPassword } = require('../helpers/hlp_validation');

// Configure session
router.use(session({
    secret: global.m_serverconfig.m_configuration.session_secret || 'change-this-secret-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: global.m_serverconfig.m_configuration.enable_SSL || false, // HTTPS only when SSL enabled
        httpOnly: true,
        maxAge: 2 * 60 * 60 * 1000 // 2 hours
    }
}));

// Configure Content Security Policy
router.use(helmet.contentSecurityPolicy({
    directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"]
    }
}));

// Configure rate limiting for login attempts
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts per window
    message: { error: 'Too many login attempts, please try again later' }
});

// Account lockout tracking
const failedAttempts = new Map(); // key: "ip:username", value: { count, lastAttempt }

function isAccountLocked(ip, username) {
    const key = `${ip}:${username}`;
    const record = failedAttempts.get(key);
    if (!record) return false;
    
    const lockoutDuration = 30 * 60 * 1000; // 30 minutes
    const timeSinceLastAttempt = Date.now() - record.lastAttempt;
    
    if (timeSinceLastAttempt > lockoutDuration) {
        failedAttempts.delete(key);
        return false;
    }
    
    return record.count >= 5;
}

function recordFailedAttempt(ip, username) {
    const key = `${ip}:${username}`;
    const record = failedAttempts.get(key) || { count: 0, lastAttempt: 0 };
    record.count++;
    record.lastAttempt = Date.now();
    failedAttempts.set(key, record);
}

function clearFailedAttempts(ip, username) {
    const key = `${ip}:${username}`;
    failedAttempts.delete(key);
}

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
    const clientIp = req.ip || req.connection.remoteAddress;

    // Input validation
    if (!isValidAdminUsername(username)) {
        req.session.error = 'Invalid username format';
        return res.redirect('/admin/login');
    }

    if (!isValidAdminPassword(password)) {
        req.session.error = 'Invalid password format';
        return res.redirect('/admin/login');
    }

    // Check account lockout
    if (isAccountLocked(clientIp, username)) {
        req.session.error = 'Account temporarily locked due to too many failed attempts. Please try again later.';
        return res.redirect('/admin/login');
    }

    if (username === config.admin_username && password === config.admin_password) {
        // Successful login - clear failed attempts
        clearFailedAttempts(clientIp, username);
        req.session.adminAuthenticated = true;
        req.session.adminUsername = username;
        return res.redirect('/admin/dashboard');
    } else {
        // Failed login - record attempt
        recordFailedAttempt(clientIp, username);
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
        adminUsername: req.session.adminUsername,
        accountStorageType: global.m_serverconfig.m_configuration.account_storage_type
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

// SQL Management page (protected)
router.get('/sql-management', requireAuth, (req, res) => {
    res.render('admin/sql-management', {
        title: 'Teams & Logins Management',
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
        const { email, sid, prm, isadmin, accessCode } = req.body;

        if (!email || !sid || !prm) {
            return res.json({ error: 1, errorMessage: 'Missing required fields' });
        }

        const { v4: uuidv4 } = require('uuid');
        const generatedAccessCode = (accessCode && accessCode.trim() !== '')
            ? accessCode.trim()
            : uuidv4().replaceAll('-', '').substr(0, 12);

        // Use global.db_users instead of creating new instance
        const db = global.db_users;

        // Check if user already exists
        const existingUser = db.fn_get_record(email);

        if (existingUser) {
            // User exists, update instead - preserve existing AccessCode unless one is provided
            const finalAccessCode = (accessCode && accessCode.trim() !== '')
                ? accessCode.trim()
                : existingUser.AccessCode;
            await db.fn_update_record(email, { sid, AccessCode: finalAccessCode, prm, isadmin: isadmin || false }, (reply) => {
                const errorCode = reply[global.c_CONSTANTS.CONST_ERROR.toString()];
                if (errorCode === global.c_CONSTANTS.CONST_ERROR_NON) {
                    res.json({ error: 0, AccessCode: finalAccessCode });
                } else {
                    res.json({ error: errorCode, errorMessage: reply[global.c_CONSTANTS.CONST_ERROR_MSG.toString()] || 'Failed to update user' });
                }
            });
        } else {
            // New user, add record with provided or auto-generated AccessCode
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
        const { sid, prm, isadmin, accessCode } = req.body;

        if (!sid || !prm) {
            return res.json({ error: 1, errorMessage: 'Missing required fields' });
        }

        // Use global.db_users instead of creating new instance
        const db = global.db_users;

        // Get existing user to preserve AccessCode unless one is provided
        const existingUser = db.fn_get_record(email);
        if (!existingUser) {
            return res.json({ error: 1, errorMessage: 'User not found' });
        }

        const finalAccessCode = (accessCode && accessCode.trim() !== '')
            ? accessCode.trim()
            : existingUser.AccessCode;

        await db.fn_update_record(email, { sid, AccessCode: finalAccessCode, prm, isadmin: isadmin || false }, (reply) => {
            const errorCode = reply[global.c_CONSTANTS.CONST_ERROR.toString()];
            if (errorCode === global.c_CONSTANTS.CONST_ERROR_NON) {
                res.json({ error: 0, AccessCode: finalAccessCode });
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
        const sessionManager = require('../auth_server/js_session_manager');
        const serversList = commServerManager.getCommunicationServersList();

        const servers = Object.values(serversList).map(serverInfo => {
            const rawAccounts = serverInfo.m_server.m_accounts || serverInfo.m_server.accounts || [];
            const accountDetails = serverInfo.m_server.m_accountDetails || serverInfo.m_server.accountDetails || {};
            const accounts = [];

            rawAccounts.forEach(accountId => {
                const loginCards = sessionManager.fn_getLoginCardsByAccountId(accountId);
                const loginCard = loginCards.length > 0 ? loginCards[0] : null;
                const loginName = loginCard ? loginCard.m_login_name : 'Unknown';
                const originalAccountId = (loginCard && loginCard.m_data && loginCard.m_data.m_sid != null)
                    ? loginCard.m_data.m_sid
                    : accountId.replace(/xx$/, '');

                const unitDetails = accountDetails[accountId] || [];
                if (unitDetails.length === 0) {
                    accounts.push({
                        accountId: originalAccountId,
                        hashedAccountId: accountId,
                        loginId: loginName,
                        unitName: null,
                        actorType: 'a'
                    });
                } else {
                    unitDetails.forEach(unit => {
                        const unitInfo = (typeof unit === 'string')
                            ? { unitName: unit, actorType: 'a' }
                            : unit;
                        accounts.push({
                            accountId: originalAccountId,
                            hashedAccountId: accountId,
                            loginId: loginName,
                            unitName: unitInfo.unitName,
                            actorType: unitInfo.actorType || 'a'
                        });
                    });
                }
            });

            return {
                serverId: serverInfo.m_server.m_serverId,
                isOnline: serverInfo.m_server.m_isOnline,
                public_host: serverInfo.m_server.m_serverPublicIP,
                serverPort: serverInfo.m_server.m_serverPort,
                version: serverInfo.m_server.m_version,
                accounts: accounts,
                storageStatus: serverInfo.m_server.m_storageStatus || null
            };
        });

        res.json({ error: 0, servers });
    } catch (error) {
        console.error('Error fetching server status:', error);
        res.json({ error: 1, errorMessage: 'Failed to fetch server status' });
    }
});

// API: Get all teams with logins (SQL mode)
router.get('/api/sql/teams', requireAuth, (req, res) => {
    try {
        if (global.m_serverconfig.m_configuration.account_storage_type !== 'db') {
            return res.json({ error: 1, errorMessage: 'SQL mode not enabled' });
        }

        // Access the database connection from the database manager module
        const dbManager = require('../auth_server/js_database_manager');
        // The database connection is stored as a module-level variable in js_database_manager.js
        // We need to access it through a getter or by requiring the module after initialization
        const db = global.m_db; // Set by js_database_manager during initialization

        if (!db) {
            return res.json({ error: 1, errorMessage: 'Database not connected' });
        }

        // Get all teams
        db.all('SELECT * FROM teams ORDER BY TeamID', [], (err, teams) => {
            if (err) {
                console.error('Error fetching teams:', err);
                return res.json({ error: 1, errorMessage: 'Failed to fetch teams' });
            }

            // Get logins for each team
            const teamsWithLogins = teams.map(team => {
                return new Promise((resolve) => {
                    db.all('SELECT * FROM logins WHERE TeamID = ? ORDER BY LoginID', [team.TeamID], (err, logins) => {
                        if (err) {
                            console.error('Error fetching logins for team:', team.TeamID, err);
                            resolve({ ...team, logins: [] });
                        } else {
                            resolve({ ...team, logins: logins || [] });
                        }
                    });
                });
            });

            Promise.all(teamsWithLogins).then(results => {
                res.json({ error: 0, teams: results });
            });
        });
    } catch (error) {
        console.error('Error in /api/sql/teams:', error);
        res.json({ error: 1, errorMessage: 'Failed to fetch teams' });
    }
});

// API: Create team (SQL mode)
router.post('/api/sql/teams', requireAuth, (req, res) => {
    try {
        if (global.m_serverconfig.m_configuration.account_storage_type !== 'db') {
            return res.json({ error: 1, errorMessage: 'SQL mode not enabled' });
        }

        const { teamName, email, instanceLimit, enabled } = req.body;
        const db = global.m_db;

        if (!db) {
            return res.json({ error: 1, errorMessage: 'Database not connected' });
        }

        db.run('INSERT INTO teams (TeamName, Email, InstanceLimit, Enabled) VALUES (?, ?, ?, ?)',
            [teamName, email, instanceLimit, enabled],
            function(err) {
                if (err) {
                    console.error('Error creating team:', err);
                    return res.json({ error: 1, errorMessage: 'Failed to create team' });
                }
                res.json({ error: 0, teamId: this.lastID });
            }
        );
    } catch (error) {
        console.error('Error in POST /api/sql/teams:', error);
        res.json({ error: 1, errorMessage: 'Failed to create team' });
    }
});

// API: Delete team (SQL mode)
router.delete('/api/sql/teams/:id', requireAuth, (req, res) => {
    try {
        if (global.m_serverconfig.m_configuration.account_storage_type !== 'db') {
            return res.json({ error: 1, errorMessage: 'SQL mode not enabled' });
        }

        const teamId = req.params.id;
        const db = global.m_db;

        if (!db) {
            return res.json({ error: 1, errorMessage: 'Database not connected' });
        }

        db.run('DELETE FROM teams WHERE TeamID = ?', [teamId], function(err) {
            if (err) {
                console.error('Error deleting team:', err);
                return res.json({ error: 1, errorMessage: 'Failed to delete team' });
            }
            res.json({ error: 0 });
        });
    } catch (error) {
        console.error('Error in DELETE /api/sql/teams:', error);
        res.json({ error: 1, errorMessage: 'Failed to delete team' });
    }
});

// API: Create login (SQL mode)
router.post('/api/sql/logins', requireAuth, (req, res) => {
    try {
        if (global.m_serverconfig.m_configuration.account_storage_type !== 'db') {
            return res.json({ error: 1, errorMessage: 'SQL mode not enabled' });
        }

        const { teamId, loginName, accessCode, permissions, isAdmin } = req.body;
        const db = global.m_db;

        if (!db) {
            return res.json({ error: 1, errorMessage: 'Database not connected' });
        }

        // Auto-generate access code if not provided
        let finalAccessCode = accessCode;
        if (!finalAccessCode || finalAccessCode.trim() === '') {
            const { v4: uuidv4 } = require('uuid');
            finalAccessCode = uuidv4().replaceAll('-', '').substr(0, 12);
        }

        db.run('INSERT INTO logins (TeamID, LoginName, AccessCode, Permissions, IsAdmin) VALUES (?, ?, ?, ?, ?)',
            [teamId, loginName, finalAccessCode, permissions, isAdmin],
            function(err) {
                if (err) {
                    console.error('Error creating login:', err);
                    return res.json({ error: 1, errorMessage: 'Failed to create login' });
                }
                res.json({ error: 0, loginId: this.lastID, accessCode: finalAccessCode });
            }
        );
    } catch (error) {
        console.error('Error in POST /api/sql/logins:', error);
        res.json({ error: 1, errorMessage: 'Failed to create login' });
    }
});

// API: Delete login (SQL mode)
router.delete('/api/sql/logins/:id', requireAuth, (req, res) => {
    try {
        if (global.m_serverconfig.m_configuration.account_storage_type !== 'db') {
            return res.json({ error: 1, errorMessage: 'SQL mode not enabled' });
        }

        const loginId = req.params.id;
        const db = global.m_db;

        if (!db) {
            return res.json({ error: 1, errorMessage: 'Database not connected' });
        }

        db.run('DELETE FROM logins WHERE LoginID = ?', [loginId], function(err) {
            if (err) {
                console.error('Error deleting login:', err);
                return res.json({ error: 1, errorMessage: 'Failed to delete login' });
            }
            res.json({ error: 0 });
        });
    } catch (error) {
        console.error('Error in DELETE /api/sql/logins:', error);
        res.json({ error: 1, errorMessage: 'Failed to delete login' });
    }
});

module.exports = router;
