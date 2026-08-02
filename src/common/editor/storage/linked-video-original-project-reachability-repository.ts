/* SPDX-License-Identifier: AGPL-3.0-only */

import { validateAudioEditorProjectV9, type AudioEditorProjectV9 } from '../project-v9-validation.ts';
import { collectProjectSourceIds } from '../retention.js';
import { request, transact } from './indexeddb-backend.ts';
import type { LinkedVideoOriginalBinding } from './linked-video-original-binding.ts';
import type { LinkedOriginalBinding } from './linked-original-binding.ts';
import { validateLinkedOriginalInventoryBinding } from './linked-original-repository-inventory.ts';
import {
	MAX_LINKED_VIDEO_ORIGINAL_INVENTORY_RECORDS,
	MAX_LINKED_VIDEO_ORIGINAL_INVENTORY_REFERENCES,
	type LinkedVideoOriginalLocatorReference,
} from './linked-video-original-repository.ts';
import {
	LINKED_VIDEO_ORIGINAL_STORE_NAME,
	linkedVideoOriginalBindingKey,
} from './linked-video-original-schema.ts';
import type { EditorMemoryDatabase } from './memory-backend.ts';
import type { StorageRepositoryPort } from './repository-port.ts';

export const MAX_LINKED_VIDEO_ORIGINAL_PROJECT_REVISIONS = 64;
export const MAX_LINKED_VIDEO_ORIGINAL_PROJECT_REACHABILITY_ROOTS = 100_000;

export interface LinkedVideoOriginalProjectBindingPruneResult {
	readonly durableVideoSourceIds: readonly string[];
	readonly removedLocatorReferences: readonly LinkedVideoOriginalLocatorReference[];
}

export interface LinkedVideoOriginalProjectReachabilityRepositoryOptions {
	readonly maximumRetainedRevisions?: number;
	readonly maximumRoots?: number;
	readonly maximumInventoryRecords?: number;
	readonly maximumInventoryReferences?: number;
}

interface RootAccumulator {
	readonly durable: Set<string>;
	readonly retained: Set<string>;
	readonly maximumRoots: number;
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

interface BindingPrunePlan {
	readonly deletionKeys: readonly string[];
	readonly removedReferences: ReadonlyMap<string, string>;
}

const REVISION_RECORD_FIELDS = new Set(['key', 'projectId', 'revision', 'project', 'creationFence']);

/** Atomically retire target-project bindings outside durable and caller-protected roots. */
export class LinkedVideoOriginalProjectReachabilityRepository {
	readonly #port: StorageRepositoryPort;
	readonly #maximumRetainedRevisions: number;
	readonly #maximumRoots: number;
	readonly #maximumInventoryRecords: number;
	readonly #maximumInventoryReferences: number;

	constructor(
		port: StorageRepositoryPort,
		options: LinkedVideoOriginalProjectReachabilityRepositoryOptions = {},
	) {
		if (!port || typeof port.database !== 'function' || !port.memory) {
			throw new TypeError('A linked video project reachability storage port is required.');
		}
		this.#port = port;
		this.#maximumRetainedRevisions = boundedLimit(
			options.maximumRetainedRevisions ?? MAX_LINKED_VIDEO_ORIGINAL_PROJECT_REVISIONS,
			MAX_LINKED_VIDEO_ORIGINAL_PROJECT_REVISIONS,
			'Linked video project retained-revision',
		);
		this.#maximumRoots = boundedLimit(
			options.maximumRoots ?? MAX_LINKED_VIDEO_ORIGINAL_PROJECT_REACHABILITY_ROOTS,
			MAX_LINKED_VIDEO_ORIGINAL_PROJECT_REACHABILITY_ROOTS,
			'Linked video project reachability-root',
		);
		this.#maximumInventoryRecords = boundedLimit(
			options.maximumInventoryRecords ?? MAX_LINKED_VIDEO_ORIGINAL_INVENTORY_RECORDS,
			MAX_LINKED_VIDEO_ORIGINAL_INVENTORY_RECORDS,
			'Linked video project binding inventory record',
		);
		this.#maximumInventoryReferences = boundedLimit(
			options.maximumInventoryReferences ?? MAX_LINKED_VIDEO_ORIGINAL_INVENTORY_REFERENCES,
			MAX_LINKED_VIDEO_ORIGINAL_INVENTORY_REFERENCES,
			'Linked video project binding inventory reference',
		);
	}

	async pruneProjectBindings(
		projectId: string,
		protectedSourceIds: readonly string[],
	): Promise<LinkedVideoOriginalProjectBindingPruneResult | null> {
		linkedVideoOriginalBindingKey(projectId, 'project-reachability-validation');
		const protectedRoots = canonicalProtectedRoots(protectedSourceIds, this.#maximumRoots);
		if (!protectedRoots) return null;
		const database = await this.#port.database();
		if (!database) {
			const state = memoryRootState(
				this.#port.memory,
				projectId,
				protectedRoots,
				this.#maximumRetainedRevisions,
				this.#maximumRoots,
			);
			if (!state) return null;
			const plan = bindingPrunePlan(
				this.#port.memory.linkedVideoOriginalBindings,
				projectId,
				state.accumulator.retained,
				this.#maximumInventoryRecords,
				this.#maximumInventoryReferences,
			);
			applyMemoryBindingDeletions(this.#port.memory.linkedVideoOriginalBindings, plan.deletionKeys);
			return frozenResult(state.accumulator.durable, plan.removedReferences);
		}

		return transact(database, [
			'projects',
			'revisions',
			LINKED_VIDEO_ORIGINAL_STORE_NAME,
		], 'readwrite', async (stores) => {
			const current = await request(stores.projects.get(projectId));
			const state = currentProjectRootState(
				current,
				projectId,
				protectedRoots,
				this.#maximumRoots,
			);
			if (!state) return null;
			const revisionsValid = await collectIndexedDbRevisionRoots(
				stores.revisions.index('projectId'),
				projectId,
				state,
				this.#maximumRetainedRevisions,
			);
			if (!revisionsValid) return null;
			const plan = await indexedDbBindingPrunePlan(
				stores[LINKED_VIDEO_ORIGINAL_STORE_NAME],
				projectId,
				state.accumulator.retained,
				this.#maximumInventoryRecords,
				this.#maximumInventoryReferences,
			);
			await Promise.all(plan.deletionKeys.map((key) => (
				request(stores[LINKED_VIDEO_ORIGINAL_STORE_NAME].delete(key))
			)));
			return frozenResult(state.accumulator.durable, plan.removedReferences);
		});
	}
}

function currentProjectRootState(
	value: unknown,
	projectId: string,
	protectedRoots: ReadonlySet<string>,
	maximumRoots: number,
): CurrentProjectRootState | null {
	try {
		if (!validateAudioEditorProjectV9(value)) throw new TypeError('Current project is not exact schema 9.');
		if (value.id !== projectId) throw new Error('Current project identity does not match its key.');
		const accumulator: RootAccumulator = {
			durable: new Set(),
			retained: new Set(protectedRoots),
			maximumRoots,
		};
		collectVideoRoots(value, projectId, accumulator);
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
): CurrentProjectRootState | null {
	const state = currentProjectRootState(
		memory.projects.get(projectId),
		projectId,
		protectedRoots,
		maximumRoots,
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
			collectVideoRoots(revision.project, projectId, state.accumulator);
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
				collectVideoRoots(revision.project, projectId, state.accumulator);
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

function collectVideoRoots(
	project: AudioEditorProjectV9,
	projectId: string,
	accumulator: RootAccumulator,
): void {
	const sourceById = new Map(project.sources.map((source) => [String(source.id), source]));
	for (const sourceId of collectProjectSourceIds(project) as Set<string>) {
		const source = sourceById.get(sourceId);
		if (source?.kind !== 'video') continue;
		linkedVideoOriginalBindingKey(projectId, sourceId);
		accumulator.durable.add(sourceId);
		accumulator.retained.add(sourceId);
		if (accumulator.retained.size > accumulator.maximumRoots) {
			throw new RangeError('Linked video project reachability exceeds its aggregate root limit.');
		}
	}
}

function canonicalProtectedRoots(value: unknown, maximumRoots: number): ReadonlySet<string> | null {
	if (!Array.isArray(value) || value.length > maximumRoots) return null;
	const roots = new Set<string>();
	try {
		for (const sourceId of value) {
			linkedVideoOriginalBindingKey('protected-project-validation', sourceId);
			if (roots.has(sourceId)) return null;
			roots.add(sourceId);
		}
	} catch { return null; }
	return roots;
}

function bindingPrunePlan(
	records: ReadonlyMap<string, unknown>,
	projectId: string,
	retainedSourceIds: ReadonlySet<string>,
	maximumRecords: number,
	maximumReferences: number,
): BindingPrunePlan {
	const deletionKeys: string[] = [];
	const inventoryReferences = new Map<string, string>();
	const removedReferences = new Map<string, string>();
	let count = 0;
	for (const [primaryKey, value] of records) {
		count += 1;
		if (count > maximumRecords) {
			throw new RangeError('Linked video project binding inventory exceeds its record limit.');
		}
		const binding = validateLinkedOriginalInventoryBinding(value, primaryKey);
		if (binding.kind !== 'video') continue;
		addInventoryReference(inventoryReferences, binding, maximumReferences);
		if (binding.projectId !== projectId || retainedSourceIds.has(binding.sourceId)) continue;
		deletionKeys.push(primaryKey);
		removedReferences.set(binding.locatorId, binding.locatorRevision);
	}
	return { deletionKeys, removedReferences };
}

function indexedDbBindingPrunePlan(
	store: IDBObjectStore,
	projectId: string,
	retainedSourceIds: ReadonlySet<string>,
	maximumRecords: number,
	maximumReferences: number,
): Promise<BindingPrunePlan> {
	return new Promise((resolve, reject) => {
		const deletionKeys: string[] = [];
		const inventoryReferences = new Map<string, string>();
		const removedReferences = new Map<string, string>();
		let count = 0;
		let cursorRequest: IDBRequest<IDBCursorWithValue | null>;
		try { cursorRequest = store.openCursor(); } catch (error) { reject(error); return; }
		cursorRequest.onerror = () => reject(
			cursorRequest.error || new Error('Could not enumerate linked video project bindings.'),
		);
		cursorRequest.onsuccess = () => {
			const cursor = cursorRequest.result;
			if (!cursor) { resolve({ deletionKeys, removedReferences }); return; }
			try {
				count += 1;
				if (count > maximumRecords) {
					throw new RangeError('Linked video project binding inventory exceeds its record limit.');
				}
				const binding = validateLinkedOriginalInventoryBinding(cursor.value, cursor.primaryKey);
				if (binding.kind !== 'video') { cursor.continue(); return; }
				addInventoryReference(inventoryReferences, binding, maximumReferences);
				if (binding.projectId === projectId && !retainedSourceIds.has(binding.sourceId)) {
					deletionKeys.push(linkedVideoOriginalBindingKey(binding.projectId, binding.sourceId));
					removedReferences.set(binding.locatorId, binding.locatorRevision);
				}
				cursor.continue();
			} catch (error) { reject(error); }
		};
	});
}

function addInventoryReference(
	references: Map<string, string>,
	binding: LinkedVideoOriginalBinding | LinkedOriginalBinding,
	maximumReferences: number,
): void {
	const current = references.get(binding.locatorId);
	if (current !== undefined && current !== binding.locatorRevision) {
		throw new Error('Linked video project binding inventory contains conflicting locator revisions.');
	}
	references.set(binding.locatorId, binding.locatorRevision);
	if (references.size > maximumReferences) {
		throw new RangeError('Linked video project binding inventory exceeds its reference limit.');
	}
}

function applyMemoryBindingDeletions(records: Map<string, unknown>, keys: readonly string[]): void {
	const removed: Array<readonly [string, unknown]> = [];
	try {
		for (const key of keys) {
			if (!records.has(key)) throw new Error('A planned linked video binding disappeared before deletion.');
			const value = records.get(key);
			removed.push([key, value]);
			if (!records.delete(key)) throw new Error('Could not delete a planned linked video binding.');
		}
	} catch (primary) {
		const rollbackErrors: unknown[] = [];
		for (const [key, value] of removed.reverse()) {
			try { records.set(key, value); } catch (error) { rollbackErrors.push(error); }
		}
		if (rollbackErrors.length) {
			throw new AggregateError([primary, ...rollbackErrors], 'Linked video binding deletion and rollback failed.');
		}
		throw primary;
	}
}

function frozenResult(
	durable: ReadonlySet<string>,
	removed: ReadonlyMap<string, string>,
): LinkedVideoOriginalProjectBindingPruneResult {
	const durableVideoSourceIds = Object.freeze([...durable].sort((left, right) => left.localeCompare(right)));
	const removedLocatorReferences = Object.freeze([...removed]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([locatorId, locatorRevision]) => Object.freeze({ locatorId, locatorRevision })));
	return Object.freeze({ durableVideoSourceIds, removedLocatorReferences });
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
