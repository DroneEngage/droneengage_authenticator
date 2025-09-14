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
        const fileContent = fs.readFileSync(path.join(__dirname, configFileName), 'utf8');
        configuration = JSON.parse(stripJsonComments(fileContent));
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