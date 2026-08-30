/* SPDX-License-Identifier: AGPL-3.0-only */

import type { LinkedOriginalStoreService } from './linked-original-store-service.ts';
import type {
	ProjectDocument,
	ProjectPostCommitMaintenance,
	ProjectRepositoryPort,
} from './project-repository.ts';
import type { ProjectPublicationStore } from './project-publication-options.ts';

const PROJECT_COMPARISON_LOST = Symbol('project-comparison-lost');

/** Publish through the ordinary linked-original lifecycle only while the captured document is current. */
export async function saveStoreProjectIfCurrent(
	store: ProjectPublicationStore,
	lifecycle: LinkedOriginalStoreService,
	repository: ProjectRepositoryPort,
	expected: ProjectDocument,
	project: ProjectDocument,
	options: unknown = {},
): Promise<ProjectDocument | null> {
	const saveIfCurrent = repository.saveIfCurrent;
	if (typeof saveIfCurrent !== 'function') {
		throw new Error('Exact-current project publication is unavailable.');
	}
	const conditionalRepository = new Proxy(repository, {
		get(target, property) {
			if (property === 'save') {
				return async (
					candidate: ProjectDocument,
					postCommit?: ProjectPostCommitMaintenance,
				): Promise<ProjectDocument> => {
					const saved = await saveIfCurrent.call(target, expected, candidate, postCommit);
					if (saved === null) throw PROJECT_COMPARISON_LOST;
					return saved;
				};
			}
			const value = Reflect.get(target, property, target) as unknown;
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});
	try {
		return await lifecycle.saveProject(store, conditionalRepository, project, options);
	} catch (error) {
		if (error === PROJECT_COMPARISON_LOST) return null;
		throw error;
	}
}
