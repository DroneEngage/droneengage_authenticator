-- Migration: Redesign database schema to normalized teams/logins/hardware model
-- This replaces the old account/account_details/account_hw_info tables
-- Preserves existing data and IDs for backward compatibility
-- SQLite version

-- Enable foreign keys
PRAGMA foreign_keys = ON;

-- Create new teams table (replaces account)
CREATE TABLE IF NOT EXISTS teams (
    TeamID INTEGER PRIMARY KEY AUTOINCREMENT,
    TeamName TEXT NOT NULL UNIQUE,
    Email TEXT,
    InstanceLimit INTEGER DEFAULT 999,
    Enabled INTEGER DEFAULT 1,
    CreatedAt TEXT DEFAULT (datetime('now')),
    UpdatedAt TEXT DEFAULT (datetime('now'))
);

-- Create indexes for teams
CREATE INDEX IF NOT EXISTS idx_teams_email ON teams(Email);
CREATE INDEX IF NOT EXISTS idx_teams_enabled ON teams(Enabled);

-- Create new logins table (replaces account_details)
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

-- Create indexes for logins
CREATE INDEX IF NOT EXISTS idx_logins_teamid ON logins(TeamID);
CREATE INDEX IF NOT EXISTS idx_logins_accesscode ON logins(AccessCode);

-- Create new team_hardware table (replaces account_hw_info)
CREATE TABLE IF NOT EXISTS team_hardware (
    HardwareSID INTEGER PRIMARY KEY AUTOINCREMENT,
    TeamID INTEGER NOT NULL,
    HardwareID TEXT NOT NULL,
    HardwareType TEXT NOT NULL,
    RegisteredAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (TeamID) REFERENCES teams(TeamID) ON DELETE CASCADE,
    UNIQUE(TeamID, HardwareID)
);

-- Create index for team_hardware
CREATE INDEX IF NOT EXISTS idx_team_hardware_teamid ON team_hardware(TeamID);

-- Migrate data from old account table to teams (if exists)
INSERT INTO teams (TeamID, TeamName, Email, InstanceLimit, Enabled, CreatedAt)
SELECT 
    Account_SID,
    Name,
    Name AS Email,  -- Use Name as Email initially, can be updated later
    Instance_Limit,
    Enabled,
    register_time
FROM account
WHERE NOT EXISTS (
    SELECT 1 FROM teams WHERE teams.TeamID = account.Account_SID
);

-- Migrate data from old account_details table to logins (if exists)
-- Handle legacy permission literal 'D1G1T3R4V5C6' -> 4294967295 (0xffffffff)
INSERT INTO logins (LoginID, TeamID, LoginName, AccessCode, Permissions, CreatedAt)
SELECT 
    ad.SID,
    ad.Account_SID,
    a.Name AS LoginName,
    ad.AccessCode,
    CASE 
        WHEN ad.Permission = 'D1G1T3R4V5C6' THEN 4294967295
        WHEN ad.Permission LIKE '0x%' THEN CAST(SUBSTR(ad.Permission, 3) AS INTEGER)
        ELSE 4294967295
    END AS Permissions,
    ad.register_time
FROM account_details ad
JOIN account a ON ad.Account_SID = a.Account_SID
WHERE NOT EXISTS (
    SELECT 1 FROM logins WHERE logins.LoginID = ad.SID
);

-- Migrate data from old account_hw_info table to team_hardware (if exists)
INSERT INTO team_hardware (HardwareSID, TeamID, HardwareID, HardwareType, RegisteredAt)
SELECT 
    SID,
    Account_SID,
    HW_ID,
    HW_Type,
    register_time
FROM account_hw_info
WHERE NOT EXISTS (
    SELECT 1 FROM team_hardware WHERE team_hardware.HardwareSID = account_hw_info.SID
);

-- Note: Old tables (account, account_details, account_hw_info) are NOT dropped
-- to allow rollback. Drop manually after verification if needed.
