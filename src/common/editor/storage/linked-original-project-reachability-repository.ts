/* SPDX-License-Identifier: AGPL-3.0-only */

import { validateAudioEditorProjectV9, type AudioEditorProjectV9 } from '../project-v9-validation.ts';
import { collectProjectSourceIds } from '../retention.js';
import { request, transact } from './indexeddb-backend.ts';
import type { LinkedOriginalKind } from './linked-original-binding.ts';
import {
	applyMemoryLinkedOriginalProjectBindingPrune,
	planMemoryLinkedOriginalProjectBindingPrune,
	planStoredLinkedOriginalProjectBindingPrune,
	type LinkedOriginalProjectBindingPrunePlan,
} from './linked-original-project-binding-prune.ts';
import {
	readMemoryLinkedOriginalProvisionalRootInventory,
	readStoredLinkedOriginalProvisionalRootInventory,
} from './linked-original-provisional-root.ts';
import {
	LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME,
} from './linked-original-provisional-root-schema.ts';
import {
	MAX_LINKED_ORIGINAL_INVENTORY_RECORDS,
	MAX_LINKED_ORIGINAL_INVENTORY_REFERENCES,
	type LinkedOriginalLocatorReference,
} from './linked-original-repository.ts';
import {
	LINKED_ORIGINAL_STORE_NAME,
	linkedOriginalBindingKey,
} from './linked-original-schema.ts';
import {
	normalizeLinkedOriginalTransientBindingReference,
	type LinkedOriginalTransientBindingReference,
} from './linked-original-transient-binding-reference.ts';
import type { EditorMemoryDatabase } from './memory-backend.ts';
import type { StorageRepositoryPort } from './repository-port.ts';

export const MAX_LINKED_ORIGINAL_PROJECT_REVISIONS = 64;
export const MAX_LINKED_ORIGINAL_PROJECT_REACHABILITY_ROOTS = 100_000;

export interface LinkedOriginalProjectSourceReference {
	readonly kind: LinkedOriginalKind;
	readonly sourceId: string;
}

export interface LinkedOriginalProjectBindingPruneResult {
	readonly durableSourceReferences: readonly LinkedOriginalProjectSourceReference[];
	readonly removedLocatorReferences: readonly LinkedOriginalLocatorReference[];
	readonly settledTransientBindings: readonly LinkedOriginalTransientBindingReference[];
}

export interface LinkedOriginalProjectReachabilityRepositoryOptions {
	readonly maximumRetainedRevisions?: number;
	readonly maximumRoots?: number;
	readonly maximumInventoryRecords?: number;
	readonly maximumInventoryReferences?: number;
	/** Narrow compatibility facades only; generic ownership manages both kinds. */
	readonly managedKinds?: readonly LinkedOriginalKind[];
}

interface RootAccumulator {
	readonly durable: Map<string, LinkedOriginalProjectSourceReference>;
	readonly retained: Set<string>;
	readonly maximumRoots: number;
	readonly managedKinds: ReadonlySet<LinkedOriginalKind>;
}

interface CurrentProjectRootState {
	readonly accumulator: RootAccumulator;
	readonly revision: number;
}

interface StoredProjectRevision {
	readonly key: string;
	readonly projectId: string;
	readonly revision: number;
	readonly project: AudioEditorProjectV9;
}

const REVISION_RECORD_FIELDS = new Set(['key', 'projectId', 'revision', 'project', 'creationFence']);

/** Atomically retire target-project bindings outside exact durable and caller-protected roots. */
export class LinkedOriginalProjectReachabilityRepository {
	readonly #port: StorageRepositoryPort;
	readonly #maximumRetainedRevisions: number;
	readonly #maximumRoots: number;
	readonly #maximumInventoryRecords: number;
	readonly #maximumInventoryReferences: number;
	readonly #managedKinds: ReadonlySet<LinkedOriginalKind>;

	constructor(
		port: StorageRepositoryPort,
		options: LinkedOriginalProjectReachabilityRepositoryOptions = {},
	) {
		if (!port || typeof port.database !== 'function' || !port.memory) {
			throw new TypeError('A linked original project reachability storage port is required.');
		}
		this.#port = port;
		this.#maximumRetainedRevisions = boundedLimit(
			options.maximumRetainedRevisions ?? MAX_LINKED_ORIGINAL_PROJECT_REVISIONS,
			MAX_LINKED_ORIGINAL_PROJECT_REVISIONS,
			'Linked original project retained-revision',
		);
		this.#maximumRoots = boundedLimit(
			options.maximumRoots ?? MAX_LINKED_ORIGINAL_PROJECT_REACHABILITY_ROOTS,
			MAX_LINKED_ORIGINAL_PROJECT_REACHABILITY_ROOTS,
			'Linked original project reachability-root',
		);
		this.#maximumInventoryRecords = boundedLimit(
			options.maximumInventoryRecords ?? MAX_LINKED_ORIGINAL_INVENTORY_RECORDS,
			MAX_LINKED_ORIGINAL_INVENTORY_RECORDS,
			'Linked original project binding inventory record',
		);
		this.#maximumInventoryReferences = boundedLimit(
			options.maximumInventoryReferences ?? MAX_LINKED_ORIGINAL_INVENTORY_REFERENCES,
			MAX_LINKED_ORIGINAL_INVENTORY_REFERENCES,
			'Linked original project binding inventory reference',
		);
		this.#managedKinds = managedKinds(options.managedKinds);
	}

	async pruneProjectBindings(
		projectId: string,
		protectedSourceReferences: readonly LinkedOriginalProjectSourceReference[],
		ownedTransientBindingsValue: readonly LinkedOriginalTransientBindingReference[] = [],
	): Promise<LinkedOriginalProjectBindingPruneResult | null> {
		linkedOriginalBindingKey(projectId, 'project-reachability-validation');
		const protectedRoots = canonicalProtectedRoots(
			protectedSourceReferences,
			this.#managedKinds,
			this.#maximumRoots,
		);
		if (!protectedRoots) return null;
		const ownedTransientBindings = canonicalOwnedTransientBindings(
			ownedTransientBindingsValue,
			this.#managedKinds,
			this.#maximumRoots,
		);
		if (!ownedTransientBindings) return null;
		const database = await this.#port.database();
		if (!database) {
			const state = memoryRootState(
				this.#port.memory,
				projectId,
				protectedRoots,
				this.#maximumRetainedRevisions,
				this.#maximumRoots,
				this.#managedKinds,
			);
			if (!state) return null;
			const bindings = this.#port.memory.linkedVideoOriginalBindings;
			const roots = this.#port.memory.linkedOriginalProvisionalRoots;
			const rootInventory = readMemoryLinkedOriginalProvisionalRootInventory(
				bindings,
				roots,
				this.#maximumInventoryRecords,
			);
			const plan = planMemoryLinkedOriginalProjectBindingPrune(
				bindings,
				rootInventory,
				projectId,
				new Set(state.accumulator.durable.keys()),
				state.accumulator.retained,
				ownedTransientBindings,
				this.#managedKinds,
				this.#maximumInventoryRecords,
				this.#maximumInventoryReferences,
				this.#maximumRoots,
			);
			applyMemoryLinkedOriginalProjectBindingPrune(bindings, roots, plan);
			return frozenResult(state.accumulator.durable, plan);
		}

		return transact(database, [
			'projects',
			'revisions',
			LINKED_ORIGINAL_STORE_NAME,
			LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME,
		], 'readwrite', async (stores) => {
			const current = await request(stores.projects.get(projectId));
			const state = currentProjectRootState(
				current,
				projectId,
				protectedRoots,
				this.#maximumRoots,
				this.#managedKinds,
			);
			if (!state) return null;
			const revisionsValid = await collectIndexedDbRevisionRoots(
				stores.revisions.index('projectId'),
				projectId,
				state,
				this.#maximumRetainedRevisions,
			);
			if (!revisionsValid) return null;
			const bindings = stores[LINKED_ORIGINAL_STORE_NAME];
			const roots = stores[LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME];
			const rootInventory = await readStoredLinkedOriginalProvisionalRootInventory(
				bindings,
				roots,
				this.#maximumInventoryRecords,
			);
			const plan = await planStoredLinkedOriginalProjectBindingPrune(
				bindings,
				rootInventory,
				projectId,
				new Set(state.accumulator.durable.keys()),
				state.accumulator.retained,
				ownedTransientBindings,
				this.#managedKinds,
				this.#maximumInventoryRecords,
				this.#maximumInventoryReferences,
				this.#maximumRoots,
			);
			await Promise.all([
				...plan.bindingDeletionKeys.map((key) => request(bindings.delete(key))),
				...plan.rootDeletionKeys.map((key) => request(roots.delete(key))),
			]);
			return frozenResult(state.accumulator.durable, plan);
		});
	}
}

function currentProjectRootState(
	value: unknown,
	projectId: string,
	protectedRoots: ReadonlySet<string>,
	maximumRoots: number,
	managedKindsValue?: ReadonlySet<LinkedOriginalKind>,
): CurrentProjectRootState | null {
	try {
		if (!validateAudioEditorProjectV9(value)) throw new TypeError('Current project is not exact schema 9.');
		if (value.id !== projectId) throw new Error('Current project identity does not match its key.');
		const accumulator: RootAccumulator = {
			durable: new Map(),
			retained: new Set(protectedRoots),
			maximumRoots,
			managedKinds: managedKindsValue ?? managedKinds(),
		};
		collectOriginalRoots(value, projectId, accumulator);
		return {
			accumulator,
			revision: value.revision,
		};
	} catch { return null; }
}

function memoryRootState(
	memory: EditorMemoryDatabase,
	projectId: string,
	protectedRoots: ReadonlySet<string>,
	maximumRetainedRevisions: number,
	maximumRoots: number,
	managedKindsValue: ReadonlySet<LinkedOriginalKind>,
): CurrentProjectRootState | null {
	const state = currentProjectRootState(
		memory.projects.get(projectId),
		projectId,
		protectedRoots,
		maximumRoots,
		managedKindsValue,
	);
	if (!state) return null;
	let count = 0;
	let matchingCurrent = false;
	try {
		for (const [primaryKey, value] of memory.revisions) {
			if (!isPotentialTargetMemoryRevision(primaryKey, value, projectId)) continue;
			count += 1;
			if (count > maximumRetainedRevisions) return null;
			const revision = storedProjectRevision(value, primaryKey, projectId);
			collectOriginalRoots(revision.project, projectId, state.accumulator);
			if (revision.revision === state.revision) matchingCurrent = true;
		}
	} catch { return null; }
	return count > 0 && matchingCurrent ? state : null;
}

function collectIndexedDbRevisionRoots(
	index: IDBIndex,
	projectId: string,
	state: CurrentProjectRootState,
	maximumRetainedRevisions: number,
): Promise<boolean> {
	return new Promise((resolve, reject) => {
		let cursorRequest: IDBRequest<IDBCursorWithValue | null>;
		try { cursorRequest = index.openCursor(projectId); } catch (error) { reject(error); return; }
		let count = 0;
		let matchingCurrent = false;
		cursorRequest.onerror = () => reject(
			cursorRequest.error || new Error('Could not enumerate retained project revisions.'),
		);
		cursorRequest.onsuccess = () => {
			const cursor = cursorRequest.result;
			if (!cursor) { resolve(count > 0 && matchingCurrent); return; }
			try {
				count += 1;
				if (count > maximumRetainedRevisions) { resolve(false); return; }
				const revision = storedProjectRevision(cursor.value, cursor.primaryKey, projectId);
				collectOriginalRoots(revision.project, projectId, state.accumulator);
				if (revision.revision === state.revision) matchingCurrent = true;
				cursor.continue();
			} catch { resolve(false); }
		};
	});
}

function storedProjectRevision(
	value: unknown,
	primaryKey: IDBValidKey,
	projectId: string,
): StoredProjectRevision {
	const record = closedRevisionRecord(value);
	if (typeof record.key !== 'string' || record.key !== primaryKey
		|| record.projectId !== projectId || record.key !== projectRevisionKey(projectId, record.revision)) {
		throw new Error('Stored project revision does not match its authoritative key.');
	}
	if (!Number.isSafeInteger(record.revision) || Number(record.revision) < 0) {
		throw new TypeError('Stored project revision number must be a non-negative safe integer.');
	}
	const project = record.project;
	if (!validateAudioEditorProjectV9(project)) throw new TypeError('Stored project revision is not exact schema 9.');
	if (project.id !== projectId || project.revision !== record.revision) {
		throw new Error('Stored project revision document does not match its authoritative identity.');
	}
	return record as unknown as StoredProjectRevision;
}

function closedRevisionRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A stored project revision must be an object.');
	}
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('A stored project revision must be a plain object.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length < 4 || keys.length > 5
		|| keys.some((key) => typeof key !== 'string' || !REVISION_RECORD_FIELDS.has(key))) {
		throw new TypeError('A stored project revision contains an unsupported field.');
	}
	const record: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const key of keys) {
		if (typeof key !== 'string') throw new TypeError('A stored project revision has a non-string field.');
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Stored project revision ${key} must be an enumerable data field.`);
		}
		record[key] = descriptor.value;
	}
	for (const required of ['key', 'projectId', 'revision', 'project']) {
		if (!Object.hasOwn(record, required)) throw new TypeError(`Stored project revision ${required} is required.`);
	}
	if (Object.hasOwn(record, 'creationFence') && typeof record.creationFence !== 'string') {
		throw new TypeError('Stored project revision creationFence must be a string.');
	}
	return record;
}

function collectOriginalRoots(
	project: AudioEditorProjectV9,
	projectId: string,
	accumulator: RootAccumulator,
): void {
	const sourceById = new Map(project.sources.map((source) => [String(source.id), source]));
	for (const sourceId of collectProjectSourceIds(project) as Set<string>) {
		const source = sourceById.get(sourceId);
		if ((source?.kind !== 'audio' && source?.kind !== 'video')
			|| !accumulator.managedKinds.has(source.kind)) continue;
		linkedOriginalBindingKey(projectId, sourceId);
		const reference = Object.freeze({ kind: source.kind, sourceId });
		const key = sourceReferenceKey(reference);
		accumulator.durable.set(key, reference);
		accumulator.retained.add(key);
		if (accumulator.retained.size > accumulator.maximumRoots) {
			throw new RangeError('Linked original project reachability exceeds its aggregate root limit.');
		}
	}
}

function canonicalProtectedRoots(
	value: unknown,
	managedKindsValue: ReadonlySet<LinkedOriginalKind>,
	maximumRoots: number,
): ReadonlySet<string> | null {
	if (!Array.isArray(value) || value.length > maximumRoots) return null;
	const roots = new Set<string>();
	try {
		for (const candidate of value) {
			const reference = projectSourceReference(candidate);
			if (!managedKindsValue.has(reference.kind)) return null;
			const key = sourceReferenceKey(reference);
			if (roots.has(key)) return null;
			roots.add(key);
		}
	} catch { return null; }
	return roots;
}

function canonicalOwnedTransientBindings(
	value: unknown,
	managedKindsValue: ReadonlySet<LinkedOriginalKind>,
	maximumRoots: number,
): readonly LinkedOriginalTransientBindingReference[] | null {
	if (!Array.isArray(value) || value.length > maximumRoots) return null;
	const references = new Map<string, LinkedOriginalTransientBindingReference>();
	try {
		for (const candidate of value) {
			const reference = normalizeLinkedOriginalTransientBindingReference(candidate);
			if (!managedKindsValue.has(reference.kind)) return null;
			const key = sourceReferenceKey(reference);
			if (references.has(key)) return null;
			references.set(key, reference);
		}
	} catch { return null; }
	return Object.freeze([...references.values()].sort((left, right) => (
		left.kind.localeCompare(right.kind) || left.sourceId.localeCompare(right.sourceId)
	)));
}

function frozenResult(
	durable: ReadonlyMap<string, LinkedOriginalProjectSourceReference>,
	plan: LinkedOriginalProjectBindingPrunePlan,
): LinkedOriginalProjectBindingPruneResult {
	const durableSourceReferences = Object.freeze([...durable.values()]
		.sort((left, right) => (
			left.kind.localeCompare(right.kind) || left.sourceId.localeCompare(right.sourceId)
		)));
	const removedLocatorReferences = Object.freeze([...plan.removedReferences.values()]
		.sort((left, right) => (
			left.kind.localeCompare(right.kind) || left.locatorId.localeCompare(right.locatorId)
		)));
	return Object.freeze({
		durableSourceReferences,
		removedLocatorReferences,
		settledTransientBindings: plan.settledTransientBindings,
	});
}

function projectSourceReference(value: unknown): LinkedOriginalProjectSourceReference {
	const record = closedReference(value, ['kind', 'sourceId'], 'project source');
	if (record.kind !== 'audio' && record.kind !== 'video') {
		throw new TypeError('Linked original project source kind must be audio or video.');
	}
	linkedOriginalBindingKey('project-source-reference-validation', record.sourceId);
	return Object.freeze({ kind: record.kind, sourceId: record.sourceId as string });
}

function sourceReferenceKey(value: LinkedOriginalProjectSourceReference): string {
	return JSON.stringify([value.kind, value.sourceId]);
}

function closedReference(
	value: unknown,
	fields: readonly string[],
	label: string,
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`A linked original ${label} reference is required.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`A linked original ${label} reference contains an unsupported field.`);
	}
	const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Linked original ${label} ${field} must be an enumerable data field.`);
		}
		output[field] = descriptor.value;
	}
	return output;
}

function managedKinds(value: unknown = ['audio', 'video']): ReadonlySet<LinkedOriginalKind> {
	if (!Array.isArray(value) || value.length < 1 || value.length > 2) {
		throw new TypeError('Linked original managed kinds must be a non-empty array.');
	}
	const kinds = new Set<LinkedOriginalKind>();
	for (const kind of value) {
		if (kind !== 'audio' && kind !== 'video') {
			throw new TypeError('Linked original managed kind must be audio or video.');
		}
		if (kinds.has(kind)) throw new Error('Linked original managed kinds contain a duplicate.');
		kinds.add(kind);
	}
	return kinds;
}

function isPotentialTargetMemoryRevision(primaryKey: string, value: unknown, projectId: string): boolean {
	const prefix = `${projectId}:`;
	if (primaryKey.startsWith(prefix) && /^\d{12,}$/u.test(primaryKey.slice(prefix.length))) return true;
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const descriptor = Object.getOwnPropertyDescriptor(value, 'projectId');
	return Boolean(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.value === projectId);
}

function projectRevisionKey(projectId: string, revisionValue: unknown): string {
	const revision = Number(revisionValue);
	if (!Number.isSafeInteger(revision) || revision < 0) {
		throw new TypeError('Stored project revision number must be a non-negative safe integer.');
	}
	return `${projectId}:${String(revision).padStart(12, '0')}`;
}

function boundedLimit(value: unknown, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) {
		throw new RangeError(`${label} limit must be a positive safe integer no greater than ${String(maximum)}.`);
	}
	return Number(value);
}
