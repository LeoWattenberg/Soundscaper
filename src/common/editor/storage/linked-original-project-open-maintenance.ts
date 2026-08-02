/* SPDX-License-Identifier: AGPL-3.0-only */

import type { LinkedOriginalLifecycleCoordinator } from './linked-original-lifecycle-coordinator.ts';
import type {
	LinkedOriginalProjectBindingPruneResult,
	LinkedOriginalProjectReachabilityRepository,
	LinkedOriginalProjectSourceReference,
} from './linked-original-project-reachability-repository.ts';
import { linkedOriginalBindingKey } from './linked-original-schema.ts';
import type { LinkedVideoOriginalLifecycleCoordinator } from './linked-video-original-lifecycle-coordinator.ts';
import type {
	LinkedVideoOriginalProjectBindingPruneResult,
} from './linked-video-original-lifecycle-coordinator.ts';
import type {
	LinkedVideoOriginalProjectReachabilityRepository,
} from './linked-video-original-project-reachability-repository.ts';
import type { ProjectPostCommitMaintenance } from './project-repository.ts';

interface CurrentProjectMaintenancePort {
	maintainCurrentProject?(projectId: string, maintenance: ProjectPostCommitMaintenance): Promise<void>;
}

interface OpenMaintenanceAdmission {
	isDurable(): PromiseLike<boolean> | boolean;
}

interface LinkedOriginalOpenMaintenanceDependencies extends OpenMaintenanceAdmission {
	readonly lifecycle: LinkedOriginalLifecycleCoordinator;
	readonly projects: CurrentProjectMaintenancePort;
	readonly reachability?: LinkedOriginalProjectReachabilityRepository | null;
}

interface LinkedVideoOpenMaintenanceDependencies extends OpenMaintenanceAdmission {
	readonly lifecycle: LinkedVideoOriginalLifecycleCoordinator;
	readonly projects: CurrentProjectMaintenancePort;
	readonly reachability?: LinkedVideoOriginalProjectReachabilityRepository | null;
}

/** Prune one successfully opened durable project under lifecycle and latest-project ownership. */
export async function maintainOpenedProjectWithLinkedOriginalReachability(
	dependencies: LinkedOriginalOpenMaintenanceDependencies,
	projectId: string,
	collectProtectedSourceReferences: () => unknown,
): Promise<boolean> {
	if (typeof collectProtectedSourceReferences !== 'function') {
		throw new TypeError('Linked-original open-maintenance roots must be collected by a function.');
	}
	if (!await durableMaintenanceAvailable(dependencies)
		|| !dependencies.reachability
		|| typeof dependencies.projects.maintainCurrentProject !== 'function') return false;
	return dependencies.lifecycle.maintainOpenedProject(projectId, async (transientReferences) => {
		let result: LinkedOriginalProjectBindingPruneResult | null = null;
		await dependencies.projects.maintainCurrentProject!(projectId, async () => {
			const protectedSourceReferences = collectProtectedSourceReferences();
			if (protectedSourceReferences === null) return;
			const roots = kindfulReferenceUnion(projectId, protectedSourceReferences, transientReferences);
			result = await dependencies.reachability!.pruneProjectBindings(projectId, roots);
		});
		return result;
	});
}

/** Preserve the current video-only facade when the generic platform port is absent. */
export async function maintainOpenedProjectWithLinkedVideoOriginalReachability(
	dependencies: LinkedVideoOpenMaintenanceDependencies,
	projectId: string,
	collectProtectedSourceReferences: () => unknown,
): Promise<boolean> {
	if (typeof collectProtectedSourceReferences !== 'function') {
		throw new TypeError('Linked-original open-maintenance roots must be collected by a function.');
	}
	if (!await durableMaintenanceAvailable(dependencies)
		|| !dependencies.reachability
		|| typeof dependencies.projects.maintainCurrentProject !== 'function') return false;
	return dependencies.lifecycle.maintainOpenedProject(projectId, async (transientSourceIds) => {
		let result: LinkedVideoOriginalProjectBindingPruneResult | null = null;
		await dependencies.projects.maintainCurrentProject!(projectId, async () => {
			const protectedSourceReferences = collectProtectedSourceReferences();
			if (protectedSourceReferences === null) return;
			const roots = videoSourceIdUnion(projectId, protectedSourceReferences, transientSourceIds);
			result = await dependencies.reachability!.pruneProjectBindings(projectId, roots);
		});
		return result;
	});
}

async function durableMaintenanceAvailable(dependencies: OpenMaintenanceAdmission): Promise<boolean> {
	try { return await dependencies.isDurable() === true; }
	catch { return false; }
}

function kindfulReferenceUnion(
	projectId: string,
	protectedReferences: unknown,
	transientReferences: readonly LinkedOriginalProjectSourceReference[],
): readonly LinkedOriginalProjectSourceReference[] {
	const protectedValues = projectSourceReferences(projectId, protectedReferences);
	const references = new Map<string, LinkedOriginalProjectSourceReference>();
	for (const reference of [...protectedValues, ...transientReferences]) {
		references.set(referenceKey(reference), reference);
	}
	return Object.freeze([...references.values()].sort(compareReferences));
}

function videoSourceIdUnion(
	projectId: string,
	protectedReferences: unknown,
	transientSourceIds: readonly string[],
): readonly string[] {
	const sourceIds = new Set(transientSourceIds);
	for (const reference of projectSourceReferences(projectId, protectedReferences)) {
		if (reference.kind === 'video') sourceIds.add(reference.sourceId);
	}
	return Object.freeze([...sourceIds].sort());
}

function projectSourceReferences(
	projectId: string,
	value: unknown,
): readonly LinkedOriginalProjectSourceReference[] {
	if (!Array.isArray(value)) throw new TypeError('Linked-original open-maintenance roots must be an array.');
	const references: LinkedOriginalProjectSourceReference[] = [];
	const keys = new Set<string>();
	for (const candidate of value) {
		if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
			throw new TypeError('A linked-original open-maintenance root is required.');
		}
		const fields = ['kind', 'sourceId'];
		const ownKeys = Reflect.ownKeys(candidate);
		if (ownKeys.length !== fields.length
			|| ownKeys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
			throw new TypeError('A linked-original open-maintenance root contains an unsupported field.');
		}
		const record = candidate as Readonly<Record<string, unknown>>;
		for (const field of fields) {
			const descriptor = Object.getOwnPropertyDescriptor(candidate, field);
			if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
				throw new TypeError(`Linked-original open-maintenance ${field} must be an enumerable data field.`);
			}
		}
		if (record.kind !== 'audio' && record.kind !== 'video') {
			throw new TypeError('Linked-original open-maintenance kind must be audio or video.');
		}
		linkedOriginalBindingKey(projectId, record.sourceId);
		const reference = Object.freeze({ kind: record.kind, sourceId: record.sourceId as string });
		const key = referenceKey(reference);
		if (keys.has(key)) throw new Error('Linked-original open-maintenance roots contain a duplicate.');
		keys.add(key);
		references.push(reference);
	}
	return references;
}

function referenceKey(reference: LinkedOriginalProjectSourceReference): string {
	return JSON.stringify([reference.kind, reference.sourceId]);
}

function compareReferences(
	left: LinkedOriginalProjectSourceReference,
	right: LinkedOriginalProjectSourceReference,
): number {
	return left.kind.localeCompare(right.kind) || left.sourceId.localeCompare(right.sourceId);
}
