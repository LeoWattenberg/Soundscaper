/* SPDX-License-Identifier: AGPL-3.0-only */
import { editorProjectStorageProfileNames } from '../common/editor/storage/project-storage-profile.ts';
import { assertFramescaperSuccessorLine, FRAMESCAPER_SUCCESSOR_STORAGE_PROFILE, migrateFramescaperSuccessorProject, normalizeFramescaperSuccessorProject } from './editor-project-successor.ts';
import { inspectFramescaperMigrationArchive, type FramescaperMigrationRecord } from './editor-project-successor-archive.ts';

export interface FramescaperSuccessorRepository {
	stage(original: Blob, signal?: AbortSignal): Promise<FramescaperMigrationRecord>;
	complete(id: string): Promise<FramescaperMigrationRecord>;
	recover(signal?: AbortSignal): Promise<readonly string[]>;
	load(id: string): Promise<FramescaperMigrationRecord | null>;
	list(): Promise<readonly FramescaperMigrationRecord[]>;
	close(): void;
}

/** The baseline database is never opened: journal, original bytes and publication share v2 authority. */
export async function openFramescaperSuccessorRepository(options: { readonly indexedDB?: IDBFactory; readonly line: unknown }): Promise<FramescaperSuccessorRepository> {
	assertFramescaperSuccessorLine(options.line);
	const factory = options.indexedDB ?? globalThis.indexedDB;
	if (!factory) throw new Error('Durable IndexedDB storage is required for successor migration.');
	const open = factory.open(editorProjectStorageProfileNames(FRAMESCAPER_SUCCESSOR_STORAGE_PROFILE).databaseName, 1);
	open.onupgradeneeded = () => {
		for (const name of ['pending', 'projects']) open.result.createObjectStore(name, { keyPath: 'id' });
	};
	const database = await request(open);
	database.onversionchange = () => database.close();
	async function run<T>(mode: IDBTransactionMode, action: (transaction: IDBTransaction) => Promise<T>): Promise<T> {
		const transaction = database.transaction(['pending', 'projects'], mode);
		const settled = new Promise<void>((resolve, reject) => {
			transaction.oncomplete = () => resolve();
			transaction.onabort = () => reject(transaction.error ?? new Error('Successor migration transaction aborted.'));
			transaction.onerror = () => undefined;
		});
		try { const result = await action(transaction); await settled; return result; }
		catch (error) { try { transaction.abort(); } catch { /* It may have already aborted. */ } await settled.catch(() => undefined); throw error; }
	}
	const repository: FramescaperSuccessorRepository = {
		async stage(originalArchive, signal) {
			const { project, archiveDigest } = await inspectFramescaperMigrationArchive(originalArchive, signal);
			const record: FramescaperMigrationRecord = { id: project.id, archiveDigest, originalArchive, project: migrateFramescaperSuccessorProject(project) };
			signal?.throwIfAborted();
			return run('readwrite', async (transaction) => {
				for (const name of ['projects', 'pending']) {
					const existing = await request(transaction.objectStore(name).get(record.id)) as FramescaperMigrationRecord | undefined;
					if (existing) { assertSameArchive(existing, record); return existing; }
				}
				await request(transaction.objectStore('pending').add(record)); return record;
			});
		},
		async complete(id) {
			return run('readwrite', async (transaction) => {
				const committed = await request(transaction.objectStore('projects').get(id)) as FramescaperMigrationRecord | undefined;
				const pending = await request(transaction.objectStore('pending').get(id)) as FramescaperMigrationRecord | undefined;
				if (committed) { if (pending) assertSameArchive(committed, pending); return committed; }
				if (!pending) throw new RangeError('Successor migration has no prepared original archive.');
				const record = { ...pending, project: normalizeFramescaperSuccessorProject(pending.project) };
				await request(transaction.objectStore('projects').add(record));
				await request(transaction.objectStore('pending').delete(id)); return record;
			});
		},
		async recover(signal) {
			const pending = await run('readonly', async (transaction) => await request(transaction.objectStore('pending').getAll()) as FramescaperMigrationRecord[]);
			const recovered: string[] = [];
			for (const entry of pending) {
				const inspected = await inspectFramescaperMigrationArchive(entry.originalArchive, signal);
				if (inspected.archiveDigest !== entry.archiveDigest || inspected.project.id !== entry.id
					|| JSON.stringify(migrateFramescaperSuccessorProject(inspected.project)) !== JSON.stringify(normalizeFramescaperSuccessorProject(entry.project))) throw new Error('Interrupted successor migration archive identity is invalid.');
				await repository.complete(entry.id); recovered.push(entry.id);
			}
			return recovered;
		},
		load: (id) => run('readonly', async (transaction) => (await request(transaction.objectStore('projects').get(id)) as FramescaperMigrationRecord | undefined) ?? null),
		list: () => run('readonly', async (transaction) => await request(transaction.objectStore('projects').getAll()) as FramescaperMigrationRecord[]),
		close: () => database.close(),
	};
	return Object.freeze(repository);
}
function assertSameArchive(left: FramescaperMigrationRecord, right: FramescaperMigrationRecord): void {
	if (left.id !== right.id || left.archiveDigest !== right.archiveDigest) throw new RangeError('Successor migration conflict: this project identity already retains another original archive.');
}
function request<T>(value: IDBRequest<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		value.onsuccess = () => resolve(value.result);
		value.onerror = () => reject(value.error ?? new Error('Successor migration database request failed.'));
	});
}
