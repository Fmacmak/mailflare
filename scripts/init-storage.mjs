import { S3Client, HeadBucketCommand, CreateBucketCommand } from '@aws-sdk/client-s3';
for (const name of ['S3_ENDPOINT','S3_BUCKET','S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY']) if (!process.env[name]) throw new Error(`${name} is required`);
const url = new URL(process.env.S3_ENDPOINT);
if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname)) throw new Error('This initialization script only creates buckets on local storage');
const client = new S3Client({endpoint:url.href,region:process.env.S3_REGION || 'us-east-1',forcePathStyle:true,
 credentials:{accessKeyId:process.env.S3_ACCESS_KEY_ID,secretAccessKey:process.env.S3_SECRET_ACCESS_KEY}});
const input = {Bucket:process.env.S3_BUCKET};
try {await client.send(new HeadBucketCommand(input));console.log('Local storage bucket already exists.');}
catch (error) {
 if (error.$metadata?.httpStatusCode !== 404) throw error;
 await client.send(new CreateBucketCommand(input));console.log('Created local storage bucket.');
} finally {client.destroy();}
