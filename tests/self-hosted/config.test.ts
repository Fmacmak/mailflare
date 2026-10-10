import assert from 'node:assert/strict';
import test from 'node:test';
import { getSetupRequirementChecks } from '../../src/lib/setup/configuration';
const config = await import('../../server/runtime/storage-config');
const policy = await import('../../src/lib/branding/access');
test('Resend alone satisfies self-hosted outbound setup', () => {
 const checks = getSetupRequirementChecks({MAILFLARE_RUNTIME:'node',DB:{},EMAIL:{configured:false},RESEND_API_KEY:'re_test'} as unknown as CloudflareEnv);
 assert.equal(checks.find(check=>check.key==='Outbound mail')!.configured,true);
});
test('storage configuration defaults to files but rejects incomplete S3 credentials', () => {
 assert.equal(typeof config?.readStorageConfig,'function');
 assert.equal(config!.readStorageConfig({}).kind,'files');
 assert.throws(()=>config!.readStorageConfig({STORAGE_BACKEND:'minio'}),/S3_ENDPOINT/);
 assert.throws(()=>config!.readStorageConfig({STORAGE_BACKEND:'other'}),/STORAGE_BACKEND/);
 const c = config!.readStorageConfig({STORAGE_BACKEND:'s3',S3_ENDPOINT:'http://127.0.0.1:9000',S3_BUCKET:'mailflare',S3_ACCESS_KEY_ID:'access',S3_SECRET_ACCESS_KEY:'secret'});
 assert.equal(c.kind,'s3'); assert.equal(c.region,'us-east-1');
});
test('fork branding is available on Node without pretending a commercial license is active', () => {
 assert.equal(typeof policy?.hasBrandingAccess,'function');
 assert.equal(policy!.hasBrandingAccess({MAILFLARE_RUNTIME:'node'} as CloudflareEnv,false),true);
 assert.equal(policy!.hasBrandingAccess({} as CloudflareEnv,false),false);
 assert.equal(policy!.hasBrandingAccess({} as CloudflareEnv,true),true);
});
