type Environment = Record<string,string|undefined>;
export function readStorageConfig(env: Environment = process.env) {
 const kind = env.STORAGE_BACKEND?.trim() || 'files';
 if (kind === 'files') return {kind:'files' as const};
 if (kind !== 's3' && kind !== 'minio') throw new Error('STORAGE_BACKEND must be files, s3, or minio');
 const required = (name:string) => {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required for S3/MinIO storage`);
  return value;
 };
 const endpoint = required('S3_ENDPOINT');
 const url = new URL(endpoint);
 if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('S3_ENDPOINT must be an HTTP(S) URL without credentials, query or fragment');
 return {kind:'s3' as const,endpoint,bucket:required('S3_BUCKET'),accessKeyId:required('S3_ACCESS_KEY_ID'),secretAccessKey:required('S3_SECRET_ACCESS_KEY'),region:env.S3_REGION?.trim() || 'us-east-1'};
}
