import { requireSessionUser } from '@/lib/api/auth';
import { getEnv } from '@/lib/cloudflare';
import { handleBuzzConnectionRequest } from '@/lib/buzz/api';

async function handle(request: Request) {
 const env = getEnv();
 const { user, error } = await requireSessionUser(env, request);
 if (error) { error.headers.set('Cache-Control','no-store'); return error; }
 return handleBuzzConnectionRequest(request,env,user.id);
}
export const GET = handle;
export const PUT = handle;
export const DELETE = handle;
