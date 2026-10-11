/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MotionAsset } from '../common/editor/motion-asset.ts';
import type { MotionAssetBody } from '../common/editor/motion-asset-body.ts';
import { motionDigest, motionId, motionInteger, motionRecord, motionString } from '../common/editor/motion-values.ts';
import { openMotionProjectDatabase } from '../common/editor/storage/motion-project-database.ts';
import { reclaimExpiredMotionStaging } from '../common/editor/storage/motion-asset-staging.ts';
import { MotionAssetRepository, type MotionAssetStaging } from '../common/editor/storage/motion-asset-repository.ts';
import { request, transact } from '../common/editor/storage/indexeddb-backend.ts';
import { editorProjectStorageProfileNames } from '../common/editor/storage/project-storage-profile.ts';
import { bindEditorProjectStoreProfile } from '../common/editor/storage/project-store-profile-binding.ts';
import { MOTIONSCAPER_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile.ts';
import { createMotionscaperRevision, verifyMotionscaperRevision, type MotionscaperRevision } from './editor-project-revision.ts';
import { normalizeMotionscaperProject } from './editor-project-validation.ts';
import type { MotionscaperProject } from './editor-project-types.ts';
import type { MotionArchiveImportTransaction } from './editor-scape.ts';
import { MotionProjectConflictError, MotionProjectWriteLeases, MOTION_PROJECT_LEASE_STORE, type MotionProjectWriteLease } from './editor-project-write-lease.ts';
export { MotionProjectConflictError, MotionProjectLeaseError } from './editor-project-write-lease.ts';

interface ProjectPointer {
	readonly id: string; readonly savedDigest: string | null;
	readonly recovery: MotionscaperProject | null;
	readonly savedTitle: string | null;
	readonly savedRevision: number | null;
}
interface StoredRevision { readonly key: string; readonly projectId: string; readonly snapshot: MotionscaperRevision }
export interface MotionscaperProjectStoreOptions { readonly indexedDB?: IDBFactory; readonly now?: () => number }
export interface MotionProjectSummary {
	readonly id: string; readonly title: string; readonly revision: number;
	readonly savedDigest: string | null; readonly hasRecovery: boolean;
}

export function createMotionscaperProjectStore(options: MotionscaperProjectStoreOptions = {}): MotionscaperProjectStore {
	return new MotionscaperProjectStore(options);
}

/** Durable scene snapshots; recovery writes do not publish saved revisions. */
export class MotionscaperProjectStore {
	readonly #databasePromise: Promise<IDBDatabase>;
	readonly #assets: MotionAssetRepository;
	readonly #leases: MotionProjectWriteLeases;
	readonly #listeners = new Set<(revision: MotionscaperRevision) => void>();
	#closed = false;

	constructor(options: MotionscaperProjectStoreOptions) {
		const indexedDB = options.indexedDB ?? globalThis.indexedDB;
		if (!indexedDB) throw new Error('Motionscaper requires durable browser storage.');
		bindEditorProjectStoreProfile(this, MOTIONSCAPER_PROJECT_STORAGE_PROFILE);
		this.#databasePromise = openMotionProjectDatabase(indexedDB,
			editorProjectStorageProfileNames(MOTIONSCAPER_PROJECT_STORAGE_PROFILE).databaseName).then(async (database) => {
			try { await reclaimExpiredMotionStaging(database); return database; }
			catch (error) { database.close(); throw error; }
		});
		this.#assets = new MotionAssetRepository(() => this.#database());
		this.#leases = new MotionProjectWriteLeases({ database: () => this.#databasePromise, physicalLocks: indexedDB === globalThis.indexedDB, now: options.now });
	}

	async #database(): Promise<IDBDatabase> {
		if (this.#closed) throw new Error('Motion project store is closed.');
		return this.#databasePromise;
	}

	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		this.#listeners.clear();
		try { await this.#leases.close(); } finally { (await this.#databasePromise).close(); }
	}
	acquireWriteAccess(id: string): Promise<MotionProjectWriteLease> { return this.#leases.acquire(id); }
	releaseWriteAccess(lease: MotionProjectWriteLease): Promise<void> { return this.#leases.release(lease); }
	async assertWriteAccess(lease: MotionProjectWriteLease): Promise<void> {
		const database = await this.#database();
		await transact(database, [MOTION_PROJECT_LEASE_STORE], 'readonly', stores => this.#leases.assert(stores, lease));
	}

	subscribeSaved(listener: (revision: MotionscaperRevision) => void): () => void {
		this.#listeners.add(listener);
		return () => { this.#listeners.delete(listener); };
	}

	async save(value: unknown, expectedDigest: string | null, lease?: MotionProjectWriteLease): Promise<MotionscaperRevision> {
		const snapshot = createMotionscaperRevision(value);
		await this.#publish(snapshot, expectedDigest, [], lease);
		this.#notify(snapshot);
		return snapshot;
	}

	async #publish(snapshot: MotionscaperRevision, expectedDigest: string | null, staging: readonly MotionAssetStaging[], authority?: MotionProjectWriteLease): Promise<void> {
		if (expectedDigest !== null) motionDigest(expectedDigest);
		const database = await this.#database();
		const lease = authority ?? await this.#leases.defaultLease(snapshot.projectId);
		if (lease.projectId !== snapshot.projectId) throw new MotionProjectConflictError();
		await transact(database, ['projects', 'revisions', 'assets', 'chunks', 'staging', MOTION_PROJECT_LEASE_STORE], 'readwrite', async (stores) => {
			await this.#leases.assert(stores, lease, true);
			const prior: unknown = await request(stores.projects.get(snapshot.projectId));
			const pointer = prior === undefined ? null : readPointer(prior, snapshot.projectId);
			if ((pointer?.savedDigest ?? null) !== expectedDigest) throw new MotionProjectConflictError();
			if (pointer?.savedDigest) {
				const previous = readRevision(await request(stores.revisions.get(revisionKey(snapshot.projectId, pointer.savedDigest))), snapshot.projectId, pointer.savedDigest);
				assertSavedPointer(pointer, previous);
				if (snapshot.digest !== previous.digest && snapshot.revision <= previous.revision) {
					throw new RangeError('Saved motion revisions must increase after an edit.');
				}
			}
			for (const stage of staging) await stage.publish(stores);
			for (const asset of snapshot.project.assets) await this.#assets.assertAvailable(stores, asset);
			await this.#leases.assert(stores, lease);
			await request(stores.revisions.put({ key: revisionKey(snapshot.projectId, snapshot.digest),
				projectId: snapshot.projectId, snapshot } satisfies StoredRevision));
			await request(stores.projects.put({ id: snapshot.projectId, savedDigest: snapshot.digest,
				savedTitle: snapshot.project.title, savedRevision: snapshot.revision, recovery: null } satisfies ProjectPointer));
		});
	}

	#notify(snapshot: MotionscaperRevision): void {
		for (const listener of this.#listeners) {
			// A listener cannot turn an already durable save into a failed publication.
			try { listener(snapshot); } catch { /* Subscriber diagnostics belong to its owning workflow. */ }
		}
	}

	async saveRecovery(value: unknown, expectedDigest: string | null, authority?: MotionProjectWriteLease): Promise<void> {
		const project = normalizeMotionscaperProject(value);
		if (expectedDigest !== null) motionDigest(expectedDigest);
		const database = await this.#database();
		const lease = authority ?? await this.#leases.defaultLease(project.id);
		if (lease.projectId !== project.id) throw new MotionProjectConflictError();
		await transact(database, ['projects', 'assets', MOTION_PROJECT_LEASE_STORE], 'readwrite', async (stores) => {
			await this.#leases.assert(stores, lease, true);
			const stored: unknown = await request(stores.projects.get(project.id));
			const pointer = stored === undefined ? null : readPointer(stored, project.id);
			if ((pointer?.savedDigest ?? null) !== expectedDigest) throw new MotionProjectConflictError();
			for (const asset of project.assets) await this.#assets.assertAvailable(stores, asset);
			await this.#leases.assert(stores, lease);
			await request(stores.projects.put({ id: project.id, savedDigest: expectedDigest,
				savedTitle: pointer?.savedTitle ?? null, savedRevision: pointer?.savedRevision ?? null,
				recovery: project } satisfies ProjectPointer));
		});
	}

	async load(id: string): Promise<MotionscaperRevision | null> {
		motionId(id);
		const database = await this.#database();
		return transact(database, ['projects', 'revisions'], 'readonly', async (stores) => {
			const value: unknown = await request(stores.projects.get(id));
			if (value === undefined) return null;
			const pointer = readPointer(value, id);
			if (!pointer.savedDigest) return null;
			const snapshot = readRevision(await request(stores.revisions.get(revisionKey(id, pointer.savedDigest))), id, pointer.savedDigest);
			assertSavedPointer(pointer, snapshot);
			return snapshot;
		});
	}

	async loadRevision(id: string, digest: string): Promise<MotionscaperRevision | null> {
		motionId(id); motionDigest(digest);
		const database = await this.#database();
		return transact(database, ['revisions'], 'readonly', async (stores) => {
			const value: unknown = await request(stores.revisions.get(revisionKey(id, digest)));
			return value === undefined ? null : readRevision(value, id, digest);
		});
	}

	async loadRecovery(id: string): Promise<MotionscaperProject | null> {
		motionId(id);
		const database = await this.#database();
		return transact(database, ['projects'], 'readonly', async (stores) => {
			const value: unknown = await request(stores.projects.get(id));
			return value === undefined ? null : readPointer(value, id).recovery;
		});
	}

	async list(): Promise<readonly MotionProjectSummary[]> {
		const database = await this.#database();
		return transact(database, ['projects'], 'readonly', (stores) => new Promise<MotionProjectSummary[]>((resolve, reject) => {
			const summaries: MotionProjectSummary[] = [];
			const cursorRequest = stores.projects.openCursor();
			cursorRequest.onerror = () => reject(cursorRequest.error);
			cursorRequest.onsuccess = () => {
				const cursor = cursorRequest.result;
				if (!cursor) { resolve(summaries); return; }
				try {
					const pointer = readPointer(cursor.value, motionId(cursor.primaryKey));
					summaries.push(Object.freeze({ id: pointer.id,
						title: pointer.savedTitle ?? pointer.recovery?.title ?? pointer.id,
						revision: pointer.savedRevision ?? pointer.recovery?.revision ?? 0,
						savedDigest: pointer.savedDigest, hasRecovery: pointer.recovery !== null }));
					cursor.continue();
				} catch (error) { reject(error); }
			};
		}));
	}

	putAsset(asset: unknown, body: Blob, signal?: AbortSignal): Promise<void> { return this.#assets.put(asset, body, signal); }
	loadAsset(asset: unknown): Promise<Blob | null> { return this.#assets.load(asset); }
	readAsset(asset: unknown): Promise<MotionAssetBody | null> { return this.#assets.read(asset); }

	async beginImport(projectInput: unknown, lease?: MotionProjectWriteLease): Promise<MotionArchiveImportTransaction> {
		const project = normalizeMotionscaperProject(projectInput);
		const stages = new Map<string, MotionAssetStaging>();
		let settled = false;
		const find = async (asset: MotionAsset): Promise<MotionAssetStaging> => {
			if (settled) throw new Error('Motion import transaction is closed.');
			const owned = project.assets.find((entry) => entry.id === asset.id);
			if (!owned || JSON.stringify(asset) !== JSON.stringify(owned)) throw new Error('Motion import asset is outside its project closure.');
			let stage = stages.get(asset.id);
			if (!stage) { stage = await this.#assets.stage(asset); stages.set(asset.id, stage); }
			return stage;
		};
		return {
			writeAssetChunk: async (asset, bytes) => { await (await find(asset)).write(bytes); },
			finishAsset: async (asset) => { await (await find(asset)).finish(); },
			commit: async (value) => {
				if (settled) throw new Error('Motion import transaction is closed.');
				const snapshot = createMotionscaperRevision(value);
				if (snapshot.digest !== createMotionscaperRevision(project).digest) throw new Error('Motion project changed during import.');
				await this.#publish(snapshot, null, [...stages.values()], lease);
				settled = true;
				this.#notify(snapshot);
			},
			rollback: async () => {
				if (settled) return;
				for (const stage of stages.values()) await stage.rollback();
				settled = true;
			},
		};
	}
}

function revisionKey(id: string, digest: string): string { return `${id}:${digest}`; }
function readRevision(value: unknown, id: string, digest: string): MotionscaperRevision {
	const record = motionRecord(value, ['key', 'projectId', 'snapshot'], 'stored motion revision');
	const snapshot = verifyMotionscaperRevision(record.snapshot);
	if (record.key !== revisionKey(id, digest) || record.projectId !== id || snapshot.projectId !== id || snapshot.digest !== digest) {
		throw new Error('Stored motion revision identity does not match its requested project.');
	}
	return snapshot;
}
function readPointer(value: unknown, id: string): ProjectPointer {
	const record = motionRecord(value, ['id', 'savedDigest', 'savedTitle', 'savedRevision', 'recovery'], 'stored motion project pointer');
	const recovery = record.recovery === null ? null : normalizeMotionscaperProject(record.recovery);
	if (record.id !== id || (recovery && recovery.id !== id)) {
		throw new Error('Stored motion recovery or pointer identity does not match its project.');
	}
	if ((record.savedDigest === null) !== (record.savedTitle === null) || (record.savedDigest === null) !== (record.savedRevision === null)) {
		throw new Error('Stored motion project pointer has inconsistent saved metadata.');
	}
	return { id: motionId(id), savedDigest: record.savedDigest === null ? null : motionDigest(record.savedDigest),
		savedTitle: record.savedTitle === null ? null : motionString(record.savedTitle, 'saved title'),
		savedRevision: record.savedRevision === null ? null : motionInteger(record.savedRevision, 'saved revision'), recovery };
}
function assertSavedPointer(pointer: ProjectPointer, snapshot: MotionscaperRevision): void {
	if (pointer.savedTitle !== snapshot.project.title || pointer.savedRevision !== snapshot.revision) {
		throw new Error('Stored motion project pointer disagrees with its saved revision.');
	}
}
