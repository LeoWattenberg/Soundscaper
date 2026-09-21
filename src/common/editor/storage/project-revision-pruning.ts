/* SPDX-License-Identifier: AGPL-3.0-only */

/** Shared bounded revision-history maintenance for every project publication path. */

import { request, transact } from './indexeddb-backend.ts';
import {
	asRevision,
	isRevisionFor,
	type ProjectRevisionRecord,
} from './project-repository-support.ts';
import type { StorageRepositoryPort } from './repository-port.ts';

export async function pruneProjectRevisions(
	port: StorageRepositoryPort,
	projectId: string,
	revisionLimit: number,
): Promise<void> {
	const database = await port.database();
	const records = !database
		? [...port.memory.revisions.values()].map(asRevision).filter(isRevisionFor(projectId))
		: await transact(database, 'revisions', 'readonly', ({ revisions }) => (
			request(revisions.index('projectId').getAll(projectId)) as Promise<ProjectRevisionRecord[]>
		));
	records.sort((left, right) => right.revision - left.revision);
	const stale = records.slice(revisionLimit);
	if (stale.length === 0) return;
	if (!database) {
		for (const record of stale) port.memory.revisions.delete(record.key);
		return;
	}
	await transact(database, 'revisions', 'readwrite', ({ revisions }) => {
		for (const record of stale) revisions.delete(record.key);
	});
}
