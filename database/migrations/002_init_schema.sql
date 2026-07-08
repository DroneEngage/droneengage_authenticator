-- Initialize SQLite database schema for new installation
-- This creates the teams/logins/hardware tables without data migration

-- Enable foreign keys
PRAGMA foreign_keys = ON;

-- Create teams table
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

-- Create logins table
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

-- Create team_hardware table
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
