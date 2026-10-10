import type { Mailer } from "./mailer";
import type { InProcessQueue } from "./queue";
import type { RealtimeHubRegistry } from "./realtime";
import type { SqliteDatabase } from "./sqlite-database";

import type { PostgresDatabase } from "./postgres-database";

export type NodeRuntime = {
	env: CloudflareEnv;
	dataDir: string;
	database: SqliteDatabase | PostgresDatabase;
	mailer: Mailer;
	inboundQueue: InProcessQueue;
	outboundQueue: InProcessQueue;
	agentQueue: InProcessQueue;
	realtime: RealtimeHubRegistry;
};
