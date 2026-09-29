/* SPDX-License-Identifier: AGPL-3.0-only */

/** Shared bounded revision-history maintenance for every project publication path. */

import { request, transact } from './indexeddb-backend.ts';
import {
	asRecord,
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
	const { records, current } = !database
		? {
			records: [...port.memory.revisions.values()].map(asRevision).filter(isRevisionFor(projectId)),
			current: port.memory.projects.get(projectId),
		}
		: await transact(database, ['projects', 'revisions'], 'readonly', async ({ projects, revisions }) => {
			const [records, current] = await Promise.all([
				request(revisions.index('projectId').getAll(projectId)) as Promise<ProjectRevisionRecord[]>,
				request(projects.get(projectId)) as Promise<unknown>,
			]);
			return { records, current };
		});
	const revision = asRecord(current)?.revision;
	const currentRevision = Number.isSafeInteger(revision) && Number(revision) >= 0 ? Number(revision) : null;
	// Replacing a project with an older backup can make its current revision lower
	// than retained history; that row must still survive the bounded prune.
	records.sort((left, right) => (
		Number(right.revision === currentRevision) - Number(left.revision === currentRevision)
		|| right.revision - left.revision
	));
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
