/* eslint-disable @typescript-eslint/no-require-imports -- PM2 configuration uses CommonJS. */
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const envFile = path.join(__dirname, '.env');
const node = process.env.BUZZ_NODE_BINARY || process.execPath;
const fs = require('node:fs');
const settings = fs.existsSync(envFile) ? require('node:util').parseEnv(fs.readFileSync(envFile, 'utf8')) : {};
const mode = settings.BUZZ_REDIS_MODE || process.env.BUZZ_REDIS_MODE || 'managed';
if (!['managed', 'existing'].includes(mode)) throw new Error('BUZZ_REDIS_MODE must be managed or existing.');
const kinds = mode === 'existing' ? ['relay'] : ['redis', 'relay'];
module.exports = { apps: kinds.map(kind => ({
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
