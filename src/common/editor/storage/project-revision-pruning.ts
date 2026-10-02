/* SPDX-License-Identifier: AGPL-3.0-only */

/** Shared bounded revision-history maintenance for every project publication path. */

import { request, transact } from './indexeddb-backend.ts';
import {
	asRecord,
	asRevision,
	isRevisionFor,
	revisionKey,
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
				readRevisionIdentities(revisions.index('projectId'), projectId),
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

interface RevisionIdentity { readonly key: string; readonly revision: number }

/** Publication keys already encode the revision; loading whole documents here multiplies autosave work. */
async function readRevisionIdentities(index: IDBIndex, projectId: string): Promise<RevisionIdentity[]> {
	const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
		const identities: IDBValidKey[] = [];
		const cursorRequest = index.openKeyCursor(projectId);
		cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error('Could not enumerate project revisions.'));
		cursorRequest.onsuccess = () => {
			const cursor = cursorRequest.result;
			if (!cursor) { resolve(identities); return; }
			identities.push(cursor.primaryKey);
			cursor.continue();
		};
	});
	return (await Promise.all(keys.map(async (key): Promise<RevisionIdentity | null> => {
		if (typeof key === 'string' && key.startsWith(`${projectId}:`)) {
			const revision = Number(key.slice(projectId.length + 1));
			if (Number.isSafeInteger(revision) && revision >= 0 && revisionKey(projectId, revision) === key) {
				return { key, revision };
			}
		}
		// Retain compatibility with historical rows whose keys do not follow the publication format.
		return asRevision(await request(index.objectStore.get(key)));
	}))).filter((identity): identity is RevisionIdentity => identity !== null);
}
