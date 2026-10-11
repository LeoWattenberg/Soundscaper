/* SPDX-License-Identifier: AGPL-3.0-only */
import { createBlobScapeArchiveByteSource, createScapeArchiveByteSource, assertScapeArchiveByteSource, readScapeArchiveByteRange, type ScapeArchiveByteSource } from '../common/editor/scape-archive-byte-source.ts';
import type { ScapeProjectInput } from '../common/editor/scape-project-input.ts';
import { createScapeDigest, digestScapeBytes, scapeHex } from '../common/editor/scape-archive-media.ts';
import { deleteByIndex, readCursorPage, request, transact } from '../common/editor/storage/indexeddb-backend.ts';
import { motionDigest, motionInteger, motionRecord } from '../common/editor/motion-values.ts';
import { openFramescaperSuccessorDatabase } from './editor-project-successor-database.ts';
import { FRAMESCAPER_ARCHIVE_CHUNK_BYTES, FRAMESCAPER_ARCHIVE_STORES, framescaperArchiveToken, normalizeFramescaperArchiveReference, type FramescaperArchiveReference } from './editor-project-successor-archive-record.ts';

type Stores = Readonly<Record<string, IDBObjectStore>>;
interface ArchiveStageRecord { readonly key: string; readonly expiresAt: number; readonly size: number; readonly sha256: string | null }
const LEASE_MILLISECONDS = 86_400_000;
export interface FramescaperArchiveStage {
	readonly reference: FramescaperArchiveReference; readonly source: ScapeArchiveByteSource;
	publish(stores: Stores): Promise<void>; rollback(): Promise<void>;
}

/** Stage exact bytes with bounded reads. Only the caller's owner transaction can publish them. */
export async function stageFramescaperArchiveCustody(database: IDBDatabase, input: ScapeProjectInput, expectedDigest?: string, signal?: AbortSignal): Promise<FramescaperArchiveStage> {
	signal?.throwIfAborted(); const source = input instanceof Blob ? createBlobScapeArchiveByteSource(input) : input; assertScapeArchiveByteSource(source);
	const size = motionInteger(source.size, 'archive size', 1); if (expectedDigest !== undefined) motionDigest(expectedDigest);
	await reclaimFramescaperArchiveStaging(database); signal?.throwIfAborted();
	const token = crypto.randomUUID(); const digest = createScapeDigest();
	await transact(database, ['archiveStages'], 'readwrite', stores => request(stores.archiveStages!.add({ key: token, size, sha256: null, expiresAt: Date.now() + LEASE_MILLISECONDS })));
	const rollback = () => transact(database, FRAMESCAPER_ARCHIVE_STORES, 'readwrite', stores => discard(stores, token));
	try {
		let index = 0;
		for (let offset = 0; offset < size; offset += FRAMESCAPER_ARCHIVE_CHUNK_BYTES) {
			signal?.throwIfAborted(); const bytes = await readScapeArchiveByteRange(source, { offset, length: Math.min(FRAMESCAPER_ARCHIVE_CHUNK_BYTES, size - offset), signal });
			signal?.throwIfAborted(); digest.update(bytes);
			await transact(database, ['archiveStages', 'archiveChunks'], 'readwrite', async stores => {
				await renew(stores, token, size); signal?.throwIfAborted();
				await request(stores.archiveChunks!.add({ key: `${token}:${index}`, token, bytes, sha256: digestScapeBytes(bytes) }));
			}); index++;
		}
		const sha256 = scapeHex(digest.digest()); if (expectedDigest !== undefined && sha256 !== expectedDigest) throw new RangeError('Successor archive custody digest differs from its verified input.');
		const reference = normalizeFramescaperArchiveReference({ kind: 'framescaper-archive-chunks-v1', token, size, sha256, chunkCount: index, chunkBytes: FRAMESCAPER_ARCHIVE_CHUNK_BYTES });
		await transact(database, ['archiveStages'], 'readwrite', async stores => { await renew(stores, token, size); signal?.throwIfAborted(); await request(stores.archiveStages!.put({ key: token, size, sha256, expiresAt: Date.now() + LEASE_MILLISECONDS })); });
		return Object.freeze({ reference, source: archiveSource(reference, async action => action(database), true),
			async publish(stores: Stores) {
				signal?.throwIfAborted(); const stage = await renew(stores, token, size);
				if (stage.sha256 !== sha256) throw new RangeError('Successor archive staging digest changed.');
				await request(stores.archiveBodies!.add(reference)); await request(stores.archiveStages!.delete(token)); signal?.throwIfAborted();
			}, rollback });
	} catch (error) {
		const failures: unknown[] = []; try { await rollback(); } catch (cleanup) { failures.push(cleanup); }
		if (failures.length) throw new AggregateError([error, ...failures], 'Successor archive staging and cleanup failed.', { cause: error });
		throw error;
	}
}

/** The returned range capability survives the repository connection closing and never assembles the full archive. */
export function readFramescaperArchiveCustody(value: unknown, expectedDigest: string, indexedDB: IDBFactory): ScapeProjectInput {
	motionDigest(expectedDigest); if (value instanceof Blob) return value;
	const reference = normalizeFramescaperArchiveReference(value, expectedDigest);
	return archiveSource(reference, async action => { const database = await openFramescaperSuccessorDatabase(indexedDB, 'successor'); try { return await action(database); } finally { database.close(); } }, false);
}
function archiveSource(reference: FramescaperArchiveReference, use: <T>(action: (database: IDBDatabase) => Promise<T>) => Promise<T>, allowPrivate: boolean): ScapeArchiveByteSource {
	return createScapeArchiveByteSource({ size: reference.size, async read({ offset, length, signal }) {
		return use(database => transact(database, FRAMESCAPER_ARCHIVE_STORES, 'readonly', async stores => {
			signal?.throwIfAborted(); const body: unknown = await request(stores.archiveBodies!.get(reference.token));
			if (body === undefined) {
				const value: unknown = allowPrivate ? await request(stores.archiveStages!.get(reference.token)) : undefined;
				if (value === undefined) throw new RangeError('Successor archive custody is unavailable.');
				const stage = readStage(value); if (stage.key !== reference.token || stage.size !== reference.size || stage.sha256 !== reference.sha256 || stage.expiresAt <= Date.now()) throw new RangeError('Successor archive staging identity or lease changed.');
			} else if (JSON.stringify(normalizeFramescaperArchiveReference(body, reference.sha256)) !== JSON.stringify(reference)) throw new RangeError('Successor archive custody size or identity changed.');
			const result = new Uint8Array(length); let written = 0;
			while (written < length) {
				signal?.throwIfAborted(); const position = offset + written; const index = Math.floor(position / FRAMESCAPER_ARCHIVE_CHUNK_BYTES); const key = `${reference.token}:${index}`;
				const raw: unknown = await request(stores.archiveChunks!.get(key)); const row = motionRecord(raw, ['key', 'token', 'bytes', 'sha256'], 'successor archive chunk');
				const bytes = row.bytes; const expected = Math.min(FRAMESCAPER_ARCHIVE_CHUNK_BYTES, reference.size - index * FRAMESCAPER_ARCHIVE_CHUNK_BYTES);
				if (row.key !== key || row.token !== reference.token || !(bytes instanceof Uint8Array) || bytes.byteLength !== expected) throw new RangeError('Successor archive chunk length or identity changed.');
				if (digestScapeBytes(bytes) !== motionDigest(row.sha256)) throw new RangeError('Successor archive chunk digest changed.');
				const start = position % FRAMESCAPER_ARCHIVE_CHUNK_BYTES; const count = Math.min(length - written, bytes.length - start);
				result.set(bytes.subarray(start, start + count), written); written += count;
			}
			signal?.throwIfAborted(); return result;
		}));
	} });
}
async function renew(stores: Stores, key: string, size: number): Promise<ArchiveStageRecord> {
	const value: unknown = await request(stores.archiveStages!.get(key)); if (value === undefined) throw new Error('Successor archive staging is missing; retry import.');
	const stage = readStage(value); if (stage.key !== key || stage.size !== size || stage.expiresAt <= Date.now()) throw new RangeError('Successor archive staging identity changed or expired.');
	await request(stores.archiveStages!.put({ ...stage, expiresAt: Date.now() + LEASE_MILLISECONDS })); return stage;
}
async function discard(stores: Stores, key: string): Promise<void> {
	const value: unknown = await request(stores.archiveStages!.get(key)); if (value === undefined) return;
	const stage = readStage(value); if (stage.key !== key) throw new RangeError('Successor archive staging token changed.');
	if (await request(stores.archiveBodies!.get(key)) === undefined) await deleteByIndex(stores.archiveChunks!.index('token'), key);
	await request(stores.archiveStages!.delete(key));
}
export async function reclaimFramescaperArchiveStaging(database: IDBDatabase): Promise<void> {
	let afterPrimaryKey: string | undefined;
	while (true) {
		const page = await transact(database, ['archiveStages'], 'readonly', stores => readCursorPage<ArchiveStageRecord>(stores.archiveStages!, { afterPrimaryKey, limit: 64, project: readStage }));
		for (const stage of page) if (stage.expiresAt <= Date.now()) await transact(database, FRAMESCAPER_ARCHIVE_STORES, 'readwrite', async stores => {
			const current: unknown = await request(stores.archiveStages!.get(stage.key)); if (current !== undefined && readStage(current).expiresAt <= Date.now()) await discard(stores, stage.key);
		});
		if (page.length < 64) return; afterPrimaryKey = page.at(-1)!.key;
	}
}
function readStage(value: unknown): ArchiveStageRecord {
	const row = motionRecord(value, ['key', 'expiresAt', 'size', 'sha256'], 'successor archive staging');
	return { key: framescaperArchiveToken(row.key), size: motionInteger(row.size, 'archive staging size', 1), expiresAt: motionInteger(row.expiresAt, 'archive staging expiry'), sha256: row.sha256 === null ? null : motionDigest(row.sha256) };
}
