import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';

const adapter = await import('../../server/runtime/s3-bucket');

test('S3 storage adapter is available for self-hosted installs', () => {
 assert.equal(typeof adapter?.openS3Bucket, 'function');
});

test('S3 wire contract: metadata, ranges, multipart resume, deletion and service failures', async () => {
 const objects = new Map<string, { body: Buffer; headers: Record<string, string> }>();
 const uploads = new Map<string, Map<number, Buffer>>();
 const requests: string[] = [];
 const server = createServer(async (req, res) => {
  assert.match(req.headers.authorization ?? '', /^AWS4-HMAC-SHA256 /);
  const url = new URL(req.url!, 'http://localhost');
  const key = decodeURIComponent(url.pathname.replace('/mailflare/', ''));
  requests.push(`${req.method} ${key}`);
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const body = Buffer.concat(chunks);
  if (key === 'denied') { res.writeHead(403, { 'content-type': 'application/xml' }); res.end('<Error><Code>AccessDenied</Code></Error>'); return; }
  if (url.searchParams.has('uploads')) {
   uploads.set('upload-1', new Map());
   res.end('<InitiateMultipartUploadResult><UploadId>upload-1</UploadId></InitiateMultipartUploadResult>'); return;
  }
  const uploadId = url.searchParams.get('uploadId');
  if (uploadId) {
   if (req.method === 'PUT') { uploads.get(uploadId)!.set(Number(url.searchParams.get('partNumber')), body); res.setHeader('ETag', '"part-etag"'); res.end(); return; }
   if (req.method === 'DELETE') { uploads.delete(uploadId); res.writeHead(204); res.end(); return; }
   if (req.method === 'POST') {
    objects.set(key, { body: Buffer.concat([...uploads.get(uploadId)!.entries()].sort((a,b) => a[0]-b[0]).map(([,data]) => data)), headers: {} });
    uploads.delete(uploadId);
    res.end('<CompleteMultipartUploadResult><ETag>"complete-etag"</ETag></CompleteMultipartUploadResult>'); return;
   }
  }
  if (req.method === 'PUT') {
   objects.set(key, { body, headers: Object.fromEntries(Object.entries(req.headers).filter(([name]) => ['content-type','content-disposition','cache-control'].includes(name) || name.startsWith('x-amz-meta-')).map(([name,value]) => [name,String(value)])) });
   res.setHeader('ETag', '"stored-etag"'); res.end(); return;
  }
  if (req.method === 'DELETE') { objects.delete(key); res.writeHead(204); res.end(); return; }
  const object = objects.get(key);
  if (!object) { res.writeHead(404, { 'content-type': 'application/xml' }); res.end('<Error><Code>NoSuchKey</Code></Error>'); return; }
  let data = object.body;
  const range = req.headers.range;
  if (range) {
   const match = /^bytes=(\d*)-(\d*)$/.exec(range)!;
   const start = match[1] ? Number(match[1]) : Math.max(data.length - Number(match[2]), 0);
   const end = match[1] && match[2] ? Math.min(Number(match[2]), data.length-1) : data.length-1;
   res.setHeader('Content-Range', `bytes ${start}-${end}/${data.length}`);
   data = data.subarray(start,end+1); res.statusCode = 206;
  }
  for (const [name,value] of Object.entries(object.headers)) res.setHeader(name,value);
  res.setHeader('Content-Length',data.length);
  res.setHeader('ETag','"stored-etag"');
  res.setHeader('Last-Modified','Sat, 10 Oct 2026 10:00:00 GMT');
  res.end(req.method === 'HEAD' ? undefined : data);
 });
 await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
 const port = (server.address() as { port: number }).port;
 const bucket = adapter!.openS3Bucket({ endpoint:`http://127.0.0.1:${port}`, bucket:'mailflare', region:'us-east-1', accessKeyId:'test-access', secretAccessKey:'test-secret' });
 try {
  const input = new Uint8Array([0,65,66,67,68,0]).subarray(1,5);
  await bucket.put('raw/a b.eml', input, { httpMetadata:{contentType:'message/rfc822',contentDisposition:'attachment',cacheControl:'private'},customMetadata:{owner:'alice'} });
  const obj = await bucket.get('raw/a b.eml');
  assert.equal(await obj!.text(),'ABCD');
  assert.equal(obj!.size,4);
  assert.equal(obj!.customMetadata?.owner,'alice');
  const headers = new Headers(); obj!.writeHttpMetadata(headers);
  assert.equal(headers.get('content-type'),'message/rfc822');
  assert.equal(headers.get('content-disposition'),'attachment');
  assert.equal((await bucket.head('raw/a b.eml'))!.size,4);
  const partial = await bucket.get('raw/a b.eml',{range:{offset:1,length:2}});
  assert.equal(await partial!.text(),'BC'); assert.equal(partial!.size,4);
  assert.equal(await (await bucket.get('raw/a b.eml',{range:{suffix:2}}))!.text(),'CD');
  assert.equal(await bucket.get('missing'),null);
  assert.equal(await bucket.head('missing'),null);
  await assert.rejects(bucket.get('denied'));
  const upload = await bucket.createMultipartUpload('drive/file');
  const part = await upload.uploadPart(1,input);
  await bucket.resumeMultipartUpload('drive/file', upload.uploadId).complete([part]);
  assert.equal(await (await bucket.get('drive/file'))!.text(),'ABCD');
  const canceled = await bucket.createMultipartUpload('drive/canceled'); await canceled.abort();
  assert.equal(uploads.size,0);
  await bucket.delete(['raw/a b.eml','drive/file']); assert.equal(objects.size,0);
  assert.ok(requests.includes('GET raw/a b.eml'));
 } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
