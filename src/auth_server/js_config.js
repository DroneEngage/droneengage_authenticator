"use strict";

function getConfiguration() {
    const config = global.m_serverconfig && global.m_serverconfig.m_configuration;
    if (!config) {
        throw new Error("Server configuration is not initialized");
    }
    return config;
}

function getAccountStorageType() {
    return getConfiguration().account_storage_type.toLowerCase();
}

module.exports = {
    getConfiguration,
    getAccountStorageType,
};
