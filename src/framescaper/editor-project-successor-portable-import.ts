/* SPDX-License-Identifier: AGPL-3.0-only */
import { assertEditorProjectStoreProfile } from '../common/editor/storage/project-store-profile-binding.ts';
import { FRAMESCAPER_SUCCESSOR_MEDIA_STORAGE_PROFILE } from './editor-project-successor-runtime-profile.ts';
import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import { MotionAssetRepository, type MotionAssetStaging } from '../common/editor/storage/motion-asset-repository.ts';
import { request, transact } from '../common/editor/storage/indexeddb-backend.ts';
import { createMotionCompositionOffer } from '../common/editor/motion-link-protocol.ts';
import { createMotionCompositionLinkState } from '../common/editor/motion-link-state.ts';
import { motionDigest, motionId, motionRecord } from '../common/editor/motion-values.ts';
import type { ScapeArchiveEnvelope } from '../common/editor/scape-archive-envelope.ts';
import type { admitFramescaperSuccessorPortableEnvelope } from './editor-project-successor-portable-inspect.ts';
import type { ScapeProjectInput } from '../common/editor/scape-project-input.ts';
import { assertScapeArchiveByteSource } from '../common/editor/scape-archive-byte-source.ts';
import { canonicalMediaContentBlob, digestMediaContent } from '../common/editor/storage/media-content-digest.ts';
import { resolveScapeBlobMaximumBytes } from '../common/editor/scape-export-estimate.ts';
import { openFramescaperSuccessorDatabase } from './editor-project-successor-database.ts';
import { assertFramescaperSuccessorLine, normalizeFramescaperSuccessorProject, type FramescaperSuccessorProject } from './editor-project-successor.ts';
import { withFramescaperSuccessorPortableArchive } from './editor-project-successor-portable-inspect.ts';
import { hydrateFramescaperSuccessorPortableMedia } from './editor-project-successor-portable-hydration.ts';
import { createFramescaperLinkOwnerRecord } from './editor-composition-link-owner-record.ts';
import { createFramescaperLinkedAssetDescriptor } from './editor-project-successor-link-assets.ts';
import { framescaperLinkRevisionKey, putFramescaperLinkState } from './editor-composition-link-records.ts';

export interface FramescaperSuccessorPortableCustody {
	readonly kind: 'framescaper-successor-portable-v1'; readonly id: string; readonly archive: Blob;
	readonly archiveDigest: string; readonly project: FramescaperSuccessorProject;
}
export interface FramescaperSuccessorPortableImportOptions {
	readonly indexedDB?: IDBFactory; readonly line: unknown; readonly signal?: AbortSignal; readonly maximumArchiveBlobBytes?: number;
}
const STORES = ['owners', 'projects', 'pending', 'portableArchives', 'linkStates', 'linkRevisions', 'assets', 'chunks', 'staging'] as const;

/** New immutable archive custody is separate from original-v1 migration custody, including on failed owner publication. */
export async function importFramescaperSuccessorPortableArchive(input: ScapeProjectInput, media: AudioEditorProjectStore, options: FramescaperSuccessorPortableImportOptions) {
	assertFramescaperSuccessorLine(options.line); assertEditorProjectStoreProfile(media, FRAMESCAPER_SUCCESSOR_MEDIA_STORAGE_PROFILE);
	if (options.indexedDB !== undefined && options.indexedDB !== media.indexedDB) throw new TypeError('Portable import requires the same successor IndexedDB authority.');
	const { signal } = options; signal?.throwIfAborted(); await media.ready();
	if (!media.getStatus().persistent) throw new Error('Portable successor import requires durable ordinary media storage.');
	const archive = await retainArchive(input, options.maximumArchiveBlobBytes, signal);
	const database = await openFramescaperSuccessorDatabase(media.indexedDB ?? globalThis.indexedDB, options.line);
	const assets = new MotionAssetRepository(async () => database); const stages: MotionAssetStaging[] = [];
	async function assertAbsent(stores: Record<string, IDBObjectStore>, id: string) {
		for (const name of ['owners', 'projects', 'pending', 'portableArchives']) if (await request(stores[name]!.get(id)) !== undefined) throw new RangeError('Successor import identity already has retained owner custody.');
	}
	try {
		const archiveDigest = await digestMediaContent(archive, { signal });
		return await withFramescaperSuccessorPortableArchive(archive, signal, async (envelope, closure) => {
			const owner = createFramescaperLinkOwnerRecord(closure.project); await transact(database, STORES, 'readonly', stores => assertAbsent(stores, owner.id));
			await hydrateFramescaperSuccessorPortableMedia(envelope, closure, media, signal);
			for (const asset of closure.linked) {
				signal?.throwIfAborted(); const stage = await assets.stage(asset); stages.push(stage);
				const entry = envelope.entryByName.get(createFramescaperLinkedAssetDescriptor(asset).entry)!;
				if (!entry.getData) throw new RangeError('Linked archive original is unavailable.');
				await entry.getData(new WritableStream<Uint8Array>({ async write(chunk) {
					if (!(chunk instanceof Uint8Array)) throw new RangeError('Linked archive body is not bytes.');
					for (let offset = 0; offset < chunk.length; offset += 4 * 1024 * 1024) { signal?.throwIfAborted(); await stage.write(chunk.slice(offset, offset + 4 * 1024 * 1024)); }
				} }), { signal, strictness: 'strict' }); await stage.finish();
			}
			const custody: FramescaperSuccessorPortableCustody = { kind: 'framescaper-successor-portable-v1', id: owner.id, archive, archiveDigest, project: closure.project };
			await transact(database, STORES, 'readwrite', async stores => {
				signal?.throwIfAborted(); await assertAbsent(stores, owner.id);
				for (const stage of stages) await stage.publish(stores);
				for (const link of owner.project.compositionLinks) {
					for (const asset of link.snapshot.project.assets) await assets.assertAvailable(stores, asset);
					const state = createMotionCompositionLinkState(createMotionCompositionOffer(link.compositionId, link.snapshot));
					await request(stores.linkRevisions.put({ key: framescaperLinkRevisionKey(link.projectId, link.acceptedDigest), snapshot: link.snapshot }));
					await putFramescaperLinkState(stores, owner.id, link.sourceId, state);
				}
				await request(stores.portableArchives.add(custody)); await request(stores.owners.put(owner)); signal?.throwIfAborted();
			});
			return { project: owner.project, manifest: envelope.manifest, readOnly: false as const, reason: null, collision: null, publicationCommitted: true as const };
		});
	} catch (error) {
		const failures: unknown[] = []; for (const stage of stages) { try { await stage.rollback(); } catch (failure) { failures.push(failure); } }
		if (failures.length) throw new AggregateError([error, ...failures], 'Successor portable import and private cleanup failed.', { cause: error }); throw error;
	} finally { database.close(); }
}

/** Validate the retained variant before it can be used for recovery. Original migration records are never rewritten. */
export function loadFramescaperSuccessorPortableCustody(id: string, options: FramescaperSuccessorPortableImportOptions): Promise<FramescaperSuccessorPortableCustody | null> {
	return withPortableCustody(id, options, async record => record);
}
export function restoreFramescaperSuccessorPortableCustody(id: string, media: AudioEditorProjectStore, options: FramescaperSuccessorPortableImportOptions): Promise<string | null> {
	assertEditorProjectStoreProfile(media, FRAMESCAPER_SUCCESSOR_MEDIA_STORAGE_PROFILE);
	return withPortableCustody(id, options, async (record, envelope, closure) => { await hydrateFramescaperSuccessorPortableMedia(envelope, closure, media, options.signal); return record.archiveDigest; });
}
async function withPortableCustody<T>(id: string, options: FramescaperSuccessorPortableImportOptions, action: (record: FramescaperSuccessorPortableCustody, envelope: ScapeArchiveEnvelope, closure: ReturnType<typeof admitFramescaperSuccessorPortableEnvelope>) => Promise<T>): Promise<T | null> {
	motionId(id); options.signal?.throwIfAborted(); const database = await openFramescaperSuccessorDatabase(options.indexedDB ?? globalThis.indexedDB, options.line);
	try {
		const stored: unknown = await transact(database, ['portableArchives'], 'readonly', stores => request(stores.portableArchives.get(id)));
		if (stored === undefined) return null; const record = motionRecord(stored, ['kind', 'id', 'project', 'archiveDigest', 'archive'], 'successor portable custody');
		if (record.kind !== 'framescaper-successor-portable-v1' || motionId(record.id) !== id) throw new RangeError('Successor portable custody identity changed.');
		const project = normalizeFramescaperSuccessorProject(record.project); const archive = canonicalMediaContentBlob(record.archive); const archiveDigest = motionDigest(record.archiveDigest);
		if (project.id !== id || await digestMediaContent(archive, { signal: options.signal }) !== archiveDigest) throw new RangeError('Successor portable custody bytes changed.');
		return withFramescaperSuccessorPortableArchive(archive, options.signal, async (envelope, closure) => {
			if (JSON.stringify(closure.project) !== JSON.stringify(project)) throw new RangeError('Successor portable custody project changed.');
			return action({ kind: 'framescaper-successor-portable-v1', id, project, archive, archiveDigest }, envelope, closure);
		});
	} finally { database.close(); }
}
async function retainArchive(input: ScapeProjectInput, maximum: number | undefined, signal?: AbortSignal): Promise<Blob> {
	const limit = resolveScapeBlobMaximumBytes(maximum);
	if (input instanceof Blob) input = canonicalMediaContentBlob(input); else assertScapeArchiveByteSource(input);
	if (input.size > limit) throw new RangeError('Successor portable custody exceeds its archive Blob admission.');
	if (input instanceof Blob) return canonicalMediaContentBlob(input);
	assertScapeArchiveByteSource(input); const chunks: Uint8Array<ArrayBuffer>[] = []; let offset = 0;
	while (offset < input.size) {
		signal?.throwIfAborted(); const bytes = await input.read({ offset, length: Math.min(4 * 1024 * 1024, input.maximumReadBytes, input.size - offset), signal });
		chunks.push(bytes.slice()); offset += bytes.length;
	}
	signal?.throwIfAborted(); return new Blob(chunks, { type: 'application/vnd.framescaper.scape+zip' });
}
