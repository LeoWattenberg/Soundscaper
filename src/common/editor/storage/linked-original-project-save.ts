/* SPDX-License-Identifier: AGPL-3.0-only */

import type { LinkedOriginalLifecycleCoordinator } from './linked-original-lifecycle-coordinator.ts';
import type {
	LinkedOriginalProjectReachabilityRepository,
	LinkedOriginalProjectSourceReference,
} from './linked-original-project-reachability-repository.ts';
import type { ProjectDocument, ProjectRepositoryPort } from './project-repository.ts';
import {
	admitProjectPublication,
	projectProtectedLinkedOriginalSourceReferences,
	type ProjectPublicationStore,
} from './project-publication-options.ts';

interface LinkedOriginalProjectSaveDependencies {
	readonly store: ProjectPublicationStore;
	readonly projects: ProjectRepositoryPort;
	readonly lifecycle: LinkedOriginalLifecycleCoordinator;
	readonly reachability?: LinkedOriginalProjectReachabilityRepository | null;
}

/** Serialize publication with authoritative mixed-media linked-original cleanup. */
export async function saveProjectWithLinkedOriginalReachability(
	dependencies: LinkedOriginalProjectSaveDependencies,
	project: ProjectDocument,
	options: unknown = {},
): Promise<ProjectDocument> {
	const protectedReferences = projectProtectedLinkedOriginalSourceReferences(options);
	const save = async (postCommit?: () => Promise<void>): Promise<ProjectDocument> => {
		await admitProjectPublication(dependencies.store, project, options);
		return dependencies.projects.save(project, postCommit);
	};
	if (!protectedReferences || !dependencies.reachability) {
		return dependencies.lifecycle.saveProject(
			project.id,
			(maintain) => save(maintain),
			async () => null,
		);
	}
	return dependencies.lifecycle.saveProject(
		project.id,
		(maintain) => save(maintain),
		async (transientBindings) => {
			const result = await dependencies.reachability!.pruneProjectBindings(
				project.id,
				protectedReferences,
				transientBindings,
			);
			if (!result) return null;
			return Object.freeze({
				durableSourceReferences: frozenReferenceUnion(
					result.durableSourceReferences,
					protectedReferences,
				),
				removedLocatorReferences: result.removedLocatorReferences,
				settledTransientBindings: result.settledTransientBindings,
			});
		},
	);
}

function frozenReferenceUnion(
	left: readonly LinkedOriginalProjectSourceReference[],
	right: readonly LinkedOriginalProjectSourceReference[],
): readonly LinkedOriginalProjectSourceReference[] {
	const references = new Map<string, LinkedOriginalProjectSourceReference>();
	for (const reference of [...left, ...right]) {
		references.set(JSON.stringify([reference.kind, reference.sourceId]), reference);
	}
	return Object.freeze([...references.values()].sort((first, second) => (
		first.kind.localeCompare(second.kind) || first.sourceId.localeCompare(second.sourceId)
	)));
}
