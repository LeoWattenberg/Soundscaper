/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	collectProjectStorageKeys,
	compactProjectSourceMetadata,
} from '../retention.js';
import {
	deleteByIndex,
	request,
	transact,
	transactionCompletion,
} from './indexeddb-backend.ts';
import {
	LINKED_VIDEO_ORIGINAL_PROJECT_INDEX_NAME,
	LINKED_VIDEO_ORIGINAL_STORE_NAME,
} from './linked-video-original-schema.ts';
import { publishSource } from './media-records.ts';
import type { StorageRepositoryPort } from './repository-port.ts';

export interface ProjectDocument {
	readonly id: string;
	readonly revision?: number;
	readonly updatedAt?: unknown;
	readonly [field: string]: unknown;
}

export interface ProjectRevision {
	readonly revision: number;
	readonly project: ProjectDocument;
}

interface ProjectRevisionRecord {
	readonly key: string;
	readonly projectId: string;
	readonly revision: number;
	readonly project: ProjectDocument;
	readonly creationFence?: string;
}

export interface ProjectLoadOptions {
	readonly revision?: number;
	readonly signal?: AbortSignal;
}

export type ProjectPostCommitMaintenance = () => PromiseLike<void> | void;

/** Structural project seam implemented by local and desktop-shared repositories. */
export interface ProjectRepositoryPort {
	createIfAbsent?(project: ProjectDocument): Promise<ProjectDocument | null>;
	save(project: ProjectDocument, postCommit?: ProjectPostCommitMaintenance): Promise<ProjectDocument>;
	load(projectId: string, options?: ProjectLoadOptions): Promise<ProjectDocument | null>;
	list(): Promise<ProjectDocument[]>;
	listRevisions(projectId: string): Promise<ProjectRevision[]>;
	deleteIfCurrent?(project: ProjectDocument): Promise<boolean>;
	delete(projectId: string): Promise<void>;
}

/** Durable project snapshots and their bounded revision history. */
export class ProjectRepository implements ProjectRepositoryPort {
	readonly #creationFences = new WeakMap<object, string>();
	readonly #port: StorageRepositoryPort;
	readonly #revisionLimit: number;

	constructor(port: StorageRepositoryPort, revisionLimit: number) {
		this.#port = port;
		this.#revisionLimit = Math.max(2, Math.floor(revisionLimit));
	}

	async createIfAbsent(project: ProjectDocument): Promise<ProjectDocument | null> {
		const creationFence = createProjectCreationFence();
		const { snapshot, revisionRecord } = projectPublication(project, creationFence);
		const database = await this.#port.database();
		if (!database) {
			const memory = this.#port.memory;
			if (memory.projects.has(snapshot.id)
				|| memory.revisions.has(revisionRecord.key)
				|| memoryHasProjectRevision(memory.revisions, snapshot.id)) {
				return null;
			}
			const mutations: MemoryMutation[] = [
				setMemoryMutation(memory.projects, snapshot.id, snapshot),
				setMemoryMutation(memory.revisions, revisionRecord.key, revisionRecord),
			];
			applyMemoryMutations(mutations);
			return this.#rememberCreation(snapshot, creationFence);
		}

		const created = await transact(database, ['projects', 'revisions'], 'readwrite', async ({
			projects,
			revisions,
		}) => {
			const [current, currentRevision, revisionCount] = await Promise.all([
				request(projects.get(snapshot.id)),
				request(revisions.get(revisionRecord.key)),
				request(revisions.index('projectId').count(snapshot.id)),
			]);
			if (current !== undefined || currentRevision !== undefined || revisionCount > 0) return false;
			await Promise.all([
				request(projects.put(snapshot)),
				request(revisions.put(revisionRecord)),
			]);
			return true;
		});
		return created ? this.#rememberCreation(snapshot, creationFence) : null;
	}

	async save(
		project: ProjectDocument,
		postCommit?: ProjectPostCommitMaintenance,
	): Promise<ProjectDocument> {
		if (!project || typeof project.id !== 'string' || !project.id) {
			throw new Error('A project with a stable string id is required.');
		}
		if (postCommit !== undefined && typeof postCommit !== 'function') {
			throw new TypeError('Project post-commit maintenance must be a function.');
		}
		const snapshot = compactProjectSourceMetadata(clone(project)) as ProjectDocument;
		const revision = nonNegativeInteger(snapshot.revision, 0);
		const revisionRecord: ProjectRevisionRecord = {
			key: revisionKey(snapshot.id, revision),
			projectId: snapshot.id,
			revision,
			project: snapshot,
		};
		const database = await this.#port.database();
		if (!database) {
			this.#port.memory.projects.set(snapshot.id, snapshot);
			this.#port.memory.revisions.set(revisionRecord.key, revisionRecord);
			for (const sourceId of collectProjectStorageKeys(snapshot)) {
				const source = asRecord(this.#port.memory.sources.get(sourceId));
				if (source?.pendingProjectUntil) this.#port.memory.sources.set(sourceId, publishSource(source));
				const mediaAsset = asRecord(this.#port.memory.mediaAssets.get(sourceId));
				if (mediaAsset?.pendingProjectUntil) this.#port.memory.mediaAssets.set(sourceId, publishSource(mediaAsset));
			}
			await this.#pruneRevisions(snapshot.id);
			await postCommit?.();
			return clone(snapshot);
		}

		await transact(database, ['projects', 'revisions', 'sources', 'mediaAssets'], 'readwrite', async ({
			projects,
			revisions,
			sources,
			mediaAssets,
		}) => {
			projects.put(snapshot);
			revisions.put(revisionRecord);
			for (const sourceId of collectProjectStorageKeys(snapshot)) {
				const source = asRecord(await request(sources.get(sourceId)));
				if (source?.pendingProjectUntil) sources.put(publishSource(source));
				const mediaAsset = asRecord(await request(mediaAssets.get(sourceId)));
				if (mediaAsset?.pendingProjectUntil) mediaAssets.put(publishSource(mediaAsset));
			}
		});
		await this.#pruneRevisions(snapshot.id);
		await postCommit?.();
		return clone(snapshot);
	}

	async load(
		projectId: string,
		{ revision, signal }: ProjectLoadOptions = {},
	): Promise<ProjectDocument | null> {
		throwIfProjectLoadAborted(signal);
		const database = await raceProjectLoad(() => this.#port.database(), signal);
		throwIfProjectLoadAborted(signal);
		if (!database) {
			const value = revision === undefined
				? this.#port.memory.projects.get(projectId)
				: asRevision(this.#port.memory.revisions.get(revisionKey(projectId, revision)))?.project;
			throwIfProjectLoadAborted(signal);
			return value ? clone(compactProjectSourceMetadata(value) as ProjectDocument) : null;
		}

		const storeName = revision === undefined ? 'projects' : 'revisions';
		const key = revision === undefined ? projectId : revisionKey(projectId, revision);
		const value = await readProjectRecord(database, storeName, key, signal);
		throwIfProjectLoadAborted(signal);
		if (!value) return null;
		const record = value as ProjectDocument | ProjectRevisionRecord;
		const project = 'project' in record ? record.project : record;
		return clone(compactProjectSourceMetadata(project) as ProjectDocument);
	}

	async list(): Promise<ProjectDocument[]> {
		const database = await this.#port.database();
		const projects = !database
			? [...this.#port.memory.projects.values()]
			: await transact(database, 'projects', 'readonly', ({ projects }) => request(projects.getAll()));
		return projects
			.map((project) => clone(compactProjectSourceMetadata(project) as ProjectDocument))
			.sort(sortProjects);
	}

	async listRevisions(projectId: string): Promise<ProjectRevision[]> {
		const database = await this.#port.database();
		const records = !database
			? [...this.#port.memory.revisions.values()].map(asRevision).filter(isRevisionFor(projectId))
			: await transact(database, 'revisions', 'readonly', ({ revisions }) => (
				request(revisions.index('projectId').getAll(projectId)) as Promise<ProjectRevisionRecord[]>
			));
		return records.sort((left, right) => right.revision - left.revision).map((record) => ({
			revision: record.revision,
			project: clone(compactProjectSourceMetadata(record.project) as ProjectDocument),
		}));
	}

	async deleteIfCurrent(project: ProjectDocument): Promise<boolean> {
		const { snapshot, revisionRecord } = projectPublication(project);
		const creationFence = this.#creationFences.get(project as object);
		if (!creationFence) return false;
		const database = await this.#port.database();
		if (!database) {
			const memory = this.#port.memory;
			if (!sameProjectSnapshot(memory.projects.get(snapshot.id), snapshot)
				|| storedCreationFence(memory.revisions.get(revisionRecord.key)) !== creationFence) return false;
			const mutations: MemoryMutation[] = [deleteMemoryMutation(memory.projects, snapshot.id)];
			for (const [key, value] of memory.revisions) {
				if (storedProjectId(value) === snapshot.id) {
					mutations.push(deleteMemoryMutation(memory.revisions, key));
				}
			}
			applyMemoryMutations(mutations);
			this.#creationFences.delete(project as object);
			return true;
		}
		const deleted = await transact(database, ['projects', 'revisions'], 'readwrite', async ({
			projects,
			revisions,
		}) => {
			const [current, currentRevision] = await Promise.all([
				request(projects.get(snapshot.id)),
				request(revisions.get(revisionRecord.key)),
			]);
			if (!sameProjectSnapshot(current, snapshot)
				|| storedCreationFence(currentRevision) !== creationFence) return false;
			await Promise.all([
				request(projects.delete(snapshot.id)),
				deleteByIndex(revisions.index('projectId'), snapshot.id),
			]);
			return true;
		});
		if (deleted) this.#creationFences.delete(project as object);
		return deleted;
	}

	#rememberCreation(snapshot: ProjectDocument, creationFence: string): ProjectDocument {
		const created = clone(snapshot);
		this.#creationFences.set(created, creationFence);
		return created;
	}

	async delete(projectId: string): Promise<void> {
		const database = await this.#port.database();
		if (!database) {
			this.#port.memory.projects.delete(projectId);
			for (const [key, value] of this.#port.memory.revisions) {
				if (asRevision(value)?.projectId === projectId) this.#port.memory.revisions.delete(key);
			}
			for (const [key, value] of this.#port.memory.linkedVideoOriginalBindings) {
				if (storedProjectId(value) === projectId) {
					this.#port.memory.linkedVideoOriginalBindings.delete(key);
				}
			}
			return;
		}
		await transact(database, [
			'projects',
			'revisions',
			LINKED_VIDEO_ORIGINAL_STORE_NAME,
		], 'readwrite', async (stores) => {
			const { projects, revisions } = stores;
			projects.delete(projectId);
			await deleteByIndex(revisions.index('projectId'), projectId);
			await deleteByIndex(
				stores[LINKED_VIDEO_ORIGINAL_STORE_NAME].index(LINKED_VIDEO_ORIGINAL_PROJECT_INDEX_NAME),
				projectId,
			);
		});
	}

	async #pruneRevisions(projectId: string): Promise<void> {
		const database = await this.#port.database();
		const records = !database
			? [...this.#port.memory.revisions.values()].map(asRevision).filter(isRevisionFor(projectId))
			: await transact(database, 'revisions', 'readonly', ({ revisions }) => (
				request(revisions.index('projectId').getAll(projectId)) as Promise<ProjectRevisionRecord[]>
			));
		records.sort((left, right) => right.revision - left.revision);
		if (records.length <= this.#revisionLimit) return;
		if (!database) {
			for (const record of records.slice(this.#revisionLimit)) this.#port.memory.revisions.delete(record.key);
			return;
		}
		await transact(database, 'revisions', 'readwrite', ({ revisions }) => {
			for (const record of records.slice(this.#revisionLimit)) revisions.delete(record.key);
		});
	}
}

interface ProjectPublication {
	readonly snapshot: ProjectDocument;
	readonly revisionRecord: ProjectRevisionRecord;
}

interface MemoryMutation {
	readonly map: Map<string, unknown>;
	readonly key: string;
	readonly operation: 'set' | 'delete';
	readonly value?: unknown;
	readonly prior: unknown;
	readonly hadPrior: boolean;
}

function projectPublication(
	project: ProjectDocument,
	creationFence?: string,
): ProjectPublication {
	if (!project || typeof project.id !== 'string' || !project.id) {
		throw new Error('A project with a stable string id is required.');
	}
	const snapshot = compactProjectSourceMetadata(clone(project)) as ProjectDocument;
	const revision = nonNegativeInteger(snapshot.revision, 0);
	return {
		snapshot,
		revisionRecord: {
			key: revisionKey(snapshot.id, revision),
			projectId: snapshot.id,
			revision,
			project: snapshot,
			...(creationFence ? { creationFence } : {}),
		},
	};
}

function memoryHasProjectRevision(revisions: ReadonlyMap<string, unknown>, projectId: string): boolean {
	for (const value of revisions.values()) {
		if (storedProjectId(value) === projectId) return true;
	}
	return false;
}

function setMemoryMutation(
	map: Map<string, unknown>,
	key: string,
	value: unknown,
): MemoryMutation {
	return { map, key, operation: 'set', value, prior: map.get(key), hadPrior: map.has(key) };
}

function deleteMemoryMutation(map: Map<string, unknown>, key: string): MemoryMutation {
	return { map, key, operation: 'delete', prior: map.get(key), hadPrior: map.has(key) };
}

function applyMemoryMutations(mutations: readonly MemoryMutation[]): void {
	const attempted: MemoryMutation[] = [];
	try {
		for (const mutation of mutations) {
			attempted.push(mutation);
			if (mutation.operation === 'set') mutation.map.set(mutation.key, mutation.value);
			else mutation.map.delete(mutation.key);
		}
	} catch (primary) {
		const rollbackErrors: unknown[] = [];
		for (const mutation of attempted.reverse()) {
			try {
				if (mutation.hadPrior) mutation.map.set(mutation.key, mutation.prior);
				else mutation.map.delete(mutation.key);
			} catch (error) { rollbackErrors.push(error); }
		}
		if (rollbackErrors.length) {
			throw new AggregateError(
				[primary, ...rollbackErrors],
				'Memory project mutation and rollback both failed.',
			);
		}
		throw primary;
	}
}

function sameProjectSnapshot(left: unknown, right: unknown): boolean {
	return sameSnapshotValue(left, right, new Map<object, object>());
}

function sameSnapshotValue(
	left: unknown,
	right: unknown,
	seen: Map<object, object>,
): boolean {
	if (Object.is(left, right)) return true;
	if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
	if (left instanceof Date || right instanceof Date) {
		return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
	}
	if (left instanceof ArrayBuffer || right instanceof ArrayBuffer) {
		return left instanceof ArrayBuffer && right instanceof ArrayBuffer
			&& sameBytes(new Uint8Array(left), new Uint8Array(right));
	}
	if (ArrayBuffer.isView(left) || ArrayBuffer.isView(right)) {
		return ArrayBuffer.isView(left) && ArrayBuffer.isView(right)
			&& left.constructor === right.constructor
			&& sameBytes(
				new Uint8Array(left.buffer, left.byteOffset, left.byteLength),
				new Uint8Array(right.buffer, right.byteOffset, right.byteLength),
			);
	}
	if (Array.isArray(left) !== Array.isArray(right)) return false;
	if (!Array.isArray(left)) {
		const leftPrototype = Object.getPrototypeOf(left) as unknown;
		const rightPrototype = Object.getPrototypeOf(right) as unknown;
		if (leftPrototype !== rightPrototype
			|| leftPrototype !== Object.prototype && leftPrototype !== null) return false;
	}
	const prior = seen.get(left);
	if (prior) return prior === right;
	seen.set(left, right);
	const leftKeys = Reflect.ownKeys(left);
	const rightKeys = Reflect.ownKeys(right);
	if (leftKeys.length !== rightKeys.length || leftKeys.some((key) => !rightKeys.includes(key))) return false;
	for (const key of leftKeys) {
		const leftDescriptor = Object.getOwnPropertyDescriptor(left, key);
		const rightDescriptor = Object.getOwnPropertyDescriptor(right, key);
		if (!leftDescriptor || !rightDescriptor
			|| !Object.hasOwn(leftDescriptor, 'value') || !Object.hasOwn(rightDescriptor, 'value')
			|| leftDescriptor.enumerable !== rightDescriptor.enumerable
			|| !sameSnapshotValue(leftDescriptor.value, rightDescriptor.value, seen)) return false;
	}
	return true;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
	if (left.byteLength !== right.byteLength) return false;
	for (let index = 0; index < left.byteLength; index += 1) {
		if (left[index] !== right[index]) return false;
	}
	return true;
}

async function readProjectRecord(
	database: IDBDatabase,
	storeName: 'projects' | 'revisions',
	key: string,
	signal?: AbortSignal,
): Promise<unknown> {
	throwIfProjectLoadAborted(signal);
	const transaction = database.transaction(storeName, 'readonly');
	const completion = transactionCompletion(transaction).then(
		() => ({ status: 'fulfilled' as const }),
		(reason: unknown) => ({ status: 'rejected' as const, reason }),
	);
	const abortTransaction = (): void => {
		try { transaction.abort(); } catch { /* The transaction may already be inactive. */ }
	};
	if (signal) signal.addEventListener('abort', abortTransaction, { once: true });
	if (signal?.aborted) abortTransaction();
	let read: Promise<unknown> | null = null;
	try {
		throwIfProjectLoadAborted(signal);
		read = request(transaction.objectStore(storeName).get(key));
		const value = await read;
		const completed = await completion;
		if (completed.status === 'rejected') throw completed.reason;
		throwIfProjectLoadAborted(signal);
		return value;
	} catch (error) {
		abortTransaction();
		if (read) await Promise.allSettled([read, completion]);
		else await completion;
		throwIfProjectLoadAborted(signal);
		throw error;
	} finally {
		signal?.removeEventListener('abort', abortTransaction);
	}
}

function raceProjectLoad<Value>(
	read: () => PromiseLike<Value> | Value,
	signal?: AbortSignal,
): Promise<Value> {
	if (!signal) return Promise.resolve().then(read);
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise<Value>((resolve, reject) => {
		let settled = false;
		const finish = (complete: () => void): void => {
			if (settled) return;
			settled = true;
			signal.removeEventListener('abort', onAbort);
			complete();
		};
		const onAbort = (): void => finish(() => reject(signal.reason));
		signal.addEventListener('abort', onAbort, { once: true });
		if (signal.aborted) {
			onAbort();
			return;
		}
		let operation: PromiseLike<Value> | Value;
		try {
			operation = read();
		} catch (error) {
			finish(() => reject(error));
			return;
		}
		void Promise.resolve(operation).then(
			(value) => finish(() => resolve(value)),
			(error: unknown) => finish(() => reject(error)),
		);
	});
}

function throwIfProjectLoadAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw signal.reason;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function storedProjectId(value: unknown): unknown {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const descriptor = Object.getOwnPropertyDescriptor(value, 'projectId');
	return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
}

function storedCreationFence(value: unknown): string | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const descriptor = Object.getOwnPropertyDescriptor(value, 'creationFence');
	return descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string'
		? descriptor.value
		: null;
}

function asRevision(value: unknown): ProjectRevisionRecord | null {
	const record = asRecord(value);
	if (!record || typeof record.key !== 'string' || typeof record.projectId !== 'string') return null;
	if (typeof record.revision !== 'number' || !record.project || typeof record.project !== 'object') return null;
	return record as unknown as ProjectRevisionRecord;
}

function isRevisionFor(projectId: string): (record: ProjectRevisionRecord | null) => record is ProjectRevisionRecord {
	return (record): record is ProjectRevisionRecord => record?.projectId === projectId;
}

function clone<Value>(value: Value): Value {
	if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
	return JSON.parse(JSON.stringify(value)) as Value;
}

function createProjectCreationFence(): string {
	const uuid = globalThis.crypto?.randomUUID?.();
	if (!uuid) throw new Error('Secure random generation is required for create-only project storage.');
	return `project_creation_${uuid.replaceAll('-', '')}`;
}

function revisionKey(projectId: string, revision: number): string {
	return `${projectId}:${String(nonNegativeInteger(revision, 0)).padStart(12, '0')}`;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
	return Number.isFinite(value) && Number(value) >= 0 ? Math.floor(Number(value)) : fallback;
}

function sortProjects(left: ProjectDocument, right: ProjectDocument): number {
	return String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''));
}
