import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { readBuzzRuntimeConfig } from './config.mjs';

const kind = process.argv[2];
if (!['relay','redis','admin'].includes(kind)) throw new Error('Usage: node --env-file=deploy/buzz/.env deploy/buzz/run.mjs relay|redis|admin [arguments]');
const config = readBuzzRuntimeConfig();
if (kind === 'redis' && config.env.BUZZ_REDIS_MODE === 'existing') throw new Error('Redis is externally managed; start it with Homebrew instead.');
mkdirSync(config.data,{recursive:true,mode:0o700});
mkdirSync(config.redisData,{recursive:true,mode:0o700});
const spec = kind === 'admin' ? {command:config.relay.command.replace(/buzz-relay$/, 'buzz-admin'),args:process.argv.slice(3)} : config[kind];
if (!existsSync(spec.command)) throw new Error(`Missing ${kind} executable. Follow docs/buzz.md build/install instructions.`);
if (kind === 'relay' && !existsSync(config.env.BUZZ_WEB_DIR)) throw new Error('Build Buzz web assets before starting the relay.');
const child = spawn(spec.command,spec.args,{env:config.env,stdio:'inherit',cwd:config.env.BUZZ_SOURCE_DIR});
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>child.kill(signal));
child.on('error',()=>{ console.error(`Could not start Buzz ${kind}. Check executable path and permissions.`);process.exitCode=1; });
child.on('exit',(code,signal)=>{ process.exitCode=code ?? (signal ? 1 : 0); });
