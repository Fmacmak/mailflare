import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join,resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
if (!process.env.MINIO_ROOT_USER || !process.env.MINIO_ROOT_PASSWORD) throw new Error('Configure MINIO_ROOT_USER and MINIO_ROOT_PASSWORD in .env.selfhosted');
const directory = resolve(process.env.MINIO_DATA_DIR || './data/minio');
mkdirSync(directory,{recursive:true});
const child = spawn(process.env.MINIO_BINARY || join(homedir(),'.local/bin/minio'),
 ['server',directory,'--address','127.0.0.1:9000','--console-address','127.0.0.1:9001'],{stdio:'inherit'});
child.on('error',()=>{console.error('Could not start MinIO. Set MINIO_BINARY to an installed native binary.');process.exit(1);});
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>child.kill(signal));
child.on('exit',(code)=>process.exit(code ?? 1));
