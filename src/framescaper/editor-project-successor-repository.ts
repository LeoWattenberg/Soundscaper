/* SPDX-License-Identifier: AGPL-3.0-only */
import { assertFramescaperSuccessorLine, migrateFramescaperSuccessorProject, normalizeFramescaperSuccessorProject } from './editor-project-successor.ts';
import { openFramescaperSuccessorDatabase } from './editor-project-successor-database.ts';
import { inspectFramescaperMigrationArchive, type FramescaperMigrationRecord } from './editor-project-successor-archive.ts';
import { readFramescaperArchiveCustody, reclaimFramescaperArchiveStaging, stageFramescaperArchiveCustody, type FramescaperArchiveStage } from './editor-project-successor-archive-custody.ts';
import { FRAMESCAPER_ARCHIVE_STORES, assertFramescaperArchiveCustody, type FramescaperArchiveReference } from './editor-project-successor-archive-record.ts';
import { request, transact } from '../common/editor/storage/indexeddb-backend.ts';
import { motionDigest, motionId, motionRecord } from '../common/editor/motion-values.ts';

export interface FramescaperSuccessorRepository {
	stage(original: Blob, signal?: AbortSignal): Promise<FramescaperMigrationRecord>;
	complete(id: string): Promise<FramescaperMigrationRecord>;
	recover(signal?: AbortSignal): Promise<readonly string[]>;
	load(id: string): Promise<FramescaperMigrationRecord | null>;
	list(): Promise<readonly FramescaperMigrationRecord[]>;
	close(): void;
}
type StoredMigration = Omit<FramescaperMigrationRecord, 'originalArchive'> & { readonly originalArchive: Blob | FramescaperArchiveReference };
const STORES = ['pending', 'projects', 'owners', ...FRAMESCAPER_ARCHIVE_STORES] as const;

/** The baseline database is never opened: journal, original bytes and publication share v2 authority. */
export async function openFramescaperSuccessorRepository(options: { readonly indexedDB?: IDBFactory; readonly line: unknown }): Promise<FramescaperSuccessorRepository> {
	assertFramescaperSuccessorLine(options.line);
	const factory = options.indexedDB ?? globalThis.indexedDB;
	if (!factory) throw new Error('Durable IndexedDB storage is required for successor migration.');
	const database = await openFramescaperSuccessorDatabase(factory, options.line);
	try { await reclaimFramescaperArchiveStaging(database); } catch (error) { database.close(); throw error; }
	const decode = (record: StoredMigration): FramescaperMigrationRecord => ({ ...record, originalArchive: readFramescaperArchiveCustody(record.originalArchive, record.archiveDigest, factory) });
	const repository: FramescaperSuccessorRepository = {
		async stage(originalArchive, signal) {
			const { project, archiveDigest } = await inspectFramescaperMigrationArchive(originalArchive, signal);
			const stage = await stageFramescaperArchiveCustody(database, originalArchive, archiveDigest, signal);
			return withStageCleanup(stage, async () => decode(await transact(database, STORES, 'readwrite', async stores => {
				signal?.throwIfAborted();
				const record: StoredMigration = { id: project.id, archiveDigest, originalArchive: stage.reference, project: migrateFramescaperSuccessorProject(project) };
				for (const name of ['projects', 'pending']) {
					const value: unknown = await request(stores[name]!.get(record.id));
					if (value !== undefined) { const existing = readStored(value); assertSameArchive(existing, record); return existing; }
				}
				if (await request(stores.owners.get(record.id)) !== undefined) throw new RangeError('Successor migration identity already belongs to another active owner.');
				await stage.publish(stores); await request(stores.pending.add(record)); signal?.throwIfAborted(); return record;
			})));
		},
		async complete(id) {
			const before: unknown = await transact(database, ['pending'], 'readonly', stores => request(stores.pending.get(id)));
			const pendingBefore = before === undefined ? null : readStored(before);
			// A legacy interrupted journal is converted before the atomic publication, never copied as a Blob into a new row.
			const stage = pendingBefore?.originalArchive instanceof Blob ? await stageFramescaperArchiveCustody(database, pendingBefore.originalArchive, pendingBefore.archiveDigest) : undefined;
			return withStageCleanup(stage, async () => decode(await transact(database, STORES, 'readwrite', async stores => {
				const committedValue: unknown = await request(stores.projects.get(id)); const pendingValue: unknown = await request(stores.pending.get(id));
				const committed = committedValue === undefined ? null : readStored(committedValue); const pending = pendingValue === undefined ? null : readStored(pendingValue);
				if (committed) { if (pending) assertSameArchive(committed, pending); return committed; }
				if (!pending) throw new RangeError('Successor migration has no prepared original archive.');
				if (await request(stores.owners.get(id)) !== undefined) throw new RangeError('Successor migration identity changed before publication.');
				if (stage && (!pendingBefore || JSON.stringify(pending.project) !== JSON.stringify(pendingBefore.project) || pending.archiveDigest !== pendingBefore.archiveDigest)) throw new RangeError('Successor migration journal changed before publication.');
				if (stage) await stage.publish(stores);
				const record = { ...pending, originalArchive: stage?.reference ?? pending.originalArchive };
				await request(stores.projects.add(record)); await request(stores.pending.delete(id)); return record;
			})));
		},
		async recover(signal) {
			const pending = await transact(database, ['pending'], 'readonly', async stores => (await request(stores.pending.getAll()) as unknown[]).map(readStored));
			const recovered: string[] = [];
			for (const stored of pending) {
				const entry = decode(stored); const inspected = await inspectFramescaperMigrationArchive(entry.originalArchive, signal);
				if (inspected.archiveDigest !== entry.archiveDigest || inspected.project.id !== entry.id
					|| JSON.stringify(migrateFramescaperSuccessorProject(inspected.project)) !== JSON.stringify(entry.project)) throw new Error('Interrupted successor migration archive identity is invalid.');
				await repository.complete(entry.id); recovered.push(entry.id);
			}
			return recovered;
		},
		async load(id) { const value: unknown = await transact(database, ['projects'], 'readonly', stores => request(stores.projects.get(id))); return value === undefined ? null : decode(readStored(value)); },
		list: () => transact(database, ['projects'], 'readonly', async stores => (await request(stores.projects.getAll()) as unknown[]).map(value => decode(readStored(value)))),
		close: () => database.close(),
	};
	return Object.freeze(repository);
}
function readStored(value: unknown): StoredMigration {
	const row = motionRecord(value, ['id', 'archiveDigest', 'originalArchive', 'project'], 'successor migration custody');
	const id = motionId(row.id); const archiveDigest = motionDigest(row.archiveDigest); const project = normalizeFramescaperSuccessorProject(row.project);
	if (project.id !== id) throw new RangeError('Successor migration custody identity changed.'); assertFramescaperArchiveCustody(row.originalArchive, archiveDigest);
	return { id, archiveDigest, project, originalArchive: row.originalArchive as Blob | FramescaperArchiveReference };
}
function assertSameArchive(left: StoredMigration, right: StoredMigration): void {
	if (left.id !== right.id || left.archiveDigest !== right.archiveDigest) throw new RangeError('Successor migration conflict: this project identity already retains another original archive.');
}
async function withStageCleanup<T>(stage: FramescaperArchiveStage | undefined, action: () => Promise<T>): Promise<T> {
	let result: T;
	try { result = await action(); } catch (error) {
		const failures: unknown[] = []; try { await stage?.rollback(); } catch (cleanup) { failures.push(cleanup); }
		if (failures.length) throw new AggregateError([error, ...failures], 'Successor migration and private cleanup failed.', { cause: error }); throw error;
	}
	await stage?.rollback(); return result;
}
