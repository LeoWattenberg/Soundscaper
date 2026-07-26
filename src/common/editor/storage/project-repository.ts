/* SPDX-License-Identifier: AGPL-3.0-only */

import { collectProjectSourceIds, compactProjectSourceMetadata } from '../retention.js';
import { deleteByIndex, request, transact } from './indexeddb-backend.ts';
import { publishSource } from './media-records.ts';
import type { StorageRepositoryPort } from './repository-port.ts';

interface ProjectDocument {
	readonly id: string;
	readonly revision?: number;
	readonly updatedAt?: unknown;
	readonly [field: string]: unknown;
}

interface ProjectRevisionRecord {
	readonly key: string;
	readonly projectId: string;
	readonly revision: number;
	readonly project: ProjectDocument;
}

/** Durable project snapshots and their bounded revision history. */
export class ProjectRepository {
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
			for (const sourceId of collectProjectSourceIds(snapshot)) {
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
			for (const sourceId of collectProjectSourceIds(snapshot)) {
				const source = asRecord(await request(sources.get(sourceId)));
				if (source?.pendingProjectUntil) sources.put(publishSource(source));
				const mediaAsset = asRecord(await request(mediaAssets.get(sourceId)));
				if (mediaAsset?.pendingProjectUntil) mediaAssets.put(publishSource(mediaAsset));
			}
		});
		await this.#pruneRevisions(snapshot.id);
		return clone(snapshot);
	}

	async load(projectId: string, { revision }: { readonly revision?: number } = {}): Promise<ProjectDocument | null> {
		const database = await this.#port.database();
		if (!database) {
			const value = revision === undefined
				? this.#port.memory.projects.get(projectId)
				: asRevision(this.#port.memory.revisions.get(revisionKey(projectId, revision)))?.project;
			return value ? clone(compactProjectSourceMetadata(value) as ProjectDocument) : null;
		}

		const storeName = revision === undefined ? 'projects' : 'revisions';
		const key = revision === undefined ? projectId : revisionKey(projectId, revision);
		const value = await transact(database, storeName, 'readonly', (stores) => request(stores[storeName].get(key)));
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

	async listRevisions(projectId: string): Promise<Array<{ revision: number; project: ProjectDocument }>> {
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
