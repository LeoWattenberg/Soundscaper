/* SPDX-License-Identifier: AGPL-3.0-only */

import type { LinkedOriginalStoreService } from './linked-original-store-service.ts';
import type { ProjectDocument, ProjectRepositoryPort } from './project-repository.ts';
import {
	admitProjectPublication,
	type ProjectPublicationStore,
} from './project-publication-options.ts';

const PROJECT_CREATION_FENCE_LOST = Symbol('project-creation-fence-lost');

/** Publish a new identity through the repository's creation fence. */
export async function createStoreProjectIfAbsent(
	store: ProjectPublicationStore,
	repository: ProjectRepositoryPort,
	project: ProjectDocument,
	options: unknown = {},
): Promise<ProjectDocument | null> {
	await admitProjectPublication(store, project, options);
	const create = repository.createIfAbsent;
	if (typeof create !== 'function') {
		throw new Error('Create-only project storage is unavailable.');
	}
	return create.call(repository, project);
}

/** Atomically publish a Scape identity with the staged sources it references. */
export async function createStoreScapeProjectIfAbsent(
	store: ProjectPublicationStore,
	repository: ProjectRepositoryPort,
	project: ProjectDocument,
	options: unknown = {},
): Promise<ProjectDocument | null> {
	await admitProjectPublication(store, project, options);
	const create = repository.createForScapeImportIfAbsent;
	if (typeof create !== 'function') throw new Error('Atomic Scape project creation is unavailable.');
	return create.call(repository, project);
}

/** Remove only the exact fenced value returned by createStoreProjectIfAbsent. */
export async function deleteStoreProjectIfCurrent(
	lifecycle: LinkedOriginalStoreService,
	repository: ProjectRepositoryPort,
	project: ProjectDocument,
): Promise<boolean> {
	const remove = repository.deleteIfCurrent;
	if (typeof remove !== 'function') return false;
	try {
		return await lifecycle.deleteProject(project.id, async () => {
			const deleted = await remove.call(repository, project);
			if (!deleted) throw PROJECT_CREATION_FENCE_LOST;
			return true;
		});
	} catch (error) {
		if (error === PROJECT_CREATION_FENCE_LOST) return false;
		throw error;
	}
}
