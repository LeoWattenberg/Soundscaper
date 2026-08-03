/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	LinkedOriginalProjectReachabilityRepository,
	MAX_LINKED_ORIGINAL_PROJECT_REACHABILITY_ROOTS,
	MAX_LINKED_ORIGINAL_PROJECT_REVISIONS,
	type LinkedOriginalProjectReachabilityRepositoryOptions,
} from './linked-original-project-reachability-repository.ts';
import type { LinkedVideoOriginalLocatorReference } from './linked-video-original-repository.ts';
import type {
	LinkedOriginalTransientBindingReference,
} from './linked-original-transient-binding-reference.ts';
import type { StorageRepositoryPort } from './repository-port.ts';

export const MAX_LINKED_VIDEO_ORIGINAL_PROJECT_REVISIONS = MAX_LINKED_ORIGINAL_PROJECT_REVISIONS;
export const MAX_LINKED_VIDEO_ORIGINAL_PROJECT_REACHABILITY_ROOTS = MAX_LINKED_ORIGINAL_PROJECT_REACHABILITY_ROOTS;

export interface LinkedVideoOriginalProjectBindingPruneResult {
	readonly durableVideoSourceIds: readonly string[];
	readonly removedLocatorReferences: readonly LinkedVideoOriginalLocatorReference[];
	readonly settledTransientBindings: readonly LinkedOriginalTransientBindingReference[];
}

export type LinkedVideoOriginalProjectReachabilityRepositoryOptions = Omit<
	LinkedOriginalProjectReachabilityRepositoryOptions,
	'managedKinds'
>;

/** Schema-v1 video-only facade over exact kindful project reachability. */
export class LinkedVideoOriginalProjectReachabilityRepository {
	readonly #repository: LinkedOriginalProjectReachabilityRepository;

	constructor(
		port: StorageRepositoryPort,
		options: LinkedVideoOriginalProjectReachabilityRepositoryOptions = {},
	) {
		this.#repository = new LinkedOriginalProjectReachabilityRepository(port, {
			...options,
			managedKinds: ['video'],
		});
	}

	async pruneProjectBindings(
		projectId: string,
		protectedSourceIds: readonly string[],
		ownedTransientBindings: readonly LinkedOriginalTransientBindingReference[] = [],
	): Promise<LinkedVideoOriginalProjectBindingPruneResult | null> {
		if (!Array.isArray(protectedSourceIds)) return null;
		const protectedReferences = protectedSourceIds.map((sourceId) => ({
			kind: 'video' as const,
			sourceId,
		}));
		const result = await this.#repository.pruneProjectBindings(
			projectId,
			protectedReferences,
			ownedTransientBindings,
		);
		if (!result) return null;
		return Object.freeze({
			durableVideoSourceIds: Object.freeze(result.durableSourceReferences.map(({ sourceId }) => sourceId)),
			removedLocatorReferences: Object.freeze(result.removedLocatorReferences.map((reference) => (
				Object.freeze({
					locatorId: reference.locatorId,
					locatorRevision: reference.locatorRevision,
				})
			))),
			settledTransientBindings: result.settledTransientBindings,
		});
	}
}
