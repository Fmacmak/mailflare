const path = require('node:path');
const root = __dirname;
const envFile = path.join(root, '.env.selfhosted');
const common = {
 cwd: root, interpreter: process.execPath, node_args: [`--env-file=${envFile}`],
 instances: 1, exec_mode: 'fork', autorestart: true, restart_delay: 5000,
 min_uptime: '15s', max_restarts: 10, time: true,
};
module.exports = { apps: [
 { ...common, name: 'mailflare-minio', script: 'scripts/run-minio.mjs' },
 { ...common, name: 'mailflare', script: 'dist/server.mjs', max_memory_restart: '1500M', kill_timeout: 10000 },
] };
