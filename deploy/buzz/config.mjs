import { resolve, isAbsolute } from 'node:path';

/** @param {Record<string, string | undefined>} input */
export function readBuzzRuntimeConfig(input = process.env) {
 const required = ['BUZZ_SOURCE_DIR','BUZZ_DATA_DIR','DATABASE_URL','REDIS_URL','BUZZ_RELAY_PRIVATE_KEY','BUZZ_GIT_HOOK_HMAC_SECRET','RELAY_OWNER_PUBKEY','BUZZ_S3_ENDPOINT','BUZZ_S3_BUCKET','BUZZ_S3_ACCESS_KEY','BUZZ_S3_SECRET_KEY','RELAY_URL'];
 for (const key of required) if (!input[key]?.trim() || input[key].includes('CHANGE_ME')) throw new Error(`Set ${key} in deploy/buzz/.env.`);
 for (const key of ['BUZZ_RELAY_PRIVATE_KEY','BUZZ_GIT_HOOK_HMAC_SECRET','RELAY_OWNER_PUBKEY']) if (!/^[0-9a-f]{64}$/i.test(input[key])) throw new Error(`${key} must be 64 hex characters.`);
 for (const key of ['BUZZ_SOURCE_DIR','BUZZ_DATA_DIR']) if (!isAbsolute(input[key])) throw new Error(`${key} must be an absolute path.`);
 if (input.BUZZ_REQUIRE_RELAY_MEMBERSHIP && input.BUZZ_REQUIRE_RELAY_MEMBERSHIP !== 'true') throw new Error('This private team launcher requires BUZZ_REQUIRE_RELAY_MEMBERSHIP=true.');
 const bind = input.BUZZ_BIND_ADDR || '127.0.0.1:3200';
 if (!/^127\.0\.0\.1:\d+$/.test(bind)) throw new Error('BUZZ_BIND_ADDR must listen on 127.0.0.1.');
 const validPort = value => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535;
 if (!validPort(bind.slice(bind.lastIndexOf(':') + 1))) throw new Error('BUZZ_BIND_ADDR port must be 1–65535.');
 const healthPort = input.BUZZ_HEALTH_PORT || '8083';
 if (!validPort(healthPort)) throw new Error('BUZZ_HEALTH_PORT must be 1–65535.');
 const relay = new URL(input.RELAY_URL);
 if (relay.protocol !== 'wss:' && !(relay.protocol === 'ws:' && ['127.0.0.1','localhost','[::1]'].includes(relay.hostname))) throw new Error('RELAY_URL must use WSS publicly, or WS on localhost.');
 if (relay.username || relay.password || relay.pathname !== '/' || relay.search || relay.hash) throw new Error('RELAY_URL must be a workspace origin.');
 const redisMode=input.BUZZ_REDIS_MODE || 'managed';
 if(!['managed','existing'].includes(redisMode))throw new Error('BUZZ_REDIS_MODE must be managed or existing.');
 const managedKinds=redisMode==='managed'?['redis','relay']:['relay'];
 const redis = new URL(input.REDIS_URL);
 if(redis.protocol!=='redis:' || !['127.0.0.1','localhost','[::1]'].includes(redis.hostname) || redis.search || redis.hash || (redis.pathname && redis.pathname!=='/' && !/^\/\d+$/.test(redis.pathname)))throw new Error('REDIS_URL must select a local Redis server and a non-negative logical database.');
 if(redisMode==='managed' && (redis.hostname!=='127.0.0.1' || redis.username || redis.password || !['','/','/0'].includes(redis.pathname)))throw new Error('The bundled Redis launcher requires an unauthenticated 127.0.0.1 endpoint (database 0).');
 if (!redis.port || !validPort(redis.port)) throw new Error('REDIS_URL must specify an explicit port of 1–65535.');
 const database = new URL(input.DATABASE_URL);
 if (!['postgres:','postgresql:'].includes(database.protocol) || !database.pathname || database.pathname === '/') throw new Error('DATABASE_URL must select your separate Buzz PostgreSQL database.');
 if (input.BUZZ_S3_BUCKET === input.S3_BUCKET) throw new Error('Use a separate MinIO bucket for Buzz and Mailflare.');
 const data = resolve(input.BUZZ_DATA_DIR);
 const redisData = resolve(data, 'redis');
 const env = {...input, BUZZ_REDIS_MODE:redisMode, REDIS_URL:redis.href, BUZZ_BIND_ADDR:bind, BUZZ_WEB_DIR:resolve(input.BUZZ_SOURCE_DIR,'web/dist'), BUZZ_HEALTH_PORT:healthPort,BUZZ_REQUIRE_RELAY_MEMBERSHIP:'true',BUZZ_DB_POOL_SIZE:input.BUZZ_DB_POOL_SIZE || '5',BUZZ_REDIS_POOL_SIZE:input.BUZZ_REDIS_POOL_SIZE || '4',BUZZ_MEDIA_MAX_CONCURRENT_UPLOADS:input.BUZZ_MEDIA_MAX_CONCURRENT_UPLOADS || '2',BUZZ_MEDIA_MAX_CONCURRENT_UPLOADS_PER_PUBKEY:'1',BUZZ_GIT_PACK_CACHE_MAX_CONCURRENT_POPULATIONS:'1',BUZZ_GIT_REPO_PATH:resolve(data,'repos'),BUZZ_GIT_PACK_CACHE_PATH:resolve(data,'repos/.pack-cache'),BUZZ_S3_ADDRESSING_STYLE:'path',BUZZ_PUSH_ENABLED:'false',BUZZ_AUTO_MIGRATE:'false',BUZZ_REQUIRE_AUTH_TOKEN:'true'};
 return {env, data, redisData, managedKinds, relay:{command:resolve(input.BUZZ_SOURCE_DIR,'target/release/buzz-relay'),args:[]},redis:{command:input.BUZZ_REDIS_BINARY || '/opt/homebrew/bin/redis-server',args:['--bind','127.0.0.1','--port',redis.port,'--protected-mode','yes','--appendonly','yes','--dir',redisData,'--maxmemory','128mb','--maxmemory-policy','noeviction']}};
}
