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
import { canonicalMediaContentBlob } from '../common/editor/storage/media-content-digest.ts';
import { resolveScapeBlobMaximumBytes } from '../common/editor/scape-export-estimate.ts';
import { digestFramescaperMigrationArchive } from './editor-project-successor-archive.ts';
import { readFramescaperArchiveCustody, stageFramescaperArchiveCustody, type FramescaperArchiveStage } from './editor-project-successor-archive-custody.ts';
import { FRAMESCAPER_ARCHIVE_STORES } from './editor-project-successor-archive-record.ts';
import { openFramescaperSuccessorDatabase } from './editor-project-successor-database.ts';
import { assertFramescaperSuccessorLine, normalizeFramescaperSuccessorProject, type FramescaperSuccessorProject } from './editor-project-successor.ts';
import { withFramescaperSuccessorPortableArchive } from './editor-project-successor-portable-inspect.ts';
import { hydrateFramescaperSuccessorPortableMedia } from './editor-project-successor-portable-hydration.ts';
import { createFramescaperLinkOwnerRecord } from './editor-composition-link-owner-record.ts';
import { createFramescaperLinkedAssetDescriptor } from './editor-project-successor-link-assets.ts';
import { preflightScapeImportCapacity, type ScapeImportCapacityOptions } from '../common/editor/scape-import-capacity.ts';
import { framescaperLinkRevisionKey, putFramescaperLinkState } from './editor-composition-link-records.ts';
import { createStableId } from '../common/editor/stable-id.js';
import type { ScapeReplaceWriteAuthority } from '../common/editor/scape-import-transaction.ts';
import { bindFramescaperSuccessorPortableProject, planFramescaperSuccessorPortableStorageBindings, type FramescaperSuccessorPortableBinding } from './editor-project-successor-portable-rebinding.ts';
import { assertFramescaperSuccessorPortableIdentityAbsent, framescaperSuccessorPortableIdentityOccupied, captureFramescaperSuccessorPortableReplacement, retainFramescaperSuccessorPreviousPortableArchive } from './editor-project-successor-portable-publication.ts';

export interface FramescaperSuccessorPortableCustody {
	readonly kind: 'framescaper-successor-portable-v1' | 'framescaper-successor-portable-v2'; readonly id: string; readonly archive: ScapeProjectInput;
	readonly archiveDigest: string; readonly project: FramescaperSuccessorProject;
	readonly binding?: FramescaperSuccessorPortableBinding;
}
export interface FramescaperSuccessorPortableImportOptions {
	readonly indexedDB?: IDBFactory; readonly line: unknown; readonly signal?: AbortSignal; readonly maximumArchiveBlobBytes?: number;
	readonly assertCurrent?: () => void;
	readonly estimateStorageForPreflight?: ScapeImportCapacityOptions['estimateStorageForPreflight'];
	readonly collision?: string;
	readonly acquireReplaceProjectWriteAuthority?: (projectId: string) => Promise<ScapeReplaceWriteAuthority>;
}
const STORES = ['owners', 'projects', 'pending', 'portableArchives', 'linkStates', 'linkRevisions', 'assets', 'chunks', 'staging', ...FRAMESCAPER_ARCHIVE_STORES] as const;

/** New immutable archive custody is separate from original-v1 migration custody, including on failed owner publication. */
export async function importFramescaperSuccessorPortableArchive(input: ScapeProjectInput, media: AudioEditorProjectStore, options: FramescaperSuccessorPortableImportOptions) {
	assertFramescaperSuccessorLine(options.line); assertEditorProjectStoreProfile(media, FRAMESCAPER_SUCCESSOR_MEDIA_STORAGE_PROFILE);
	if (options.indexedDB !== undefined && options.indexedDB !== media.indexedDB) throw new TypeError('Portable import requires the same successor IndexedDB authority.');
	const { signal } = options; signal?.throwIfAborted(); await media.ready();
	if (!media.getStatus().persistent) throw new Error('Portable successor import requires durable ordinary media storage.');
	const admitted = admitArchive(input, options.maximumArchiveBlobBytes);
	const database = await openFramescaperSuccessorDatabase(media.indexedDB ?? globalThis.indexedDB, options.line);
	const assets = new MotionAssetRepository(async () => database); const stages: MotionAssetStaging[] = [];
	let authority: ScapeReplaceWriteAuthority | undefined; const archiveStages: FramescaperArchiveStage[] = [];
	try {
		const archiveStage = await stageFramescaperArchiveCustody(database, admitted, undefined, signal); archiveStages.push(archiveStage);
		const archive = archiveStage.source; const archiveDigest = archiveStage.reference.sha256;
		return await withFramescaperSuccessorPortableArchive(archive, signal, async (envelope, closure) => {
			const occupied = await transact(database, STORES, 'readonly', stores => framescaperSuccessorPortableIdentityOccupied(stores, closure.project.id));
			const collision = occupied ? options.collision ?? 'cancel' : null;
			if (collision !== null && collision !== 'copy' && collision !== 'replace') throw new RangeError('Successor import identity already has retained owner custody.');
			if (collision === 'replace') {
				if (!options.acquireReplaceProjectWriteAuthority) throw new TypeError('Successor replace requires project write authority.');
				authority = await options.acquireReplaceProjectWriteAuthority(closure.project.id);
			}
			let previousArchiveStage: FramescaperArchiveStage | undefined;
			if (authority) {
				const value: unknown = await transact(database, ['portableArchives'], 'readonly', stores => request(stores.portableArchives.get(closure.project.id)));
				if (value !== undefined) {
					const prior = motionRecord(value, ['kind', 'id', 'archive', 'archiveDigest', 'project', 'binding'], 'previous portable custody', ['kind', 'id', 'archive', 'archiveDigest', 'project']);
					if (prior.archive instanceof Blob) { previousArchiveStage = await stageFramescaperArchiveCustody(database, prior.archive, motionDigest(prior.archiveDigest), signal); archiveStages.push(previousArchiveStage); }
				}
			}
			const replacement = authority ? await transact(database, STORES, 'readonly', stores => captureFramescaperSuccessorPortableReplacement(stores, closure.project.id, authority!)) : null;
			const rebound = bindFramescaperSuccessorPortableProject(closure, {
				copy: collision === 'copy' ? { id: createStableId('project'), timestamp: new Date().toISOString() } : null,
				storageSourceIds: await planFramescaperSuccessorPortableStorageBindings(closure, media, signal),
			});
			const owner = createFramescaperLinkOwnerRecord(rebound.project);
			if (!replacement) await transact(database, STORES, 'readonly', stores => assertFramescaperSuccessorPortableIdentityAbsent(stores, owner.id));
			// Archive and legacy-history staging already consume live origin usage; admit only the remaining allocations.
			await preflightScapeImportCapacity(envelope.manifest, {
				signal, estimateStorageForPreflight: options.estimateStorageForPreflight, estimateStorage: () => media.estimateStorage(),
			});
			await hydrateFramescaperSuccessorPortableMedia(envelope, closure, media, signal, owner.project);
			for (const asset of closure.linked) {
				signal?.throwIfAborted(); const stage = await assets.stage(asset); stages.push(stage);
				const entry = envelope.entryByName.get(createFramescaperLinkedAssetDescriptor(asset).entry)!;
				if (!entry.getData) throw new RangeError('Linked archive original is unavailable.');
				await entry.getData(new WritableStream<Uint8Array>({ async write(chunk) {
					if (!(chunk instanceof Uint8Array)) throw new RangeError('Linked archive body is not bytes.');
					for (let offset = 0; offset < chunk.length; offset += 4 * 1024 * 1024) { signal?.throwIfAborted(); await stage.write(chunk.slice(offset, offset + 4 * 1024 * 1024)); }
				} }), { signal, strictness: 'strict' }); await stage.finish();
			}
			const hasBinding = rebound.binding.copy !== null || rebound.binding.storageSourceIds.length > 0;
			const custody = { kind: hasBinding ? 'framescaper-successor-portable-v2' : 'framescaper-successor-portable-v1', id: owner.id, archive: archiveStage.reference, archiveDigest, project: owner.project, ...(hasBinding ? { binding: rebound.binding } : {}) };
			await transact(database, STORES, 'readwrite', async stores => {
				signal?.throwIfAborted(); options.assertCurrent?.();
				if (replacement) {
					const current = await captureFramescaperSuccessorPortableReplacement(stores, owner.id, authority!);
					if (current.ownerDigest !== replacement.ownerDigest) throw new RangeError('Successor replacement owner changed before publication.');
					await retainFramescaperSuccessorPreviousPortableArchive(stores, owner.id, previousArchiveStage);
				} else await assertFramescaperSuccessorPortableIdentityAbsent(stores, owner.id);
				await archiveStage.publish(stores);
				for (const stage of stages) await stage.publish(stores);
				for (const link of owner.project.compositionLinks) {
					for (const asset of link.snapshot.project.assets) await assets.assertAvailable(stores, asset);
					const state = createMotionCompositionLinkState(createMotionCompositionOffer(link.compositionId, link.snapshot));
					await request(stores.linkRevisions.put({ key: framescaperLinkRevisionKey(link.projectId, link.acceptedDigest), snapshot: link.snapshot }));
					await putFramescaperLinkState(stores, owner.id, link.sourceId, state);
				}
				await request(stores.portableArchives.put(custody)); await request(stores.owners.put({ ...owner, ...(authority ? { writeFence: authority.writeFence } : {}) })); signal?.throwIfAborted(); options.assertCurrent?.(); authority?.assertCurrent();
			});
			for (const stage of archiveStages) await stage.rollback();
			return { project: owner.project, manifest: envelope.manifest, readOnly: false as const, reason: null, collision, publicationCommitted: true as const };
		});
	} catch (error) {
		const failures: unknown[] = []; for (const stage of [...stages, ...archiveStages]) { try { await stage.rollback(); } catch (failure) { failures.push(failure); } }
		if (failures.length) throw new AggregateError([error, ...failures], 'Successor portable import and private cleanup failed.', { cause: error }); throw error;
	} finally { database.close(); await authority?.release(); }
}

/** Validate the retained variant before it can be used for recovery. Original migration records are never rewritten. */
export function loadFramescaperSuccessorPortableCustody(id: string, options: FramescaperSuccessorPortableImportOptions): Promise<FramescaperSuccessorPortableCustody | null> {
	return withPortableCustody(id, options, async record => record);
}
export function restoreFramescaperSuccessorPortableCustody(id: string, media: AudioEditorProjectStore, options: FramescaperSuccessorPortableImportOptions): Promise<string | null> {
	assertEditorProjectStoreProfile(media, FRAMESCAPER_SUCCESSOR_MEDIA_STORAGE_PROFILE);
	return withPortableCustody(id, options, async (record, envelope, closure) => { await hydrateFramescaperSuccessorPortableMedia(envelope, closure, media, options.signal, record.project); return record.archiveDigest; });
}
async function withPortableCustody<T>(id: string, options: FramescaperSuccessorPortableImportOptions, action: (record: FramescaperSuccessorPortableCustody, envelope: ScapeArchiveEnvelope, closure: ReturnType<typeof admitFramescaperSuccessorPortableEnvelope>) => Promise<T>): Promise<T | null> {
	motionId(id); options.signal?.throwIfAborted(); const database = await openFramescaperSuccessorDatabase(options.indexedDB ?? globalThis.indexedDB, options.line);
	try {
		const stored: unknown = await transact(database, ['portableArchives'], 'readonly', stores => request(stores.portableArchives.get(id)));
		if (stored === undefined) return null; const record = motionRecord(stored, ['kind', 'id', 'project', 'archiveDigest', 'archive', 'binding'], 'successor portable custody', ['kind', 'id', 'project', 'archiveDigest', 'archive']);
		if ((record.kind !== 'framescaper-successor-portable-v1' && record.kind !== 'framescaper-successor-portable-v2') || motionId(record.id) !== id) throw new RangeError('Successor portable custody identity changed.');
		const project = normalizeFramescaperSuccessorProject(record.project); const archiveDigest = motionDigest(record.archiveDigest);
		const archive = readFramescaperArchiveCustody(record.archive, archiveDigest, options.indexedDB ?? globalThis.indexedDB);
		if (project.id !== id || await digestFramescaperMigrationArchive(archive, options.signal) !== archiveDigest) throw new RangeError('Successor portable custody bytes changed.');
		return withFramescaperSuccessorPortableArchive(archive, options.signal, async (envelope, closure) => {
			const rebound = record.kind === 'framescaper-successor-portable-v2' ? bindFramescaperSuccessorPortableProject(closure, record.binding) : null;
			if (record.kind === 'framescaper-successor-portable-v1' && record.binding !== undefined) throw new RangeError('Original portable custody cannot contain rebound identities.');
			if (JSON.stringify(rebound?.project ?? closure.project) !== JSON.stringify(project)) throw new RangeError('Successor portable custody project changed.');
			return action({ kind: record.kind as FramescaperSuccessorPortableCustody['kind'], id, project, archive, archiveDigest, ...(rebound ? { binding: rebound.binding } : {}) }, envelope, closure);
		});
	} finally { database.close(); }
}
function admitArchive(input: ScapeProjectInput, maximum: number | undefined): ScapeProjectInput {
	const limit = resolveScapeBlobMaximumBytes(maximum);
	if (input instanceof Blob) input = canonicalMediaContentBlob(input); else assertScapeArchiveByteSource(input);
	if (input.size > limit) throw new RangeError('Successor portable custody exceeds its archive Blob admission.');
	return input;
}
