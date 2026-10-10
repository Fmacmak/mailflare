import { hasValidSessionMutationOrigin } from '../auth/origin';
import { RequestBodyTooLargeError } from '../http/errors';
import { readJsonBody } from '../http/request';
import { parseBuzzConnection } from './connection';
import { disconnectBuzzConnection, getBuzzConnection, saveBuzzConnection } from './service';

/** The route must authenticate the session before passing its user id here. */
export async function handleBuzzConnectionRequest(request: Request, env: Pick<CloudflareEnv,'DB'>, userId: string): Promise<Response> {
 const headers = {'Cache-Control':'no-store'};
 if (request.method !== 'GET' && !hasValidSessionMutationOrigin(request)) return Response.json({error:'Invalid origin'}, {status:403,headers});
 if (request.method === 'PUT') {
  let input;
  try { input = parseBuzzConnection(await readJsonBody<unknown>(request,16 * 1024)); }
  catch (cause) { return Response.json({error:cause instanceof Error ? cause.message : 'Invalid workspace details.'}, {status:cause instanceof RequestBodyTooLargeError ? 413 : 400,headers}); }
  return Response.json({connection:await saveBuzzConnection(env,userId,input)}, {headers});
 }
 if (request.method === 'DELETE') {
  await disconnectBuzzConnection(env,userId);
  return Response.json({connection:null},{headers});
 }
 return Response.json({connection:await getBuzzConnection(env,userId)},{headers});
}
