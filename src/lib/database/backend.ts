import type { MigrationResult, MigrationStatus } from '@/lib/migrations/types';
export interface PostgresBackend {
 dialect: 'postgres';
 migrationStatus(): Promise<MigrationStatus>;
 migratePending(): Promise<MigrationResult>;
}
export function postgresBackend(db: D1Database): PostgresBackend | null {
 const backend = db as unknown as Partial<PostgresBackend>;
 return backend.dialect === 'postgres' ? backend as PostgresBackend : null;
}
