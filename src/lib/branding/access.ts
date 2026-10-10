import { isNodeRuntime } from '@/lib/runtime';

/** This open-source fork permits branding on self-hosted Node installations. */
export function hasBrandingAccess(env: CloudflareEnv, licensed: boolean): boolean {
 return isNodeRuntime(env) || licensed;
}
