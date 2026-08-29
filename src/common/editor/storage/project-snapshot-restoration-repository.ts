/* SPDX-License-Identifier: AGPL-3.0-only */

import { compactProjectSourceMetadata } from '../retention.js';
import { deleteByIndex, request, transact } from './indexeddb-backend.ts';
import { sameProjectSnapshot } from './project-snapshot-equality.ts';
import type { ProjectDocument, ProjectRevision } from './project-repository.ts';
import {
	applyMemoryMutations,
	asRevision,
	clone,
	deleteMemoryMutation,
	nonNegativeInteger,
	revisionKey,
	setMemoryMutation,
	type MemoryMutation,
	type ProjectRevisionRecord,
} from './project-repository-support.ts';
import type { StorageRepositoryPort } from './repository-port.ts';

export interface ProjectSnapshotForRestore {
	readonly current: ProjectDocument | null;
	readonly revisions: readonly ProjectRevision[];
}

/** Replace only project and revision rows, without disturbing linked-original custody. */
export async function restoreProjectSnapshot(
	port: StorageRepositoryPort,
	projectId: string,
	snapshot: ProjectSnapshotForRestore,
): Promise<void> {
	await replaceProjectSnapshot(port, projectId, snapshot);
}

/** Restore only while the imported project is still the exact current document. */
export function restoreProjectSnapshotIfCurrent(
	port: StorageRepositoryPort,
	projectId: string,
	expected: ProjectDocument,
	snapshot: ProjectSnapshotForRestore,
): Promise<boolean> {
	return replaceProjectSnapshot(port, projectId, snapshot, canonicalProject(expected));
}

async function replaceProjectSnapshot(
	port: StorageRepositoryPort,
	projectId: string,
	snapshot: ProjectSnapshotForRestore,
	expected?: ProjectDocument,
): Promise<boolean> {
	const rows = revisionRows(projectId, snapshot.revisions);
	const current = snapshot.current === null ? null : canonicalProject(snapshot.current);
	const database = await port.database();
	if (!database) {
		const memory = port.memory;
		if (expected && !sameProjectSnapshot(memory.projects.get(projectId), expected)) return false;
		const mutations: MemoryMutation[] = [deleteMemoryMutation(memory.projects, projectId)];
		for (const [key, value] of memory.revisions) {
			if (asRevision(value)?.projectId === projectId) {
				mutations.push(deleteMemoryMutation(memory.revisions, key));
			}
		}
		for (const row of rows) mutations.push(setMemoryMutation(memory.revisions, row.key, row));
		if (current) mutations.push(setMemoryMutation(memory.projects, projectId, current));
		applyMemoryMutations(mutations);
		return true;
	}
	return transact(database, ['projects', 'revisions'], 'readwrite', async ({ projects, revisions }) => {
		if (expected && !sameProjectSnapshot(await request(projects.get(projectId)), expected)) return false;
		await request(projects.delete(projectId));
		await deleteByIndex(revisions.index('projectId'), projectId);
		for (const row of rows) await request(revisions.put(row));
		if (current) await request(projects.put(current));
		return true;
	});
}

function revisionRows(
	projectId: string,
	revisions: readonly ProjectRevision[],
): ProjectRevisionRecord[] {
	return revisions.map(({ revision, project }) => {
		const value = nonNegativeInteger(revision, 0);
		return {
			key: revisionKey(projectId, value),
			projectId,
			revision: value,
			project: canonicalProject(project),
		};
	});
}

function canonicalProject(project: ProjectDocument): ProjectDocument {
	return compactProjectSourceMetadata(clone(project)) as ProjectDocument;
}
