"use strict";

const express = require('express');
const router = express.Router();
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const csrf = require('csurf');
const helmet = require('helmet');
const { isValidAdminUsername, isValidAdminPassword } = require('../helpers/hlp_validation');
const { sessionMiddleware } = require('../helpers/js_admin_session');
const { isBcryptHash } = require('../helpers/js_config_handler');
const bcrypt = require('bcryptjs');

// Configure session (shared store — also used by WebSocket terminal handler)
router.use(sessionMiddleware);

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

// Per-IP rate limiter for all admin API routes.  Authenticated or not, a
// single client (or a CSRF-driven browser) should not be able to hammer the
// user/team/login CRUD endpoints.  Applied to every /api/* route below.
const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 60, // 60 requests per IP per minute
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 1, errorMessage: 'Too many API requests, please slow down.' }
});

// Account lockout tracking
const failedAttempts = new Map(); // key: "ip:username", value: { count, lastAttempt }
const LOCKOUT_DURATION = 30 * 60 * 1000; // 30 minutes
const FAILED_ATTEMPTS_MAX_ENTRIES = 10000; // cap to prevent unbounded growth

function isAccountLocked(ip, username) {
    const key = `${ip}:${username}`;
    const record = failedAttempts.get(key);
    if (!record) return false;

    const timeSinceLastAttempt = Date.now() - record.lastAttempt;

    if (timeSinceLastAttempt > LOCKOUT_DURATION) {
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
    enforceFailedAttemptsCap();
}

function clearFailedAttempts(ip, username) {
    const key = `${ip}:${username}`;
    failedAttempts.delete(key);
}

// Periodic sweep — evicts stale entries so the map cannot grow without bound
// under a distributed/many-distinct-probe attack.  Runs every 5 minutes and
// drops any entry whose last attempt is older than the lockout window.
setInterval(function sweepFailedAttempts() {
    const now = Date.now();
    for (const [key, record] of failedAttempts) {
        if (now - record.lastAttempt > LOCKOUT_DURATION) {
            failedAttempts.delete(key);
        }
    }
}, 5 * 60 * 1000).unref();

// Safety net: if the map ever exceeds the cap (e.g. a burst before the sweep
// fires), drop the oldest entries first so memory stays bounded.
function enforceFailedAttemptsCap() {
    if (failedAttempts.size <= FAILED_ATTEMPTS_MAX_ENTRIES) return;
    // Build a sorted array of [key, lastAttempt] and remove the oldest.
    const entries = Array.from(failedAttempts.entries())
        .map(([key, record]) => [key, record.lastAttempt])
        .sort((a, b) => a[1] - b[1]);
    const excess = failedAttempts.size - FAILED_ATTEMPTS_MAX_ENTRIES;
    for (let i = 0; i < excess; i++) {
        failedAttempts.delete(entries[i][0]);
    }
}

// CSRF protection
const csrfProtection = csrf({ cookie: true });

// Helper: build an admin URL that includes the GUID prefix when configured
function adminPath(path) {
    const guid = global.m_serverconfig.m_configuration.servers_admin_url_guid;
    if (guid) {
        return '/admin/' + guid + path;
    }
    return '/admin' + path;
}

// Authentication middleware — requires admin login
function requireAuth(req, res, next) {
    if (req.session && req.session.adminAuthenticated) {
        return next();
    }
    return res.redirect(adminPath('/login'));
}

// GUID gate middleware — when servers_admin_url_guid is configured, the entire
// admin site is hidden behind a secret URL.  The GUID acts as a hidden path
// to the login page; users must still authenticate with username/password.
// After login, the session carries adminAuthenticated so API calls work.
router.use((req, res, next) => {
    const configuredGuid = global.m_serverconfig.m_configuration.servers_admin_url_guid;

    // GUID mode not enabled — normal behaviour
    if (!configuredGuid) {
        return next();
    }

    const guidPrefix = '/' + configuredGuid;

    // Request includes the GUID in the path — strip it and continue
    if (req.path === guidPrefix || req.path.startsWith(guidPrefix + '/')) {
        req.url = req.url.substring(guidPrefix.length) || '/';
        // Root after strip → redirect to login
        if (req.url === '/') {
            return res.redirect(adminPath('/login'));
        }
        return next();
    }

    // No GUID in path — allow if already authenticated (API calls after login)
    if (req.session && req.session.adminAuthenticated) {
        return next();
    }

    // Hidden — return 404
    return res.status(404).render('pages/404', { title: '404', message: 'Not found.' });
});

// CSRF protection — applied globally so every state-changing route (POST/PUT/
// DELETE) is protected.  GET requests simply get a token generated.  The token
// is exposed to all views via res.locals so EJS partials (navbar, etc.) can
// embed it without each route having to pass it explicitly.
router.use(csrfProtection);
router.use((req, res, next) => {
    res.locals.csrfToken = req.csrfToken();
    next();
});

// Login page
router.get('/login', (req, res) => {
    res.render('admin/login', {
        csrfToken: req.csrfToken(),
        error: req.session.error,
        title: 'Admin Login',
        adminPath: adminPath('')
    });
    req.session.error = null;
});

// Login authentication
router.post('/login', loginLimiter, (req, res) => {
    const { username, password } = req.body;
    const config = global.m_serverconfig.m_configuration;
    const clientIp = req.ip || req.connection.remoteAddress;

    // Input validation
    if (!isValidAdminUsername(username)) {
        req.session.error = 'Invalid username format';
        return res.redirect(adminPath('/login'));
    }

    if (!isValidAdminPassword(password)) {
        req.session.error = 'Invalid password format';
        return res.redirect(adminPath('/login'));
    }

    // Check account lockout
    if (isAccountLocked(clientIp, username)) {
        req.session.error = 'Account temporarily locked due to too many failed attempts. Please try again later.';
        return res.redirect(adminPath('/login'));
    }

    if (username === config.admin_username) {
        // Compare against bcrypt hash, or fall back to plaintext for
        // configs that haven't been migrated yet.
        const stored = config.admin_password;
        const match = isBcryptHash(stored)
            ? bcrypt.compareSync(password, stored)
            : (password === stored);

        if (!match) {
            recordFailedAttempt(clientIp, username);
            req.session.error = 'Invalid username or password';
            return res.redirect(adminPath('/login'));
        }

        if (!isBcryptHash(stored)) {
            console.warn(global.Colors.FgYellow +
                '[WARN] admin_password is stored in plaintext. ' +
                'Use $$HASH$$(\'...\') in server.config and restart to hash it.' +
                global.Colors.Reset);
        }
        // Successful login - clear failed attempts
        clearFailedAttempts(clientIp, username);
        // Regenerate the session to prevent session fixation attacks.
        // The old session ID is discarded; auth flags are set on the fresh
        // session and explicitly saved before redirecting.
        req.session.regenerate(function(err) {
            if (err) {
                console.error('Error regenerating session:', err);
                req.session.error = 'Login failed, please try again';
                return res.redirect(adminPath('/login'));
            }
            req.session.adminAuthenticated = true;
            req.session.adminUsername = username;
            req.session.save(function(saveErr) {
                if (saveErr) {
                    console.error('Error saving regenerated session:', saveErr);
                }
                return res.redirect(adminPath('/dashboard'));
            });
        });
        return;
    }

    // Failed login - record attempt
    recordFailedAttempt(clientIp, username);
    req.session.error = 'Invalid username or password';
    return res.redirect(adminPath('/login'));
});

// Logout
router.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Error destroying session:', err);
        }
        res.redirect(adminPath('/login'));
    });
});

// Dashboard (protected)
router.get('/dashboard', requireAuth, (req, res) => {
    res.render('admin/dashboard', {
        title: 'Admin Dashboard',
        adminUsername: req.session.adminUsername,
        accountStorageType: global.m_serverconfig.m_configuration.account_storage_type,
        serversStatusGuid: global.m_serverconfig.m_configuration.servers_admin_url_guid || null
    });
});

// Users page (protected)
router.get('/users', requireAuth, (req, res) => {
    res.render('admin/users', {
        title: 'User Management',
        adminUsername: req.session.adminUsername || null,
        accountStorageType: global.m_serverconfig.m_configuration.account_storage_type,
        serversStatusGuid: global.m_serverconfig.m_configuration.servers_admin_url_guid || null
    });
});

// Servers page (protected)
router.get('/servers', requireAuth, (req, res) => {
    res.render('admin/servers', {
        title: 'Server Status',
        adminUsername: req.session.adminUsername || null,
        accountStorageType: global.m_serverconfig.m_configuration.account_storage_type,
        serversStatusGuid: global.m_serverconfig.m_configuration.servers_admin_url_guid || null
    });
});

// SQL Management page (protected)
router.get('/sql-management', requireAuth, (req, res) => {
    res.render('admin/sql-management', {
        title: 'Teams & Logins Management',
        adminUsername: req.session.adminUsername || null,
        accountStorageType: global.m_serverconfig.m_configuration.account_storage_type,
        serversStatusGuid: global.m_serverconfig.m_configuration.servers_admin_url_guid || null
    });
});

// Apply per-IP rate limiting to every admin API route (GET/POST/PUT/DELETE).
// Mounted here so all /api/* routes below are covered uniformly.
router.use('/api', apiLimiter);

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

// API: Get teams with logins (SQL mode, paginated)
router.get('/api/sql/teams', requireAuth, (req, res) => {
    try {
        if (global.m_serverconfig.m_configuration.account_storage_type !== 'db') {
            return res.json({ error: 1, errorMessage: 'SQL mode not enabled' });
        }

        const db = global.m_db;
        if (!db) {
            return res.json({ error: 1, errorMessage: 'Database not connected' });
        }

        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
        const offset = (page - 1) * limit;
        const search = (req.query.search || '').trim();
        const sortBy = (req.query.sortBy || 'TeamID').trim();
        const sortDir = (req.query.sortDir || 'asc').trim().toLowerCase() === 'desc' ? 'DESC' : 'ASC';

        // Validate sort column to prevent SQL injection
        const allowedSortColumns = ['TeamID', 'TeamName', 'Email', 'CreatedAt', 'UpdatedAt', 'InstanceLimit', 'Enabled'];
        const sortColumn = allowedSortColumns.includes(sortBy) ? sortBy : 'TeamID';

        let whereClause = '';
        let countParams = [];
        let queryParams = [];

        if (search) {
            // Check if search is a number (TeamID search)
            const searchNum = parseInt(search);
            if (!isNaN(searchNum) && search.toString() === searchNum.toString()) {
                whereClause = ' WHERE TeamID = ?';
                countParams = [searchNum];
                queryParams = [searchNum, limit, offset];
            } else {
                whereClause = ' WHERE TeamName LIKE ? OR Email LIKE ?';
                const likePattern = '%' + search + '%';
                countParams = [likePattern, likePattern];
                queryParams = [likePattern, likePattern, limit, offset];
            }
        } else {
            queryParams = [limit, offset];
        }

        // Get total count
        db.get('SELECT COUNT(*) as total FROM teams' + whereClause, countParams, (err, countRow) => {
            if (err) {
                console.error('Error counting teams:', err);
                return res.json({ error: 1, errorMessage: 'Failed to fetch teams' });
            }

            const total = countRow.total;
            const totalPages = Math.ceil(total / limit);

            // Get paginated teams
            const query = 'SELECT * FROM teams' + whereClause + ' ORDER BY ' + sortColumn + ' ' + sortDir + ' LIMIT ? OFFSET ?';
            db.all(query, queryParams, (err, teams) => {
                if (err) {
                    console.error('Error fetching teams:', err);
                    return res.json({ error: 1, errorMessage: 'Failed to fetch teams' });
                }

                if (!teams || teams.length === 0) {
                    return res.json({ error: 0, teams: [], total: total, page: page, limit: limit, totalPages: totalPages });
                }

                // Get logins for each team in this page
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
                    res.json({ error: 0, teams: results, total: total, page: page, limit: limit, totalPages: totalPages });
                });
            });
        });
    } catch (error) {
        console.error('Error in /api/sql/teams:', error);
        res.json({ error: 1, errorMessage: 'Failed to fetch teams' });
    }
});

// API: Get SQL stats (total counts)
router.get('/api/sql/stats', requireAuth, (req, res) => {
    try {
        if (global.m_serverconfig.m_configuration.account_storage_type !== 'db') {
            return res.json({ error: 1, errorMessage: 'SQL mode not enabled' });
        }

        const db = global.m_db;
        if (!db) {
            return res.json({ error: 1, errorMessage: 'Database not connected' });
        }

        db.get('SELECT COUNT(*) as total FROM logins', [], (err, loginRow) => {
            if (err) {
                console.error('Error counting logins:', err);
                return res.json({ error: 1, errorMessage: 'Failed to get stats' });
            }
            db.get('SELECT COUNT(*) as total FROM teams', [], (err, teamRow) => {
                if (err) {
                    console.error('Error counting teams:', err);
                    return res.json({ error: 1, errorMessage: 'Failed to get stats' });
                }
                res.json({ error: 0, totalLogins: loginRow.total, totalTeams: teamRow.total });
            });
        });
    } catch (error) {
        console.error('Error in /api/sql/stats:', error);
        res.json({ error: 1, errorMessage: 'Failed to get stats' });
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

// ─── Web Terminal ─────────────────────────────────────────────────────────────
// The terminal page is served here; the actual PTY + WebSocket handling lives
// in js_web_terminal.js (attached to the HTTP server in server.js).
// Guarded by requireAuth + GUID gate + an explicit config flag.

// Helper: check whether the terminal feature is enabled in config
function isTerminalEnabled() {
    const cfg = global.m_serverconfig.m_configuration;
    return cfg && cfg.webadmin_terminal_enabled !== false;
}

// Middleware: require terminal feature to be enabled
function requireTerminalEnabled(req, res, next) {
    if (isTerminalEnabled()) return next();
    return res.status(404).render('pages/404', { title: '404', message: 'Not found.' });
}

// Terminal page (protected)
router.get('/terminal', requireAuth, requireTerminalEnabled, (req, res) => {
    res.render('admin/terminal', {
        title: 'Web Terminal',
        adminUsername: req.session.adminUsername || null,
        accountStorageType: global.m_serverconfig.m_configuration.account_storage_type,
        serversStatusGuid: global.m_serverconfig.m_configuration.servers_admin_url_guid || null
    });
});

// ─── Wiki / Help ──────────────────────────────────────────────────────────────
// Serves the local wiki markdown files rendered as HTML inside the admin panel.
// Images are served as static files.  Inter-document links (Foo.md) are
// rewritten to /admin/wiki/Foo so navigation works in the browser.

const fs = require('fs');
const pathModule = require('path');
const { marked } = require('marked');

const WIKI_DIR = pathModule.join(__dirname, '..', '..', 'wiki');

// Configure marked: add GFM tables, rewrite .md links to wiki routes
marked.setOptions({
    gfm: true,
    breaks: false
});

// Custom renderer to rewrite markdown links to wiki page routes.
// marked v5+ passes a single object argument to renderer methods.
const renderer = new marked.Renderer();
const origLink = renderer.link.bind(renderer);
renderer.link = function ({ href, title, tokens }) {
    if (href && typeof href === 'string' && !href.startsWith('http') && !href.startsWith('#') && !href.startsWith('mailto:')) {
        // Handle links like "Configuration.md" or "../andruav_server/wiki/Foo.md"
        if (href.endsWith('.md')) {
            if (!href.includes('../')) {
                const baseName = pathModule.basename(href, '.md');
                const guidPrefix = global.m_serverconfig.m_configuration.servers_admin_url_guid
                    ? '/' + global.m_serverconfig.m_configuration.servers_admin_url_guid : '';
                href = '/admin' + guidPrefix + '/wiki/' + baseName;
            } else {
                // External repo links — render as plain text with a note
                const text = this.parser.parseInline(tokens);
                return text + ' <small class="text-muted">(external)</small>';
            }
        }
        // Rewrite image paths (images/xxx.png) to wiki/images/xxx.png
        if (href.startsWith('images/')) {
            const guidPrefix = global.m_serverconfig.m_configuration.servers_admin_url_guid
                ? '/' + global.m_serverconfig.m_configuration.servers_admin_url_guid : '';
            href = '/admin' + guidPrefix + '/wiki/images/' + href.substring(7);
        }
    }
    return origLink({ href, title, tokens });
};

const origImage = renderer.image.bind(renderer);
renderer.image = function ({ href, title, text, tokens }) {
    if (href && typeof href === 'string' && !href.startsWith('http') && !href.startsWith('data:')) {
        if (href.startsWith('images/')) {
            const guidPrefix = global.m_serverconfig.m_configuration.servers_admin_url_guid
                ? '/' + global.m_serverconfig.m_configuration.servers_admin_url_guid : '';
            href = '/admin' + guidPrefix + '/wiki/images/' + href.substring(7);
        }
    }
    return origImage({ href, title, text, tokens });
};

// Helper: get list of wiki pages (sorted by title)
function getWikiPages() {
    try {
        const files = fs.readdirSync(WIKI_DIR).filter(f => f.endsWith('.md'));
        return files.map(f => {
            const baseName = pathModule.basename(f, '.md');
            // Read first H1 heading as title, fallback to filename
            const content = fs.readFileSync(pathModule.join(WIKI_DIR, f), 'utf8');
            const h1Match = content.match(/^#\s+(.+)$/m);
            return {
                name: baseName,
                title: h1Match ? h1Match[1].trim() : baseName
            };
        }).sort((a, b) => a.title.localeCompare(b.title));
    } catch (e) {
        return [];
    }
}

// Helper: render a wiki markdown file to HTML
function renderWikiPage(pageName) {
    const filePath = pathModule.join(WIKI_DIR, pageName + '.md');
    // Prevent path traversal
    if (!filePath.startsWith(WIKI_DIR)) return null;
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return marked.parse(content, { renderer: renderer });
    } catch (e) {
        return null;
    }
}

// Wiki index page (protected)
router.get('/wiki', requireAuth, (req, res) => {
    const pages = getWikiPages();
    res.render('admin/wiki', {
        title: 'Wiki / Help',
        adminUsername: req.session.adminUsername || null,
        accountStorageType: global.m_serverconfig.m_configuration.account_storage_type,
        serversStatusGuid: global.m_serverconfig.m_configuration.servers_admin_url_guid || null,
        wikiPages: pages,
        wikiContent: null,
        activeWikiPage: null
    });
});

// Wiki page view (protected)
router.get('/wiki/:page', requireAuth, (req, res) => {
    const pageName = req.params.page;
    const pages = getWikiPages();
    const html = renderWikiPage(pageName);

    if (html === null) {
        return res.status(404).render('pages/404', { title: '404', message: 'Wiki page not found.' });
    }

    // Find the page title
    const pageInfo = pages.find(p => p.name === pageName);

    res.render('admin/wiki', {
        title: pageInfo ? pageInfo.title : pageName,
        adminUsername: req.session.adminUsername || null,
        accountStorageType: global.m_serverconfig.m_configuration.account_storage_type,
        serversStatusGuid: global.m_serverconfig.m_configuration.servers_admin_url_guid || null,
        wikiPages: pages,
        wikiContent: html,
        activeWikiPage: pageName
    });
});

// Wiki images (protected) — serve static image files
router.get('/wiki/images/:filename', requireAuth, (req, res) => {
    const filename = pathModule.basename(req.params.filename);
    const filePath = pathModule.join(WIKI_DIR, 'images', filename);
    // Prevent path traversal
    if (!filePath.startsWith(pathModule.join(WIKI_DIR, 'images'))) {
        return res.status(404).render('pages/404', { title: '404', message: 'Not found.' });
    }
    // Only serve image files
    const ext = pathModule.extname(filename).toLowerCase();
    const allowedExts = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'];
    if (!allowedExts.includes(ext)) {
        return res.status(404).render('pages/404', { title: '404', message: 'Not found.' });
    }
    try {
        const mimeType = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.webp': 'image/webp'
        }[ext] || 'application/octet-stream';
        res.setHeader('Content-Type', mimeType);
        res.sendFile(filePath);
    } catch (e) {
        res.status(404).render('pages/404', { title: '404', message: 'Not found.' });
    }
});

// ─── CSRF Error Handler ──────────────────────────────────────────────────────
// Returns JSON for API routes, redirects to login for page routes.
router.use(function(err, req, res, next) {
    if (err.code !== 'EBADCSRFTOKEN') {
        return next(err);
    }
    if (req.path.startsWith('/api/')) {
        return res.status(403).json({ error: 1, errorMessage: 'Invalid or missing CSRF token' });
    }
    req.session.error = 'Session expired, please log in again';
    return res.redirect(adminPath('/login'));
});

module.exports = router;
