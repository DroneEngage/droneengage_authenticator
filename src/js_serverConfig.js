/*************************************************************************************
 * 
 *   A N D R U A V -  Server Configuration File      JAVASCRIPT  LIB
 * 
 *   Author: Mohammad S. Hefny
 * 
 *   Date:   08 Sep 2016
 * 
 * 
 * 
 */


const stripJsonComments = require("./helpers/js_3rd_StripJsonComments.js");
const configHandler = require("./helpers/js_config_handler.js");
const dumpError = require("./dumperror.js");
const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG_FILENAME = "server.config";
let configFileName = DEFAULT_CONFIG_FILENAME;
let configuration = null;

function getFileName() {
    return configFileName;
}

function init(configFileNameParam) {
    if (configFileNameParam) {
        configFileName = configFileNameParam;
    }

    try {
        const configFilePath = path.join(__dirname, '..', configFileName);
        const fileContent = fs.readFileSync(configFilePath, 'utf8');
        configuration = JSON.parse(stripJsonComments(fileContent));

        // Process $$HASH$$('...') directives — replace with bcrypt hashes
        // in memory and persist the hashes back to the config file.
        configHandler.handleConfig(configuration, configFilePath);

        // Environment variable overrides
        if (process.env.de_auth_servers_status_guid !== undefined) {
            configuration.servers_admin_url_guid = process.env.de_auth_servers_status_guid;
        }
        if (process.env.de_auth_webadmin_terminal_enabled !== undefined) {
            configuration.webadmin_terminal_enabled = (process.env.de_auth_webadmin_terminal_enabled === 'true' || process.env.de_auth_webadmin_terminal_enabled === '1');
        }
    } catch (err) {
        console.error(`FATAL: Error processing configuration file '${configFileName}':`, err.message);
        dumpError.dumperror(err);
        process.exit(1);
    }
}

module.exports = {
    getFileName,
    init,
    get m_configuration() {
        return configuration;
    }
};