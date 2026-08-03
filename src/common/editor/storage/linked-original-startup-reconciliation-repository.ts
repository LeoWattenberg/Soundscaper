/* SPDX-License-Identifier: AGPL-3.0-only */

import { validateAudioEditorProjectV9, type AudioEditorProjectV9 } from '../project-v9-validation.ts';
import { collectProjectSourceIds } from '../retention.js';
import { request, transact } from './indexeddb-backend.ts';
import type { LinkedOriginalBinding, LinkedOriginalKind } from './linked-original-binding.ts';
import { validateLinkedOriginalInventoryBinding } from './linked-original-repository-inventory.ts';
import {
	MAX_LINKED_ORIGINAL_CANONICAL_PROJECTS,
	MAX_LINKED_ORIGINAL_INVENTORY_RECORDS,
	MAX_LINKED_ORIGINAL_INVENTORY_REFERENCES,
	type LinkedOriginalLocatorReference,
} from './linked-original-repository.ts';
import {
	MAX_LINKED_ORIGINAL_PROJECT_REACHABILITY_ROOTS,
	MAX_LINKED_ORIGINAL_PROJECT_REVISIONS,
} from './linked-original-project-reachability-repository.ts';
import { LINKED_ORIGINAL_STORE_NAME, linkedOriginalBindingKey } from './linked-original-schema.ts';
import type { LinkedVideoOriginalLocatorReference } from './linked-video-original-repository.ts';
import type { StorageRepositoryPort } from './repository-port.ts';

export interface LinkedOriginalCatalogProjectRevision {
	readonly id: string;
	/** Null keeps a catalog-live legacy local project source-unverifiable. */
	readonly revision: number | null;
}

export interface LinkedOriginalStartupReconciliationRepositoryOptions {
	readonly maximumCatalogProjects?: number;
	readonly maximumRetainedRevisions?: number;
	readonly maximumRoots?: number;
	readonly maximumInventoryRecords?: number;
	readonly maximumInventoryReferences?: number;
}

interface BindingRow {
	readonly key: string;
	readonly binding: LinkedOriginalBinding;
}

interface ReconciliationPlan {
	readonly deletionKeys: readonly string[];
	readonly references: readonly LinkedOriginalLocatorReference[];
}

interface StoredProjectRevision {
	readonly key: string;
	readonly projectId: string;
	readonly revision: number;
	readonly project: AudioEditorProjectV9;
}

const REVISION_RECORD_FIELDS = new Set(['key', 'projectId', 'revision', 'project', 'creationFence']);
const ROOT_LIMIT_EXCEEDED = Symbol('linked-original-startup-root-limit');
type ProjectRoots = ReadonlySet<string> | null | typeof ROOT_LIMIT_EXCEEDED;

class StartupRootLimitError extends Error {}

/** Atomically turn an authoritative catalog plus exact local graphs into surviving locator references. */
export class LinkedOriginalStartupReconciliationRepository {
	readonly #port: StorageRepositoryPort;
	readonly #maximumCatalogProjects: number;
	readonly #maximumRetainedRevisions: number;
	readonly #maximumRoots: number;
	readonly #maximumInventoryRecords: number;
	readonly #maximumInventoryReferences: number;

	constructor(
		port: StorageRepositoryPort,
		options: LinkedOriginalStartupReconciliationRepositoryOptions = {},
	) {
		if (!port || typeof port.database !== 'function' || !port.memory) {
			throw new TypeError('A linked-original startup reconciliation storage port is required.');
		}
		this.#port = port;
		this.#maximumCatalogProjects = boundedLimit(
			options.maximumCatalogProjects ?? MAX_LINKED_ORIGINAL_CANONICAL_PROJECTS,
			MAX_LINKED_ORIGINAL_CANONICAL_PROJECTS,
			'catalog project',
		);
		this.#maximumRetainedRevisions = boundedLimit(
			options.maximumRetainedRevisions ?? MAX_LINKED_ORIGINAL_PROJECT_REVISIONS,
			MAX_LINKED_ORIGINAL_PROJECT_REVISIONS,
			'retained revision',
		);
		this.#maximumRoots = boundedLimit(
			options.maximumRoots ?? MAX_LINKED_ORIGINAL_PROJECT_REACHABILITY_ROOTS,
			MAX_LINKED_ORIGINAL_PROJECT_REACHABILITY_ROOTS,
			'reachability root',
		);
		this.#maximumInventoryRecords = boundedLimit(
			options.maximumInventoryRecords ?? MAX_LINKED_ORIGINAL_INVENTORY_RECORDS,
			MAX_LINKED_ORIGINAL_INVENTORY_RECORDS,
			'binding inventory record',
		);
		this.#maximumInventoryReferences = boundedLimit(
			options.maximumInventoryReferences ?? MAX_LINKED_ORIGINAL_INVENTORY_REFERENCES,
			MAX_LINKED_ORIGINAL_INVENTORY_REFERENCES,
			'locator reference',
		);
	}

	reconcileDurableLocatorReferences(
		catalogValue: readonly LinkedOriginalCatalogProjectRevision[],
	): Promise<readonly LinkedOriginalLocatorReference[] | null> {
		return this.#reconcile(catalogValue, new Set<LinkedOriginalKind>(['audio', 'video']));
	}

	async reconcileDurableVideoLocatorReferences(
		catalogValue: readonly LinkedOriginalCatalogProjectRevision[],
	): Promise<readonly LinkedVideoOriginalLocatorReference[] | null> {
		const references = await this.#reconcile(catalogValue, new Set<LinkedOriginalKind>(['video']));
		return references && Object.freeze(references.map(({ locatorId, locatorRevision }) => Object.freeze({
			locatorId,
			locatorRevision,
		})));
	}

	async #reconcile(
		catalogValue: readonly LinkedOriginalCatalogProjectRevision[],
		managedKinds: ReadonlySet<LinkedOriginalKind>,
	): Promise<readonly LinkedOriginalLocatorReference[] | null> {
		const catalog = catalogRevisions(catalogValue, this.#maximumCatalogProjects);
		const database = await this.#port.database();
		if (!database) return null;
		return transact(database, ['projects', 'revisions', LINKED_ORIGINAL_STORE_NAME], 'readwrite', async (stores) => {
			const rows = await readBindingRows(
				stores[LINKED_ORIGINAL_STORE_NAME],
				this.#maximumInventoryRecords,
			);
			const liveOwners = new Set(rows
				.filter(({ binding }) => managedKinds.has(binding.kind) && catalog.has(binding.projectId))
				.map(({ binding }) => binding.projectId));
			const roots = new Map<string, ReadonlySet<string> | null>();
			let aggregateRoots = 0;
			let aggregateVerifiable = true;
			for (const projectId of [...liveOwners].sort()) {
				const catalogRevision = catalog.get(projectId);
				const projectRoots = catalogRevision === null
					? null
					: await exactProjectRoots(
						stores.projects,
						stores.revisions.index('projectId'),
						projectId,
						catalogRevision as number,
						this.#maximumRetainedRevisions,
						this.#maximumRoots - aggregateRoots,
					);
				if (projectRoots === ROOT_LIMIT_EXCEEDED) {
					aggregateVerifiable = false;
					break;
				}
				roots.set(projectId, projectRoots);
				if (projectRoots) {
					aggregateRoots += projectRoots.size;
				}
			}
			const plan = reconciliationPlan(
				rows,
				catalog,
				aggregateVerifiable ? roots : new Map(),
				managedKinds,
				this.#maximumInventoryReferences,
			);
			await Promise.all(plan.deletionKeys.map((key) => request(
				stores[LINKED_ORIGINAL_STORE_NAME].delete(key),
			)));
			return plan.references;
		});
	}
}

function catalogRevisions(
	value: unknown,
	maximumProjects: number,
): ReadonlyMap<string, number | null> {
	if (!Array.isArray(value) || value.length > maximumProjects) {
		throw new RangeError('Linked-original startup catalog exceeds its project limit.');
	}
	const catalog = new Map<string, number | null>();
	for (const candidate of value) {
		if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
			throw new TypeError('A linked-original startup catalog summary is required.');
		}
		assertPlainObject(candidate, 'catalog summary');
		const keys = Reflect.ownKeys(candidate);
		if (keys.length !== 2 || keys.some((key) => key !== 'id' && key !== 'revision')) {
			throw new TypeError('A linked-original startup catalog summary contains an unsupported field.');
		}
		const id = dataField(candidate, 'id', 'catalog summary');
		const revision = dataField(candidate, 'revision', 'catalog summary');
		linkedOriginalBindingKey(id as string, 'startup-catalog-validation');
		if (revision !== null && (!Number.isSafeInteger(revision) || Number(revision) < 0)) {
			throw new TypeError('A linked-original startup catalog revision must be a non-negative safe integer.');
		}
		if (catalog.has(id as string)) {
			throw new Error('Linked-original startup catalog contains duplicate project identities.');
		}
		catalog.set(id as string, revision === null ? null : Number(revision));
	}
	return catalog;
}

function readBindingRows(store: IDBObjectStore, maximumRecords: number): Promise<readonly BindingRow[]> {
	return new Promise((resolve, reject) => {
		const rows: BindingRow[] = [];
		let cursorRequest: IDBRequest<IDBCursorWithValue | null>;
		try { cursorRequest = store.openCursor(); } catch (error) { reject(error); return; }
		cursorRequest.onerror = () => reject(
			cursorRequest.error || new Error('Could not enumerate startup linked-original bindings.'),
		);
		cursorRequest.onsuccess = () => {
			const cursor = cursorRequest.result;
			if (!cursor) { resolve(Object.freeze(rows)); return; }
			try {
				if (rows.length >= maximumRecords) {
					throw new RangeError('Linked-original startup binding inventory exceeds its record limit.');
				}
				const binding = validateLinkedOriginalInventoryBinding(cursor.value, cursor.primaryKey);
				rows.push(Object.freeze({
					key: linkedOriginalBindingKey(binding.projectId, binding.sourceId),
					binding,
				}));
				cursor.continue();
			} catch (error) { reject(error); }
		};
	});
}

async function exactProjectRoots(
	projects: IDBObjectStore,
	revisions: IDBIndex,
	projectId: string,
	catalogRevision: number,
	maximumRetainedRevisions: number,
	maximumRoots: number,
): Promise<ProjectRoots> {
	let current: AudioEditorProjectV9;
	const roots = new Set<string>();
	try {
		const value = await request(projects.get(projectId));
		if (!validateAudioEditorProjectV9(value) || value.id !== projectId
			|| value.revision !== catalogRevision) return null;
		current = value;
		collectRoots(current, roots, maximumRoots);
	} catch (error) {
		return error instanceof StartupRootLimitError ? ROOT_LIMIT_EXCEEDED : null;
	}
	return retainedProjectRoots(
		revisions,
		projectId,
		current.revision,
		roots,
		maximumRetainedRevisions,
		maximumRoots,
	);
}

function retainedProjectRoots(
	index: IDBIndex,
	projectId: string,
	currentRevision: number,
	roots: Set<string>,
	maximumRetainedRevisions: number,
	maximumRoots: number,
): Promise<ProjectRoots> {
	return new Promise((resolve, reject) => {
		let count = 0;
		let matchesCurrent = false;
		let cursorRequest: IDBRequest<IDBCursorWithValue | null>;
		try { cursorRequest = index.openCursor(projectId); } catch (error) { reject(error); return; }
		cursorRequest.onerror = () => reject(
			cursorRequest.error || new Error('Could not enumerate startup project revisions.'),
		);
		cursorRequest.onsuccess = () => {
			const cursor = cursorRequest.result;
			if (!cursor) {
				resolve(count > 0 && matchesCurrent ? new Set(roots) : null);
				return;
			}
			try {
				count += 1;
				if (count > maximumRetainedRevisions) { resolve(null); return; }
				const revision = storedProjectRevision(cursor.value, cursor.primaryKey, projectId);
				collectRoots(revision.project, roots, maximumRoots);
				if (revision.revision === currentRevision) matchesCurrent = true;
				cursor.continue();
			} catch (error) {
				resolve(error instanceof StartupRootLimitError ? ROOT_LIMIT_EXCEEDED : null);
			}
		};
	});
}

function storedProjectRevision(
	value: unknown,
	primaryKey: IDBValidKey,
	projectId: string,
): StoredProjectRevision {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A startup project revision must be an object.');
	}
	assertPlainObject(value, 'project revision');
	const keys = Reflect.ownKeys(value);
	if (keys.length < 4 || keys.length > 5
		|| keys.some((key) => typeof key !== 'string' || !REVISION_RECORD_FIELDS.has(key))) {
		throw new TypeError('A startup project revision contains an unsupported field.');
	}
	const key = dataField(value, 'key', 'project revision');
	const owner = dataField(value, 'projectId', 'project revision');
	const revisionValue = dataField(value, 'revision', 'project revision');
	const project = dataField(value, 'project', 'project revision');
	if (typeof key !== 'string' || key !== primaryKey || owner !== projectId
		|| !Number.isSafeInteger(revisionValue) || Number(revisionValue) < 0
		|| key !== revisionKey(projectId, Number(revisionValue))) {
		throw new Error('A startup project revision does not match its authoritative key.');
	}
	if (Object.hasOwn(value, 'creationFence')
		&& typeof dataField(value, 'creationFence', 'project revision') !== 'string') {
		throw new TypeError('A startup project revision creation fence must be a string.');
	}
	if (!validateAudioEditorProjectV9(project) || project.id !== projectId
		|| project.revision !== revisionValue) {
		throw new Error('A startup project revision document does not match its identity.');
	}
	return { key, projectId, revision: Number(revisionValue), project };
}

function collectRoots(
	project: AudioEditorProjectV9,
	roots: Set<string>,
	maximumRoots: number,
): void {
	const sources = new Map(project.sources.map((source) => [String(source.id), source]));
	for (const sourceId of collectProjectSourceIds(project) as Set<string>) {
		const source = sources.get(sourceId);
		if (source?.kind !== 'audio' && source?.kind !== 'video') continue;
		linkedOriginalBindingKey(project.id, sourceId);
		roots.add(sourceReferenceKey(source.kind, sourceId));
		if (roots.size > maximumRoots) {
			throw new StartupRootLimitError('Linked-original startup project roots exceed their limit.');
		}
	}
}

function reconciliationPlan(
	rows: readonly BindingRow[],
	catalog: ReadonlyMap<string, number | null>,
	roots: ReadonlyMap<string, ReadonlySet<string> | null>,
	managedKinds: ReadonlySet<LinkedOriginalKind>,
	maximumReferences: number,
): ReconciliationPlan {
	const aliases = new Map<string, string>();
	const inventoryReferences = new Map<string, LinkedOriginalLocatorReference>();
	for (const { binding } of rows) {
		assertStorageAlias(aliases, binding);
		if (managedKinds.has(binding.kind)) {
			addReference(inventoryReferences, binding, maximumReferences);
		}
	}
	const survivorReferences = new Map<string, LinkedOriginalLocatorReference>();
	const deletionKeys: string[] = [];
	for (const { key, binding } of rows) {
		if (!managedKinds.has(binding.kind)) continue;
		const projectRoots = roots.get(binding.projectId);
		const deleteBinding = !catalog.has(binding.projectId)
			|| (projectRoots !== undefined && projectRoots !== null
				&& !projectRoots.has(sourceReferenceKey(binding.kind, binding.sourceId)));
		if (deleteBinding) {
			deletionKeys.push(key);
			continue;
		}
		const referenceKey = locatorReferenceKey(binding.kind, binding.locatorId);
		survivorReferences.set(referenceKey, inventoryReferences.get(referenceKey) as LinkedOriginalLocatorReference);
	}
	return Object.freeze({
		deletionKeys: Object.freeze(deletionKeys),
		references: Object.freeze([...survivorReferences.values()].sort((left, right) => (
			left.kind.localeCompare(right.kind) || left.locatorId.localeCompare(right.locatorId)
		))),
	});
}

function assertStorageAlias(aliases: Map<string, string>, binding: LinkedOriginalBinding): void {
	const identity = JSON.stringify([
		binding.kind, binding.storageKey, binding.locatorId, binding.locatorRevision,
		binding.mimeType, binding.byteLength, binding.sha256, binding.sourceShape,
	]);
	const current = aliases.get(binding.storageKey);
	if (current !== undefined && current !== identity) {
		throw new Error('Linked-original startup storage aliases conflict in identity.');
	}
	aliases.set(binding.storageKey, identity);
}

function addReference(
	references: Map<string, LinkedOriginalLocatorReference>,
	binding: LinkedOriginalBinding,
	maximumReferences: number,
): void {
	const key = locatorReferenceKey(binding.kind, binding.locatorId);
	const current = references.get(key);
	if (current && current.locatorRevision !== binding.locatorRevision) {
		throw new Error('Linked-original startup bindings contain conflicting locator revisions.');
	}
	references.set(key, Object.freeze({
		kind: binding.kind,
		locatorId: binding.locatorId,
		locatorRevision: binding.locatorRevision,
	}));
	if (references.size > maximumReferences) {
		throw new RangeError('Linked-original startup inventory exceeds its locator-reference limit.');
	}
}

function dataField(value: object, field: string, label: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, field);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`Linked-original startup ${label} ${field} must be an enumerable data field.`);
	}
	return descriptor.value;
}

function assertPlainObject(value: object, label: string): void {
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`Linked-original startup ${label} must be a plain object.`);
	}
}

function sourceReferenceKey(kind: LinkedOriginalKind, sourceId: string): string {
	return JSON.stringify([kind, sourceId]);
}

function locatorReferenceKey(kind: LinkedOriginalKind, locatorId: string): string {
	return JSON.stringify([kind, locatorId]);
}

function revisionKey(projectId: string, revision: number): string {
	return `${projectId}:${String(revision).padStart(12, '0')}`;
}

function boundedLimit(value: unknown, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) {
		throw new RangeError(`Linked-original startup ${label} limit is invalid.`);
	}
	return Number(value);
}
