/* SPDX-License-Identifier: AGPL-3.0-only */

import type { LinkedVideoOriginalLifecycleCoordinator } from './linked-video-original-lifecycle-coordinator.ts';
import type { LinkedVideoOriginalProjectReachabilityRepository } from './linked-video-original-project-reachability-repository.ts';
import type { ProjectDocument, ProjectRepositoryPort } from './project-repository.ts';
import {
	admitProjectPublication,
	projectProtectedLinkedVideoSourceIds,
	type ProjectPublicationStore,
} from './project-publication-options.ts';

interface LinkedVideoProjectSaveDependencies {
	readonly store: ProjectPublicationStore;
	readonly projects: ProjectRepositoryPort;
	readonly lifecycle: LinkedVideoOriginalLifecycleCoordinator;
	readonly reachability?: LinkedVideoOriginalProjectReachabilityRepository | null;
}

/** Serialize publication with optional, authoritative source-level binding cleanup. */
export async function saveProjectWithLinkedVideoOriginalReachability(
	dependencies: LinkedVideoProjectSaveDependencies,
	project: ProjectDocument,
	options: unknown = {},
): Promise<ProjectDocument> {
	const protectedSourceIds = projectProtectedLinkedVideoSourceIds(options);
	const save = async (postCommit?: () => Promise<void>): Promise<ProjectDocument> => {
		await admitProjectPublication(dependencies.store, project, options);
		return dependencies.projects.save(project, postCommit);
	};
	if (!protectedSourceIds || !dependencies.reachability) {
		return dependencies.lifecycle.saveProject(
			project.id,
			(maintain) => save(maintain),
			async () => null,
		);
	}
	return dependencies.lifecycle.saveProject(
		project.id,
		(maintain) => save(maintain),
		async (transientSourceIds) => {
			const roots = frozenUnion(protectedSourceIds, transientSourceIds);
			const result = await dependencies.reachability!.pruneProjectBindings(project.id, roots);
			if (!result) return null;
			return Object.freeze({
				durableVideoSourceIds: frozenUnion(
					result.durableVideoSourceIds,
					protectedSourceIds,
				),
				removedLocatorReferences: result.removedLocatorReferences,
			});
		},
	);
}

function frozenUnion(left: readonly string[], right: readonly string[]): readonly string[] {
	return Object.freeze([...new Set([...left, ...right])].sort());
}
