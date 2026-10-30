/**
 * PM2 definition of the local DroneEngage server stack - the same three
 * servers and working directories as run.local.sh, but supervised by PM2
 * as YOUR user (not root, so files written under ~/de_code stay yours and
 * a rebuild is picked up by `./pm2.local.sh restart`).
 *
 * The servers are Rust binaries: build each repository first with
 * `cargo build --release`.
 *
 *   ./pm2.local.sh start | stop | restart | status | logs [name]
 */
const DE_CODE = process.env.HOME + '/de_code';

function app(name, repo, binary) {
    return {
        name,
        cwd: DE_CODE + '/' + repo,
        script: './target/release/' + binary,
        interpreter: 'none',
        autorestart: true,
        watch: false,
        max_restarts: 10,
        restart_delay: 2000,
        time: true,
    };
}

module.exports = {
    apps: [
        app('de_authenticator', 'droneengage_authenticator', 'andruavauth'),
        app('de_server', 'droneengage_server', 'andruavmainserver'),
        app('de_storage', 'droneengage_storage_server', 'de_storage_server'),
    ],
};
