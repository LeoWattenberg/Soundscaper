/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Store-level restore of a captured project snapshot after a failed
 * replace-import.
 *
 * The atomic repository primitive replaces only the project document and
 * revision rows: linked-original bindings, their locator grants, and
 * provisional roots stay untouched, and the restore runs without publication
 * admission so it cannot be refused by the same quota shortage that failed
 * the import. Repositories without the primitive keep the legacy
 * delete-then-resave sequence.
 */

import type { ProjectRepositoryPort } from './project-repository.ts';

interface SnapshotStore {
	deleteProject(projectId: string): Promise<unknown>;
	saveProject(project: Readonly<{ readonly id: string;[field: string]: unknown }>): Promise<unknown>;
}

export async function restoreStoreProjectSnapshot(
	store: SnapshotStore,
	repository: ProjectRepositoryPort,
	projectId: string,
	snapshot: Readonly<{
		readonly current: Readonly<{ readonly id: string;[field: string]: unknown }> | null;
		readonly revisions: readonly Readonly<{
			readonly revision: number;
			readonly project: Readonly<{ readonly id: string;[field: string]: unknown }>;
		}>[];
	}>,
): Promise<void> {
	if (typeof repository.restore !== 'function') {
		await store.deleteProject(projectId);
		const revisions = [...snapshot.revisions].sort((left, right) => left.revision - right.revision);
		for (const revision of revisions) await store.saveProject(revision.project);
		if (snapshot.current) await store.saveProject(snapshot.current);
		return;
	}
	return repository.restore(projectId, snapshot);
}
