/* eslint-disable @typescript-eslint/no-require-imports -- PM2 configuration uses CommonJS. */
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const envFile = path.join(__dirname, '.env');
const node = process.env.BUZZ_NODE_BINARY || process.execPath;
module.exports = { apps: ['redis', 'relay'].map(kind => ({
 name: `buzz-${kind}`,
 cwd: root,
 script: path.join(__dirname, 'run.mjs'),
 args: kind,
 interpreter: node,
 node_args: [`--env-file=${envFile}`],
 exec_mode: 'fork',
 instances: 1,
 autorestart: true,
 restart_delay: 5000,
 min_uptime: '15s',
 max_restarts: 10,
 kill_timeout: 10000,
 max_memory_restart: kind === 'relay' ? '1G' : '256M',
 })) };
