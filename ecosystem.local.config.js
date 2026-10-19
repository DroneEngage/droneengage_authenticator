/**
 * PM2 definition of the local DroneEngage server stack - the same three
 * servers, working directories and command as run.local.sh
 * (`cd <repo> && node ./src/server.js`), but supervised by PM2 as YOUR user
 * (not root, so files written under ~/de_code stay yours and a code change
 * is picked up by `./pm2.local.sh restart`).
 *
 *   ./pm2.local.sh start | stop | restart | status | logs [name]
 */
const DE_CODE = process.env.HOME + '/de_code';

// the node that launches pm2 - the same nvm node run.local.sh uses via PATH
const NODE = process.execPath;

function app(name, repo) {
    return {
        name,
        cwd: DE_CODE + '/' + repo,
        script: './src/server.js',
        interpreter: NODE,
        autorestart: true,
        watch: false,
        max_restarts: 10,
        restart_delay: 2000,
        time: true,
    };
}

module.exports = {
    apps: [
        app('de_authenticator', 'droneengage_authenticator'),
        app('de_server', 'droneengage_server'),
        app('de_storage', 'droneengage_storage_server'),
    ],
};
