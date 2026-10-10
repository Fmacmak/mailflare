import {
 S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand,
 CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand,
 type GetObjectCommandOutput, type HeadObjectCommandOutput,
} from '@aws-sdk/client-s3';

type Config = { endpoint: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string };
type Value = ArrayBuffer | ArrayBufferView | string | ReadableStream | Blob | null;
type Metadata = { contentType?: string; contentDisposition?: string; cacheControl?: string; contentLanguage?: string; contentEncoding?: string };
type PutOptions = { httpMetadata?: Metadata | Headers; customMetadata?: Record<string,string> };

async function bytes(value: Value): Promise<Uint8Array> {
 if (value === null) return new Uint8Array();
 if (typeof value === 'string') return Buffer.from(value);
 if (value instanceof ArrayBuffer) return new Uint8Array(value);
 if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
 if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
 return new Uint8Array(await new Response(value).arrayBuffer());
}
function metadata(options?: PutOptions) {
 const h = options?.httpMetadata;
 const m = h instanceof Headers ? {
  contentType:h.get('content-type') ?? undefined, contentDisposition:h.get('content-disposition') ?? undefined,
  cacheControl:h.get('cache-control') ?? undefined, contentLanguage:h.get('content-language') ?? undefined,
  contentEncoding:h.get('content-encoding') ?? undefined,
 } : h;
 return { ContentType:m?.contentType,ContentDisposition:m?.contentDisposition,CacheControl:m?.cacheControl,
  ContentLanguage:m?.contentLanguage,ContentEncoding:m?.contentEncoding,Metadata:options?.customMetadata };
}
function object(key: string, result: GetObjectCommandOutput | HeadObjectCommandOutput) {
 const body = 'Body' in result ? result.Body : undefined;
 const httpMetadata = { contentType:result.ContentType,contentDisposition:result.ContentDisposition,cacheControl:result.CacheControl,
  contentLanguage:result.ContentLanguage,contentEncoding:result.ContentEncoding };
 const etag = result.ETag?.replace(/^"|"$/g,'') ?? '';
 const fullSize = 'ContentRange' in result && result.ContentRange ? Number(result.ContentRange.split('/')[1]) : result.ContentLength ?? 0;
 const output = {
  key,version:result.VersionId ?? etag,etag,httpEtag:result.ETag ?? `"${etag}"`,size:fullSize,
  uploaded:result.LastModified ?? new Date(),httpMetadata,customMetadata:result.Metadata ?? {},
  get body() { if (!body) throw new Error('Head objects have no body'); return body.transformToWebStream(); },
  get bodyUsed() { return body ? (body as unknown as { readableEnded?: boolean }).readableEnded === true : false; },
  async arrayBuffer() { if (!body) throw new Error('Head objects have no body'); const data = await body.transformToByteArray(); return data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength) as ArrayBuffer; },
  async text() { return Buffer.from(await output.arrayBuffer()).toString('utf8'); },
  async json<T>() { return JSON.parse(await output.text()) as T; },
  async blob() { return new Blob([await output.arrayBuffer()],{type:result.ContentType}); },
  writeHttpMetadata(headers: Headers) {
   for (const [name,value] of Object.entries({ 'content-type':result.ContentType,'content-disposition':result.ContentDisposition,
    'cache-control':result.CacheControl,'content-language':result.ContentLanguage,'content-encoding':result.ContentEncoding })) if (value) headers.set(name,value);
  },
 };
 return output;
}
function missing(error: unknown) {
 // Only missing objects become null; authentication, missing buckets and service failures must surface.
 return error instanceof Error && (error.name === 'NoSuchKey' || error.name === 'NotFound');
}
export function openS3Bucket(config: Config): R2Bucket {
 const client = new S3Client({ endpoint:config.endpoint,region:config.region,forcePathStyle:true,
  credentials:{accessKeyId:config.accessKeyId,secretAccessKey:config.secretAccessKey},
  requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED',maxAttempts:3 });
 const base = (key:string) => ({Bucket:config.bucket,Key:key});
 const bucket = {
  async get(key:string, options?:{range?:{offset?:number;length?:number;suffix?:number}}) {
   let Range: string | undefined;
   const r = options?.range;
   if (r) {
    for (const n of [r.offset,r.length,r.suffix]) if (n !== undefined && (!Number.isSafeInteger(n) || n < 0)) throw new Error('Invalid byte range');
    if (r.length === 0 || r.suffix === 0) throw new Error('Invalid byte range');
    Range = r.suffix !== undefined ? `bytes=-${r.suffix}` : `bytes=${r.offset ?? 0}-${r.length === undefined ? '' : (r.offset ?? 0)+r.length-1}`;
   }
   try { return object(key,await client.send(new GetObjectCommand({...base(key),Range}))); }
   catch (e) { if (missing(e)) return null; throw e; }
  },
  async head(key:string) {
   try { return object(key,await client.send(new HeadObjectCommand(base(key)))); }
   catch (e) { if (missing(e)) return null; throw e; }
  },
  async put(key:string,value:Value,options?:PutOptions) {
   await client.send(new PutObjectCommand({...base(key),...metadata(options),Body:await bytes(value)}));
   return bucket.head(key);
  },
  async delete(keys:string|string[]) { for (const key of Array.isArray(keys) ? keys : [keys]) await client.send(new DeleteObjectCommand(base(key))); },
  async createMultipartUpload(key:string,options?:PutOptions) {
   const result = await client.send(new CreateMultipartUploadCommand({...base(key),...metadata(options)}));
   if (!result.UploadId) throw new Error('Storage did not return an upload ID');
   return bucket.resumeMultipartUpload(key,result.UploadId);
  },
  resumeMultipartUpload(key:string,uploadId:string) {
   const input = {...base(key),UploadId:uploadId};
   return { key,uploadId,
    async uploadPart(partNumber:number,value:Value) {
     if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) throw new Error('Invalid part number');
     const result = await client.send(new UploadPartCommand({...input,PartNumber:partNumber,Body:await bytes(value)}));
     if (!result.ETag) throw new Error('Storage did not return a part ETag');
     return {partNumber,etag:result.ETag};
    },
    async abort() { await client.send(new AbortMultipartUploadCommand(input)); },
    async complete(parts:{partNumber:number;etag:string}[]) {
     await client.send(new CompleteMultipartUploadCommand({...input,MultipartUpload:{Parts:[...parts].sort((a,b)=>a.partNumber-b.partNumber).map(p=>({PartNumber:p.partNumber,ETag:p.etag}))}}));
     return bucket.head(key);
    },
   };
  },
  async list() { throw new Error('S3Bucket.list is not implemented; Mailflare tracks objects in SQLite'); },
 };
 return bucket as unknown as R2Bucket;
}
