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
}

export interface ProjectLoadOptions {
	readonly revision?: number;
	readonly signal?: AbortSignal;
}

/** Structural project seam implemented by local and desktop-shared repositories. */
export interface ProjectRepositoryPort {
	save(project: ProjectDocument): Promise<ProjectDocument>;
	load(projectId: string, options?: ProjectLoadOptions): Promise<ProjectDocument | null>;
	list(): Promise<ProjectDocument[]>;
	listRevisions(projectId: string): Promise<ProjectRevision[]>;
	delete(projectId: string): Promise<void>;
}

/** Durable project snapshots and their bounded revision history. */
export class ProjectRepository implements ProjectRepositoryPort {
	readonly #port: StorageRepositoryPort;
	readonly #revisionLimit: number;

	constructor(port: StorageRepositoryPort, revisionLimit: number) {
		this.#port = port;
		this.#revisionLimit = Math.max(2, Math.floor(revisionLimit));
	}

	async save(project: ProjectDocument): Promise<ProjectDocument> {
		if (!project || typeof project.id !== 'string' || !project.id) {
			throw new Error('A project with a stable string id is required.');
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

	async delete(projectId: string): Promise<void> {
		const database = await this.#port.database();
		if (!database) {
			this.#port.memory.projects.delete(projectId);
			for (const [key, value] of this.#port.memory.revisions) {
				if (asRevision(value)?.projectId === projectId) this.#port.memory.revisions.delete(key);
			}
			return;
		}
		await transact(database, ['projects', 'revisions'], 'readwrite', async ({ projects, revisions }) => {
			projects.delete(projectId);
			await deleteByIndex(revisions.index('projectId'), projectId);
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

function revisionKey(projectId: string, revision: number): string {
	return `${projectId}:${String(nonNegativeInteger(revision, 0)).padStart(12, '0')}`;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
	return Number.isFinite(value) && Number(value) >= 0 ? Math.floor(Number(value)) : fallback;
}

function sortProjects(left: ProjectDocument, right: ProjectDocument): number {
	return String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''));
}
