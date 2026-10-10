import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { openS3Bucket } from '../../server/runtime/s3-bucket';
import { readStorageConfig } from '../../server/runtime/storage-config';

test('real local MinIO supports object metadata, ranges, multipart resume and cleanup',async () => {
 const config=readStorageConfig();
 assert.equal(config.kind,'s3','Configure local S3/MinIO storage first');
 if(config.kind !== 's3') return;
 assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(config.endpoint).hostname),'Integration tests are restricted to local storage');
 const bucket=openS3Bucket(config);
 const prefix=`verification/${randomUUID()}`;
 const keys=[`${prefix}/object`,`${prefix}/multipart`];
 let upload: R2MultipartUpload|undefined;
 try {
  await bucket.put(keys[0],'hello minio',{httpMetadata:{contentType:'text/plain'},customMetadata:{owner:'preview'}});
  const full=await bucket.get(keys[0]);
  assert.equal(await full!.text(),'hello minio');assert.equal(full!.customMetadata?.owner,'preview');
  const ranged=await bucket.get(keys[0],{range:{offset:6,length:5}});assert.equal(await ranged!.text(),'minio');
  upload=await bucket.createMultipartUpload(keys[1],{httpMetadata:{contentType:'application/octet-stream'}});
  const p1=await upload.uploadPart(1,new Uint8Array(5*1024*1024).fill(65));
  const p2=await bucket.resumeMultipartUpload(keys[1],upload.uploadId).uploadPart(2,'tail');
  const complete=await bucket.resumeMultipartUpload(keys[1],upload.uploadId).complete([p2,p1]);
  upload=undefined;
  assert.equal(complete.size,5*1024*1024+4);
  assert.equal(await (await bucket.get(keys[1],{range:{suffix:4}}))!.text(),'tail');
  await bucket.delete(keys);
  assert.equal(await bucket.get(keys[0]),null);
 } finally {if(upload) await upload.abort();await bucket.delete(keys);}
});
