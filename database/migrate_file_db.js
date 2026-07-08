#!/usr/bin/env node

/**
 * Migration script to convert existing db_users.db flat format to new teams/logins structure
 * This script can also optionally import from account.csv and account_details.csv
 * 
 * Usage:
 *   node database/migrate_file_db.js <db_file_path> [--csv-dir <csv_directory>]
 * 
 * Example:
 *   node database/migrate_file_db.js db_users.db
 *   node database/migrate_file_db.js db_users.db --csv-dir /home/you
 */

const fs = require('fs');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
const dbFilePath = args[0];
const csvDirArg = args.indexOf('--csv-dir');
const csvDir = csvDirArg !== -1 ? args[csvDirArg + 1] : null;

if (!dbFilePath) {
    console.error('Usage: node migrate_file_db.js <db_file_path> [--csv-dir <csv_directory>]');
    process.exit(1);
}

console.log(`[INFO] Migrating database file: ${dbFilePath}`);
if (csvDir) {
    console.log(`[INFO] CSV directory: ${csvDir}`);
}

// Check if file exists
if (!fs.existsSync(dbFilePath)) {
    console.error(`[ERROR] Database file not found: ${dbFilePath}`);
    process.exit(1);
}

// Read current database
let dbData;
try {
    const content = fs.readFileSync(dbFilePath, 'utf8');
    dbData = JSON.parse(content);
} catch (err) {
    console.error(`[ERROR] Failed to read database file: ${err.message}`);
    process.exit(1);
}

// Check if already migrated
if (dbData.teams && dbData.logins) {
    console.log('[INFO] Database already in new format. Skipping migration.');
    process.exit(0);
}

// Check if old format exists
if (!dbData.users) {
    console.error('[ERROR] Database does not have old "users" format. Cannot migrate.');
    process.exit(1);
}

console.log('[INFO] Converting from old flat-file format to new teams/logins structure');

// Initialize new structure
const newDbData = {
    db_info: { TeamID: 0, LoginID: 0 },
    teams: {},
    logins: {}
};

const oldUsers = dbData.users;
let maxTeamID = 0;
let maxLoginID = 0;

// Group users by sid (TeamID) to create teams
const teamsBySid = {};
for (const [email, user] of Object.entries(oldUsers)) {
    const sid = user.sid || 1;
    if (!teamsBySid[sid]) {
        teamsBySid[sid] = {
            TeamID: sid,
            TeamName: email,  // Use first email as team name
            Email: email,
            InstanceLimit: 999,
            Enabled: true
        };
        if (sid > maxTeamID) maxTeamID = sid;
    }
}

// Create teams
for (const team of Object.values(teamsBySid)) {
    newDbData.teams[team.TeamID] = team;
}

// Create logins
for (const [email, user] of Object.entries(oldUsers)) {
    const sid = user.sid || 1;
    const loginID = maxLoginID + 1;
    maxLoginID = loginID;
    
    // Normalize permission literal
    let permissions = user.prm || '0xffffffff';
    if (permissions === 'D1G1T3R4V5C6') {
        permissions = '0xffffffff';
    }

    newDbData.logins[email] = {
        LoginID: loginID,
        TeamID: sid,
        LoginName: email,
        AccessCode: user.AccessCode || user.pwd,
        Permissions: permissions,
        IsAdmin: user.isadmin || false
    };
}

// Update counters
newDbData.db_info.TeamID = maxTeamID;
newDbData.db_info.LoginID = maxLoginID;

// Import from CSV if provided
if (csvDir) {
    console.log('[INFO] Importing from CSV files...');
    
    const accountCsvPath = path.join(csvDir, 'account.csv');
    const accountDetailsCsvPath = path.join(csvDir, 'account_details.csv');
    
    if (fs.existsSync(accountCsvPath) && fs.existsSync(accountDetailsCsvPath)) {
        try {
            const accountCsv = fs.readFileSync(accountCsvPath, 'utf8');
            const accountDetailsCsv = fs.readFileSync(accountDetailsCsvPath, 'utf8');
            
            // Parse CSV (simple line-by-line parsing)
            const parseCsv = (csvContent) => {
                const lines = csvContent.trim().split('\n');
                const headers = lines[0].split(',');
                return lines.slice(1).map(line => {
                    const values = line.split(',');
                    const row = {};
                    headers.forEach((header, index) => {
                        row[header.trim()] = values[index]?.trim() || '';
                    });
                    return row;
                });
            };
            
            const accounts = parseCsv(accountCsv);
            const accountDetails = parseCsv(accountDetailsCsv);
            
            // Create teams from account.csv
            for (const account of accounts) {
                const teamID = parseInt(account.Account_SID);
                if (teamID && !newDbData.teams[teamID]) {
                    newDbData.teams[teamID] = {
                        TeamID: teamID,
                        TeamName: account.Name,
                        Email: account.Name,
                        InstanceLimit: parseInt(account.Instance_Limit) || 999,
                        Enabled: account.Enabled === '1' || account.Enabled === 'true'
                    };
                    if (teamID > maxTeamID) maxTeamID = teamID;
                }
            }
            
            // Create logins from account_details.csv
            for (const detail of accountDetails) {
                const teamID = parseInt(detail.Account_SID);
                const loginID = maxLoginID + 1;
                maxLoginID = loginID;
                
                // Normalize permission literal
                let permissions = detail.Permission || '0xffffffff';
                if (permissions === 'D1G1T3R4V5C6') {
                    permissions = '0xffffffff';
                }
                
                // Use SID as key if no email available
                const loginKey = detail.SID || `login_${loginID}`;
                
                newDbData.logins[loginKey] = {
                    LoginID: loginID,
                    TeamID: teamID,
                    LoginName: loginKey,
                    AccessCode: detail.PWD,
                    Permissions: permissions,
                    IsAdmin: false
                };
            }
            
            // Update counters
            newDbData.db_info.TeamID = maxTeamID;
            newDbData.db_info.LoginID = maxLoginID;
            
            console.log(`[INFO] Imported ${accounts.length} accounts and ${accountDetails.length} account details from CSV`);
        } catch (err) {
            console.error(`[WARN] Failed to import from CSV: ${err.message}`);
            console.log('[INFO] Continuing with flat-file migration only');
        }
    } else {
        console.log('[WARN] CSV files not found in specified directory');
    }
}

// Backup original file
const backupPath = `${dbFilePath}.old`;
console.log(`[INFO] Creating backup: ${backupPath}`);
try {
    fs.copyFileSync(dbFilePath, backupPath);
} catch (err) {
    console.error(`[ERROR] Failed to create backup: ${err.message}`);
    process.exit(1);
}

// Write migrated data
console.log('[INFO] Writing migrated database...');
try {
    fs.writeFileSync(dbFilePath, JSON.stringify(newDbData, null, 2), 'utf8');
    console.log('[INFO] Migration completed successfully');
    console.log(`[INFO] Original file backed up to: ${backupPath}`);
    console.log(`[INFO] Teams created: ${Object.keys(newDbData.teams).length}`);
    console.log(`[INFO] Logins created: ${Object.keys(newDbData.logins).length}`);
} catch (err) {
    console.error(`[ERROR] Failed to write migrated database: ${err.message}`);
    console.log('[INFO] Restoring from backup...');
    fs.copyFileSync(backupPath, dbFilePath);
    process.exit(1);
}
