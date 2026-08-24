/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	collectProjectStorageKeys,
	compactProjectSourceMetadata,
} from '../retention.js';
import { deleteExactProject } from './project-exact-delete.ts';
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
import {
	LINKED_ORIGINAL_PROVISIONAL_ROOT_PROJECT_INDEX_NAME,
	LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME,
	readMemoryLinkedOriginalProvisionalRootInventory,
	readStoredLinkedOriginalProvisionalRootInventory,
} from './linked-original-provisional-root.ts';
import { publishSource } from './media-records.ts';
import { sameProjectSnapshot } from './project-snapshot-equality.ts';
import type { StorageRepositoryPort } from './repository-port.ts';
import {
	applyMemoryMutations,
	asRecord,
	asRevision,
	clone,
	createProjectCreationFence,
	deleteMemoryMutation,
	isRevisionFor,
	memoryHasProjectRevision,
	nonNegativeInteger,
	revisionKey,
	setMemoryMutation,
	sortProjects,
	storedCreationFence,
	storedProjectId,
	type MemoryMutation,
	type ProjectRevisionRecord,
} from './project-repository-support.ts';

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
export interface ProjectLoadOptions {
	readonly revision?: number;
	readonly signal?: AbortSignal;
}

export type ProjectPostCommitMaintenance = () => PromiseLike<void> | void;
/** Structural project seam implemented by local and desktop-shared repositories. */
export interface ProjectRepositoryPort {
	createIfAbsent?(project: ProjectDocument): Promise<ProjectDocument | null>;
	createForScapeImportIfAbsent?(project: ProjectDocument): Promise<ProjectDocument | null>;
	save(project: ProjectDocument, postCommit?: ProjectPostCommitMaintenance): Promise<ProjectDocument>;
	saveIfCurrent?(expected: ProjectDocument, project: ProjectDocument, postCommit?: ProjectPostCommitMaintenance): Promise<ProjectDocument | null>;
	maintainCurrentProject?(projectId: string, maintenance: ProjectPostCommitMaintenance): Promise<void>;
	load(projectId: string, options?: ProjectLoadOptions): Promise<ProjectDocument | null>;
	list(): Promise<ProjectDocument[]>;
	listRevisions(projectId: string): Promise<ProjectRevision[]>;
	deleteIfCurrent?(project: ProjectDocument): Promise<boolean>;
	deleteExact?(project: ProjectDocument): Promise<boolean>;
	delete(projectId: string): Promise<void>;
	/** Replace only document/revision rows with a captured snapshot; see ProjectRepository.restore. */
	restore?(projectId: string, snapshot: Readonly<{
		readonly current: ProjectDocument | null;
		readonly revisions: readonly Readonly<{
			readonly revision: number;
			readonly project: ProjectDocument;
		}>[];
	}>): Promise<void>;
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

	/** Atomically create an imported project and publish only its referenced staged sources. */
	async createForScapeImportIfAbsent(project: ProjectDocument): Promise<ProjectDocument | null> {
		const creationFence = createProjectCreationFence();
		const { snapshot, revisionRecord } = projectPublication(project, creationFence);
		const database = await this.#port.database();
		if (!database) {
			const memory = this.#port.memory;
			if (memory.projects.has(snapshot.id) || memory.revisions.has(revisionRecord.key)
				|| memoryHasProjectRevision(memory.revisions, snapshot.id)) return null;
			const mutations: MemoryMutation[] = [
				setMemoryMutation(memory.projects, snapshot.id, snapshot),
				setMemoryMutation(memory.revisions, revisionRecord.key, revisionRecord),
			];
			for (const sourceId of collectProjectStorageKeys(snapshot)) {
				const source = asRecord(memory.sources.get(sourceId));
				if (source?.pendingProjectUntil) mutations.push(setMemoryMutation(memory.sources, sourceId, publishSource(source)));
				const media = asRecord(memory.mediaAssets.get(sourceId));
				if (media?.pendingProjectUntil) mutations.push(setMemoryMutation(memory.mediaAssets, sourceId, publishSource(media)));
			}
			applyMemoryMutations(mutations);
			return this.#rememberCreation(snapshot, creationFence);
		}
		const created = await transact(database, ['projects', 'revisions', 'sources', 'mediaAssets'], 'readwrite', async (stores) => {
			const { projects, revisions, sources, mediaAssets } = stores;
			const [current, currentRevision, revisionCount] = await Promise.all([
				request(projects.get(snapshot.id)), request(revisions.get(revisionRecord.key)),
				request(revisions.index('projectId').count(snapshot.id)),
			]);
			if (current !== undefined || currentRevision !== undefined || revisionCount > 0) return false;
			await Promise.all([request(projects.put(snapshot)), request(revisions.put(revisionRecord))]);
			for (const sourceId of collectProjectStorageKeys(snapshot)) {
				const source = asRecord(await request(sources.get(sourceId)));
				if (source?.pendingProjectUntil) await request(sources.put(publishSource(source)));
				const media = asRecord(await request(mediaAssets.get(sourceId)));
				if (media?.pendingProjectUntil) await request(mediaAssets.put(publishSource(media)));
			}
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

	async maintainCurrentProject(projectId: string, maintenance: ProjectPostCommitMaintenance): Promise<void> {
		if (typeof projectId !== 'string' || !projectId) throw new TypeError('A project ID is required for maintenance.');
		if (typeof maintenance !== 'function') throw new TypeError('Project maintenance must be a function.');
		await maintenance();
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

	deleteExact(project: ProjectDocument): Promise<boolean> { return deleteExactProject(this.#port, project); }

	#rememberCreation(snapshot: ProjectDocument, creationFence: string): ProjectDocument {
		const created = clone(snapshot);
		this.#creationFences.set(created, creationFence);
		return created;
	}

	/**
	 * Replace only the project's document and revision rows with a captured
	 * snapshot.
	 *
	 * A failed replace-import rolls back through this rather than the full
	 * delete-then-resave lifecycle: linked-original binding rows and
	 * provisional roots hold platform locator grants that a document re-save
	 * can never reconstruct, so they must stay untouched, and the restore
	 * writes run without publication admission so a quota shortage cannot
	 * leave the pre-existing project deleted after its delete committed.
	 */
	async restore(projectId: string, snapshot: Readonly<{
		readonly current: ProjectDocument | null;
		readonly revisions: readonly Readonly<{
			readonly revision: number;
			readonly project: ProjectDocument;
		}>[];
	}>): Promise<void> {
		const rows: ProjectRevisionRecord[] = snapshot.revisions.map(({ revision, project }) => {
			const document = compactProjectSourceMetadata(clone(project)) as ProjectDocument;
			const value = nonNegativeInteger(revision, 0);
			return { key: revisionKey(projectId, value), projectId, revision: value, project: document };
		});
		const current = snapshot.current === null
			? null : compactProjectSourceMetadata(clone(snapshot.current)) as ProjectDocument;
		const database = await this.#port.database();
		if (!database) {
			const memory = this.#port.memory;
			const mutations: MemoryMutation[] = [deleteMemoryMutation(memory.projects, projectId)];
			for (const [key, value] of memory.revisions) {
				if (asRevision(value)?.projectId === projectId) {
					mutations.push(deleteMemoryMutation(memory.revisions, key));
				}
			}
			for (const row of rows) mutations.push(setMemoryMutation(memory.revisions, row.key, row));
			if (current) mutations.push(setMemoryMutation(memory.projects, projectId, current));
			applyMemoryMutations(mutations);
			return;
		}
		await transact(database, ['projects', 'revisions'], 'readwrite', async ({ projects, revisions }) => {
			projects.delete(projectId);
			await deleteByIndex(revisions.index('projectId'), projectId);
			for (const row of rows) revisions.put(row);
			if (current) projects.put(current);
		});
	}

	async delete(projectId: string): Promise<void> {
		const database = await this.#port.database();
		if (!database) {
			readMemoryLinkedOriginalProvisionalRootInventory(
				this.#port.memory.linkedVideoOriginalBindings,
				this.#port.memory.linkedOriginalProvisionalRoots,
			);
			const mutations = [deleteMemoryMutation(this.#port.memory.projects, projectId)];
			for (const [key, value] of this.#port.memory.revisions) {
				if (asRevision(value)?.projectId === projectId) {
					mutations.push(deleteMemoryMutation(this.#port.memory.revisions, key));
				}
			}
			for (const records of [
				this.#port.memory.linkedVideoOriginalBindings,
				this.#port.memory.linkedOriginalProvisionalRoots,
			]) {
				for (const [key, value] of records) {
					if (storedProjectId(value) === projectId) mutations.push(deleteMemoryMutation(records, key));
				}
			}
			applyMemoryMutations(mutations);
			return;
		}
		await transact(database, [
			'projects',
			'revisions',
			LINKED_VIDEO_ORIGINAL_STORE_NAME,
			LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME,
		], 'readwrite', async (stores) => {
			const { projects, revisions } = stores;
			await readStoredLinkedOriginalProvisionalRootInventory(
				stores[LINKED_VIDEO_ORIGINAL_STORE_NAME],
				stores[LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME],
			);
			projects.delete(projectId);
			await deleteByIndex(revisions.index('projectId'), projectId);
			await deleteByIndex(
				stores[LINKED_VIDEO_ORIGINAL_STORE_NAME].index(LINKED_VIDEO_ORIGINAL_PROJECT_INDEX_NAME),
				projectId,
			);
			await deleteByIndex(
				stores[LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME].index(
					LINKED_ORIGINAL_PROVISIONAL_ROOT_PROJECT_INDEX_NAME,
				),
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
