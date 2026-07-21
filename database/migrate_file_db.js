#!/usr/bin/env node

/**
 * Migration & CSV import script that generates a SQLite database.
 *
 * 1. If an input JSON db_users.db is provided, migrates its data into SQLite.
 * 2. If --csv-dir is provided, imports account.csv and account_details.csv.
 *
 * Usage:
 *   node database/migrate_file_db.js [json_db_file] [--csv-dir <csv_directory>] [--output <sqlite_file>]
 *
 * If json_db_file is omitted, reads db_users path from server.config.
 * If --output is omitted, uses dbdatabase path from server.config.
 *
 * Example:
 *   node database/migrate_file_db.js --csv-dir ./migrate.tmp
 *   node database/migrate_file_db.js db_users.db --csv-dir ./migrate.tmp --output database/true_db.db
 */

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

// -- Parse command line arguments ---------------------------------------------
const args = process.argv.slice(2);

let inputDbPath = null;
let csvDir = null;
let outputPath = null;

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--csv-dir') {
        csvDir = args[++i];
    } else if (args[i] === '--output') {
        outputPath = args[++i];
    } else if (!inputDbPath && !args[i].startsWith('--')) {
        inputDbPath = args[i];
    }
}

// -- Load server.config -------------------------------------------------------
let config = {};
try {
    const stripJsonComments = require('../helpers/js_3rd_StripJsonComments.js');
    const configPath = path.join(__dirname, '..', 'server.config');
    const configContent = fs.readFileSync(configPath, 'utf8');
    config = JSON.parse(stripJsonComments(configContent));
} catch (err) {
    console.log(`[WARN] Could not read server.config: ${err.message}`);
}

// Determine input path: explicit arg -> server.config.db_users -> none
if (!inputDbPath && config.db_users) {
    inputDbPath = path.join(__dirname, '..', config.db_users);
}

// Determine output path: explicit arg -> server.config.dbdatabase -> default
if (!outputPath) {
    if (config.dbdatabase) {
        outputPath = path.join(__dirname, '..', config.dbdatabase);
    } else {
        outputPath = path.join(__dirname, 'andruav.db');
    }
}

// Ensure output directory exists
const outputDir = path.dirname(outputPath);
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

console.log(`[INFO] Input JSON DB: ${inputDbPath || '(none)'}`);
console.log(`[INFO] Output SQLite: ${outputPath}`);
if (csvDir) {
    console.log(`[INFO] CSV directory: ${csvDir}`);
}

if (!inputDbPath && !csvDir) {
    console.error('[ERROR] Nothing to do. Provide an input JSON db file or --csv-dir.');
    process.exit(1);
}

// -- Helper functions ---------------------------------------------------------
function parsePermission(perm) {
    if (!perm || perm === 'D1G1T3R4V5C6') return 4294967295;
    if (typeof perm === 'number') return perm;
    const s = perm.toString().trim();
    if (s.toLowerCase().startsWith('0x')) {
        const n = parseInt(s, 16);
        return isNaN(n) ? 4294967295 : n;
    }
    const n = parseInt(s, 16);
    return isNaN(n) ? 4294967295 : n;
}

function parseEnabled(enabled) {
    if (enabled === true || enabled === 1) return 1;
    if (typeof enabled === 'string') {
        const s = enabled.trim().toLowerCase();
        if (s === '1' || s === 'true' || s === 'yes') return 1;
    }
    return 0;
}

function parseDateTime(dt) {
    if (!dt || typeof dt !== 'string') return null;
    const s = dt.trim();
    if (!s) return null;
    return s;
}

function parseCsv(csvContent) {
    const lines = csvContent.trim().split('\n');
    if (lines.length < 2) return [];

    const parseLine = (line) => {
        const result = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (ch === ',' && !inQuotes) {
                result.push(current);
                current = '';
            } else {
                current += ch;
            }
        }
        result.push(current);
        return result;
    };

    const headers = parseLine(lines[0]);
    return lines.slice(1).map(line => {
        const values = parseLine(line);
        const row = {};
        headers.forEach((header, index) => {
            row[header.trim()] = (values[index] || '').trim();
        });
        return row;
    });
}

// -- Load JSON input data if provided -----------------------------------------
let jsonData = null;
if (inputDbPath && fs.existsSync(inputDbPath)) {
    try {
        const content = fs.readFileSync(inputDbPath, 'utf8');
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed === 'object') {
            jsonData = parsed;
        }
    } catch (err) {
        console.log(`[WARN] Could not read input JSON db: ${err.message}`);
    }
}

let existingTeams = [];
let existingLogins = [];

if (jsonData) {
    if (jsonData.teams && jsonData.logins) {
        existingTeams = Object.values(jsonData.teams);
        existingLogins = Object.values(jsonData.logins);
        console.log(`[INFO] Loaded ${existingTeams.length} teams and ${existingLogins.length} logins from JSON DB`);
    } else if (jsonData.users) {
        const teamsBySid = {};
        for (const [email, user] of Object.entries(jsonData.users)) {
            const sid = user.sid || 1;
            if (!teamsBySid[sid]) {
                teamsBySid[sid] = {
                    TeamID: sid,
                    TeamName: email,
                    Email: email,
                    InstanceLimit: 999,
                    Enabled: 1
                };
            }
        }

        existingTeams = Object.values(teamsBySid);

        let loginID = 1;
        for (const [email, user] of Object.entries(jsonData.users)) {
            existingLogins.push({
                LoginID: loginID++,
                TeamID: user.sid || 1,
                LoginName: email,
                AccessCode: user.AccessCode || user.pwd,
                Permissions: parsePermission(user.prm),
                IsAdmin: user.isadmin ? 1 : 0
            });
        }
        console.log(`[INFO] Migrated ${existingTeams.length} teams and ${existingLogins.length} logins from old JSON format`);
    }
}

// -- Load CSV data if provided ------------------------------------------------
let csvTeams = [];
let csvLogins = [];

if (csvDir) {
    const accountCsvPath = path.join(csvDir, 'account.csv');
    const accountDetailsCsvPath = path.join(csvDir, 'account_details.csv');

    if (!fs.existsSync(accountCsvPath) || !fs.existsSync(accountDetailsCsvPath)) {
        console.log('[WARN] CSV files not found in specified directory. Skipping CSV import.');
    } else {
        try {
            const accountCsv = fs.readFileSync(accountCsvPath, 'utf8');
            const accountDetailsCsv = fs.readFileSync(accountDetailsCsvPath, 'utf8');

            const accounts = parseCsv(accountCsv);
            const accountDetails = parseCsv(accountDetailsCsv);

            const accountMap = {};
            for (const account of accounts) {
                const sid = parseInt(account.Account_SID);
                if (sid) {
                    accountMap[sid] = account;
                    csvTeams.push({
                        TeamID: sid,
                        TeamName: account.Name,
                        Email: account.Name,
                        InstanceLimit: parseInt(account.Instance_Limit) || 999,
                        Enabled: parseEnabled(account.Enabled),
                        CreatedAt: parseDateTime(account.register_time),
                        UpdatedAt: parseDateTime(account.register_time)
                    });
                }
            }

            for (const detail of accountDetails) {
                const teamID = parseInt(detail.Account_SID);
                const loginID = parseInt(detail.SID);
                if (!teamID || !accountMap[teamID]) {
                    continue;
                }

                csvLogins.push({
                    LoginID: loginID,
                    TeamID: teamID,
                    LoginName: accountMap[teamID].Name,
                    AccessCode: detail.PWD,
                    Permissions: parsePermission(detail.Permission),
                    IsAdmin: 0,
                    CreatedAt: parseDateTime(detail.register_time)
                });
            }

            console.log(`[INFO] Loaded ${csvTeams.length} teams and ${csvLogins.length} logins from CSV`);
        } catch (err) {
            console.error(`[ERROR] Failed to import from CSV: ${err.message}`);
            process.exit(1);
        }
    }
}

// -- Build merged data maps ---------------------------------------------------
const teamsMap = new Map();
const loginsMap = new Map();

for (const team of existingTeams) {
    teamsMap.set(team.TeamID, team);
}
for (const team of csvTeams) {
    teamsMap.set(team.TeamID, team);
}

for (const login of existingLogins) {
    loginsMap.set(login.LoginID, login);
}
for (const login of csvLogins) {
    loginsMap.set(login.LoginID, login);
}

console.log(`[INFO] Total unique teams: ${teamsMap.size}`);
console.log(`[INFO] Total unique logins: ${loginsMap.size}`);

if (teamsMap.size === 0 && loginsMap.size === 0) {
    console.error('[ERROR] No data to write.');
    process.exit(1);
}

// -- Create SQLite database ---------------------------------------------------
const schemaPath = path.join(__dirname, 'migrations', '002_init_schema.sql');
let schemaSql = '';
if (fs.existsSync(schemaPath)) {
    schemaSql = fs.readFileSync(schemaPath, 'utf8');
} else {
    console.log('[WARN] Schema file not found, using embedded schema.');
    schemaSql = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS teams (
    TeamID INTEGER PRIMARY KEY AUTOINCREMENT,
    TeamName TEXT NOT NULL UNIQUE,
    Email TEXT,
    InstanceLimit INTEGER DEFAULT 999,
    Enabled INTEGER DEFAULT 1,
    CreatedAt TEXT DEFAULT (datetime('now')),
    UpdatedAt TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_teams_email ON teams(Email);
CREATE INDEX IF NOT EXISTS idx_teams_enabled ON teams(Enabled);

CREATE TABLE IF NOT EXISTS logins (
    LoginID INTEGER PRIMARY KEY AUTOINCREMENT,
    TeamID INTEGER NOT NULL,
    LoginName TEXT NOT NULL,
    AccessCode TEXT NOT NULL UNIQUE,
    Permissions INTEGER NOT NULL DEFAULT 4294967295,
    IsAdmin INTEGER DEFAULT 0,
    CreatedAt TEXT DEFAULT (datetime('now')),
    LastLogin TEXT,
    FOREIGN KEY (TeamID) REFERENCES teams(TeamID) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_logins_teamid ON logins(TeamID);
CREATE INDEX IF NOT EXISTS idx_logins_accesscode ON logins(AccessCode);

CREATE TABLE IF NOT EXISTS team_hardware (
    HardwareSID INTEGER PRIMARY KEY AUTOINCREMENT,
    TeamID INTEGER NOT NULL,
    HardwareID TEXT NOT NULL,
    HardwareType TEXT NOT NULL,
    RegisteredAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (TeamID) REFERENCES teams(TeamID) ON DELETE CASCADE,
    UNIQUE(TeamID, HardwareID)
);

CREATE INDEX IF NOT EXISTS idx_team_hardware_teamid ON team_hardware(TeamID);
`;
}

// Remove existing output file to start fresh
if (fs.existsSync(outputPath)) {
    console.log(`[INFO] Removing existing output file: ${outputPath}`);
    try {
        fs.unlinkSync(outputPath);
    } catch (err) {
        console.error(`[ERROR] Failed to remove existing output file: ${err.message}`);
        process.exit(1);
    }
}

const db = new sqlite3.Database(outputPath, (err) => {
    if (err) {
        console.error(`[ERROR] Failed to open SQLite database: ${err.message}`);
        process.exit(1);
    }
});

function run(sql, params) {
    return new Promise((resolve, reject) => {
        db.run(sql, params || [], function(err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function exec(sql) {
    return new Promise((resolve, reject) => {
        db.exec(sql, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function close() {
    return new Promise((resolve, reject) => {
        db.close((err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

(async () => {
    try {
        await exec(`
            PRAGMA foreign_keys = OFF;
            DROP TABLE IF EXISTS team_hardware;
            DROP TABLE IF EXISTS logins;
            DROP TABLE IF EXISTS teams;
            PRAGMA foreign_keys = ON;
        `);
        await exec(schemaSql);
        await run('PRAGMA foreign_keys = ON');

        // Use a single transaction for all inserts (dramatically faster on disk)
        let skippedDuplicateAccessCode = 0;
        await run('BEGIN TRANSACTION');

        try {
            const teamInsertSql = `
                INSERT OR REPLACE INTO teams (TeamID, TeamName, Email, InstanceLimit, Enabled, CreatedAt, UpdatedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `;
            let teamCount = 0;
            for (const team of teamsMap.values()) {
                const createdAt = parseDateTime(team.CreatedAt) || new Date().toISOString().replace('T', ' ').substring(0, 19);
                const updatedAt = parseDateTime(team.UpdatedAt) || createdAt;
                await run(teamInsertSql, [
                    team.TeamID,
                    team.TeamName,
                    team.Email || team.TeamName,
                    team.InstanceLimit || 999,
                    parseEnabled(team.Enabled),
                    createdAt,
                    updatedAt
                ]);
                teamCount++;
            }
            console.log(`[INFO] Inserted ${teamCount} teams`);

            const loginInsertSql = `
                INSERT INTO logins (LoginID, TeamID, LoginName, AccessCode, Permissions, IsAdmin, CreatedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `;
            let loginCount = 0;
            for (const login of loginsMap.values()) {
                try {
                    await run(loginInsertSql, [
                        login.LoginID,
                        login.TeamID,
                        login.LoginName,
                        login.AccessCode,
                        parsePermission(login.Permissions),
                        login.IsAdmin ? 1 : 0,
                        parseDateTime(login.CreatedAt) || new Date().toISOString().replace('T', ' ').substring(0, 19)
                    ]);
                    loginCount++;
                } catch (err) {
                    if (err.message && err.message.includes('UNIQUE constraint failed: logins.AccessCode')) {
                        skippedDuplicateAccessCode++;
                        continue;
                    }
                    throw err;
                }
            }
            console.log(`[INFO] Inserted ${loginCount} logins`);

            await run('COMMIT');
        } catch (err) {
            await run('ROLLBACK');
            throw err;
        }

        if (skippedDuplicateAccessCode > 0) {
            console.log(`[WARN] Skipped ${skippedDuplicateAccessCode} logins with duplicate AccessCode`);
        }
        console.log('[INFO] Transaction committed, verifying counts...');

        const teamsCount = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM teams', (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });
        const loginsCount = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM logins', (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });

        await close();

        console.log('[INFO] Operation completed successfully');
        console.log(`[INFO] SQLite file: ${outputPath}`);
        console.log(`[INFO] Teams written: ${teamsCount}`);
        console.log(`[INFO] Logins written: ${loginsCount}`);
    } catch (err) {
        console.error(`[ERROR] Failed to write SQLite database: ${err.message}`);
        try { await close(); } catch (e) {}
        process.exit(1);
    }
})();
