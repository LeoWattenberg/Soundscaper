/* SPDX-License-Identifier: AGPL-3.0-only */

import { collectProjectStorageKeys, compactProjectSourceMetadata } from '../retention.js';
import { serializeScapeProjectDocument } from '../scape-project-document.ts';
import { request, transact } from './indexeddb-backend.ts';
import { publishSource } from './media-records.ts';
import type {
	ProjectDocument,
	ProjectLoadOptions,
	ProjectPostCommitMaintenance,
	ProjectRepositoryPort,
	ProjectRevision,
} from './project-repository.ts';
import type { StorageRepositoryPort } from './repository-port.ts';

interface ProjectRevisionRecord {
	readonly key: string;
	readonly projectId: string;
	readonly revision: number;
	readonly project: ProjectDocument;
}

/** Add exact-current publication to a project repository without widening its ordinary save path. */
export class ProjectCompareAndSwapRepository implements ProjectRepositoryPort {
	readonly #delegate: ProjectRepositoryPort;
	readonly #port: StorageRepositoryPort;
	readonly #revisionLimit: number;

	constructor(delegate: ProjectRepositoryPort, port: StorageRepositoryPort, revisionLimit: number) {
		this.#delegate = delegate;
		this.#port = port;
		this.#revisionLimit = Math.max(2, Math.floor(revisionLimit));
	}

	createIfAbsent(project: ProjectDocument): Promise<ProjectDocument | null> {
		const create = this.#delegate.createIfAbsent;
		if (!create) throw new Error('Create-only project storage is unavailable.');
		return create.call(this.#delegate, project);
	}

	save(project: ProjectDocument, postCommit?: ProjectPostCommitMaintenance): Promise<ProjectDocument> {
		return this.#delegate.save(project, postCommit);
	}

	async saveIfCurrent(
		expectedValue: ProjectDocument,
		projectValue: ProjectDocument,
		postCommit?: ProjectPostCommitMaintenance,
	): Promise<ProjectDocument | null> {
		if (postCommit !== undefined && typeof postCommit !== 'function') {
			throw new TypeError('Project post-commit maintenance must be a function.');
		}
		const expected = canonicalProject(expectedValue);
		const project = canonicalProject(projectValue);
		if (project.id !== expected.id) {
			throw new Error('Project compare-and-swap cannot change project identity.');
		}
		const revision = revisionNumber(project.revision);
		const revisionRecord: ProjectRevisionRecord = {
			key: revisionKey(project.id, revision),
			projectId: project.id,
			revision,
			project,
		};
		const database = await this.#port.database();
		const published = database
			? await publishIndexedDb(database, expected, project, revisionRecord)
			: publishMemory(this.#port, expected, project, revisionRecord);
		if (!published) return null;
		await this.#pruneRevisions(project.id);
		await postCommit?.();
		return clone(project);
	}

	maintainCurrentProject(projectId: string, maintenance: ProjectPostCommitMaintenance): Promise<void> {
		const maintain = this.#delegate.maintainCurrentProject;
		return maintain ? maintain.call(this.#delegate, projectId, maintenance) : Promise.resolve().then(maintenance);
	}

	load(projectId: string, options?: ProjectLoadOptions): Promise<ProjectDocument | null> {
		return this.#delegate.load(projectId, options);
	}

	list(): Promise<ProjectDocument[]> {
		return this.#delegate.list();
	}

	listRevisions(projectId: string): Promise<ProjectRevision[]> {
		return this.#delegate.listRevisions(projectId);
	}

	deleteIfCurrent(project: ProjectDocument): Promise<boolean> {
		const remove = this.#delegate.deleteIfCurrent;
		return remove ? remove.call(this.#delegate, project) : Promise.resolve(false);
	}

	delete(projectId: string): Promise<void> {
		return this.#delegate.delete(projectId);
	}

	async #pruneRevisions(projectId: string): Promise<void> {
		const database = await this.#port.database();
		const records = !database
			? [...this.#port.memory.revisions.values()].map(asRevision).filter(isRevisionFor(projectId))
			: await transact(database, 'revisions', 'readonly', ({ revisions }) => (
				request(revisions.index('projectId').getAll(projectId)) as Promise<ProjectRevisionRecord[]>
			));
		records.sort((left, right) => right.revision - left.revision);
		const stale = records.slice(this.#revisionLimit);
		if (!stale.length) return;
		if (!database) {
			for (const record of stale) this.#port.memory.revisions.delete(record.key);
			return;
		}
		await transact(database, 'revisions', 'readwrite', ({ revisions }) => {
			for (const record of stale) revisions.delete(record.key);
		});
	}
}

async function publishIndexedDb(
	database: IDBDatabase,
	expected: ProjectDocument,
	project: ProjectDocument,
	revisionRecord: ProjectRevisionRecord,
): Promise<boolean> {
	return transact(database, ['projects', 'revisions', 'sources', 'mediaAssets'], 'readwrite', async ({
		projects, revisions, sources, mediaAssets,
	}) => {
		const current = await request(projects.get(project.id));
		if (!sameProject(current, expected)) return false;
		projects.put(project);
		revisions.put(revisionRecord);
		for (const sourceId of collectProjectStorageKeys(project)) {
			const source = asRecord(await request(sources.get(sourceId)));
			if (source?.pendingProjectUntil) sources.put(publishSource(source));
			const mediaAsset = asRecord(await request(mediaAssets.get(sourceId)));
			if (mediaAsset?.pendingProjectUntil) mediaAssets.put(publishSource(mediaAsset));
		}
		return true;
	});
}

function publishMemory(
	port: StorageRepositoryPort,
	expected: ProjectDocument,
	project: ProjectDocument,
	revisionRecord: ProjectRevisionRecord,
): boolean {
	const { memory } = port;
	if (!sameProject(memory.projects.get(project.id), expected)) return false;
	const changes: Array<Readonly<{ map: Map<string, unknown>; key: string; value: unknown }>> = [
		{ map: memory.projects, key: project.id, value: project },
		{ map: memory.revisions, key: revisionRecord.key, value: revisionRecord },
	];
	for (const sourceId of collectProjectStorageKeys(project)) {
		const source = asRecord(memory.sources.get(sourceId));
		if (source?.pendingProjectUntil) changes.push({
			map: memory.sources, key: sourceId, value: publishSource(source),
		});
		const mediaAsset = asRecord(memory.mediaAssets.get(sourceId));
		if (mediaAsset?.pendingProjectUntil) changes.push({
			map: memory.mediaAssets, key: sourceId, value: publishSource(mediaAsset),
		});
	}
	const prior = changes.map(({ map, key }) => ({ map, key, had: map.has(key), value: map.get(key) }));
	try {
		for (const change of changes) change.map.set(change.key, clone(change.value));
	} catch (error) {
		for (const entry of prior.reverse()) {
			if (entry.had) entry.map.set(entry.key, entry.value);
			else entry.map.delete(entry.key);
		}
		throw error;
	}
	return true;
}

function canonicalProject(value: ProjectDocument): ProjectDocument {
	if (!value || typeof value.id !== 'string' || !value.id) {
		throw new Error('A project with a stable string id is required.');
	}
	return compactProjectSourceMetadata(clone(value)) as ProjectDocument;
}

function sameProject(left: unknown, right: ProjectDocument): boolean {
	return Boolean(left) && serializeScapeProjectDocument(left) === serializeScapeProjectDocument(right);
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function asRevision(value: unknown): ProjectRevisionRecord | null {
	const record = asRecord(value);
	return record && typeof record.key === 'string' && typeof record.projectId === 'string'
		&& typeof record.revision === 'number' && record.project && typeof record.project === 'object'
		? record as unknown as ProjectRevisionRecord : null;
}

function isRevisionFor(projectId: string): (record: ProjectRevisionRecord | null) => record is ProjectRevisionRecord {
	return (record): record is ProjectRevisionRecord => record?.projectId === projectId;
}

function revisionNumber(value: unknown): number {
	return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

function revisionKey(projectId: string, revision: number): string {
	return `${projectId}:${String(revision).padStart(12, '0')}`;
}

function clone<Value>(value: Value): Value {
	if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
	return JSON.parse(JSON.stringify(value)) as Value;
}
