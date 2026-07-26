/* SPDX-License-Identifier: AGPL-3.0-only */

export interface EditorMemoryDatabase {
	readonly projects: Map<string, unknown>;
	readonly revisions: Map<string, unknown>;
	readonly settings: Map<string, unknown>;
	readonly analysis: Map<string, unknown>;
	readonly sources: Map<string, unknown>;
	readonly sourceChunks: Map<string, unknown>;
	readonly mediaAssets: Map<string, unknown>;
	readonly videoDerivatives: Map<string, unknown>;
}

const memoryDatabases = new Map<string, EditorMemoryDatabase>();

/**
 * Process-local degraded backend. Its module-scoped registry intentionally
 * mirrors IndexedDB database-name isolation without claiming durability.
 */
export function getMemoryDatabase(name: string): EditorMemoryDatabase {
	let database = memoryDatabases.get(name);
	if (!database) {
		database = {
			projects: new Map(),
			revisions: new Map(),
			settings: new Map(),
			analysis: new Map(),
			sources: new Map(),
			sourceChunks: new Map(),
			mediaAssets: new Map(),
			videoDerivatives: new Map(),
		};
		memoryDatabases.set(name, database);
	}
	return database;
}
