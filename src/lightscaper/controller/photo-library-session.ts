/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray } from '../../common/editor/closed-domain-value.ts';
import type { PhotoLibraryAttributePatchV1, PhotoLibraryImportItemV1, PhotoLibraryMetadataPatchV1, PhotoLibraryMetadataSnapshotV1, PhotoLibraryDefinitionPageRequestV1, PhotoLibraryDefinitionPageV1, PhotoLibraryQueryBuildProgressV1, PhotoLibraryQueryStepV1, PhotoLibraryQueryV1, PhotoLibraryPreviewOutcomeV1, PhotoLibraryPreviewTierV1, PhotoLibraryPageV1, PhotoLibraryRowV1, PhotoLibrarySessionPortV1 } from '../../common/editor/photo-library-session-port-v1.ts';
import type { PhotoLibraryDefinitionAcknowledgementV1, PhotoLibraryDefinitionCommandV1, PhotoLibraryDefinitionReadRequestV1, PhotoLibraryDefinitionSnapshotV1,
	PhotoLibraryMembershipAcknowledgementV1, PhotoLibraryMembershipPatchV1, PhotoLibraryMembershipSnapshotV1 } from '../../common/editor/photo-library-organization-port-v1.ts';
import type { PhotoLibraryImportPresetCommandV1, PhotoLibraryImportPresetSnapshotV1, PhotoLibraryImportRequestOptionsV1 } from '../../common/editor/photo-library-import-settings-port-v1.ts';
import type { PhotoLibraryBackupOptionsV1, PhotoLibraryBackupPortV1, PhotoLibraryBackupResultV1 } from '../../common/editor/photo-library-backup-port-v1.ts';
import type { PhotoLibraryBatchRenamePortV1, PhotoLibraryBatchRenameRequestV1, PhotoLibraryBatchRenamePlanV1,
	PhotoLibraryBatchRenameUndoV1, PhotoLibraryBatchRenameReceiptV1, PhotoLibraryBatchRenameSnapshotV1 } from '../../common/editor/photo-library-batch-rename-port-v1.ts';
import { IMAGE_IMPORT_LIMITS } from '../../common/editor/image-import-admission.ts';
import { normalizePhotoCatalogRootV1 } from '../catalog/catalog-root.ts';
import { normalizePhotoDocumentV1 } from '../catalog/photo-document.ts';
import { PhotoCatalogRevisionConflictError, type PhotoCatalogContinuationV1 } from '../catalog/repository-types.ts';
import { LIGHTSCAPER_CATALOG_LIMITS } from '../catalog/types.ts';
import { field, id, integer, name, oneOf, record } from '../catalog/value-validation.ts';
import { withPhotoCatalogWriteLockV1 } from '../import/catalog-write-lock-v1.ts';
import { importManagedPhotosV1, recoverManagedPhotoImportV1 } from '../import/managed-import-v1.ts';
import type { PhotoManagedImportPortsV1, PhotoManagedImportReceiptV1 } from '../import/managed-import-ports-v1.ts';
import { preparePhotoImportGestureV1 } from '../import/photo-import-preparation-v1.ts';
import { applyPhotoImportSettingsV1, planPhotoImportSettingsV1 } from '../import/photo-import-settings-v1.ts';
import { applyPhotoImportPresetV1, normalizePhotoImportPresetCommandV1, readPhotoImportPresetsV1 } from '../storage/photo-import-presets-v1.ts';
import { PhotoCommandOwnerV1 } from './photo-command-owner.ts';
import { normalizePhotoLibraryAttributesV1 } from './photo-library-attributes.ts';
import { normalizePhotoLibraryMetadataPatchV1, readPhotoLibraryMetadataSnapshotV1 } from './photo-library-metadata.ts';
import { admitPhotoLibraryQueryBuildRequestV1, admitPhotoLibraryQueryStepRequestV1, readPhotoLibraryQueryStepV1, rebuildPhotoLibraryQueryStepV1 } from './photo-library-query-v1.ts';
import { admitPhotoLibraryDefinitionPageRequestV1, readPhotoLibraryDefinitionPageV1 } from './photo-library-definition-pages-v1.ts';
import { normalizePhotoLibraryDefinitionReadRequestV1, normalizePhotoLibraryDefinitionMutationV1,
	readPhotoLibraryDefinitionV1, applyPhotoLibraryDefinitionV1 } from './photo-library-organizer-v1.ts';
import { normalizePhotoLibraryMembershipReadV1, normalizePhotoLibraryMembershipMutationV1,
	readPhotoLibraryMembershipsV1, applyPhotoLibraryMembershipsV1 } from './photo-library-memberships-v1.ts';
import type { PhotoLibraryPreparationOutcomeV1, PhotoLibraryPreviewSchedulerPortV1, PhotoLibrarySessionPortsV1 } from './photo-library-session-ports.ts';
import { admitPhotoLibraryImportRequestV1 } from './photo-library-import-request.ts';
import { admitPhotoLibraryBackupRequestV1 } from './photo-library-backup-request.ts';
import { planPhotoLibraryBatchRenameV1, readPhotoLibraryBatchRenameSelectionV1, renamePhotoLibraryBatchV1,
	undoPhotoLibraryBatchRenameV1, type PhotoBatchRenameSessionPortsV1 } from './photo-library-batch-rename-v1.ts';

/** Product session owns lifetime, bounded presentation pages and a single writer. */
export class PhotoLibrarySessionV1 implements PhotoLibrarySessionPortV1, PhotoLibraryBatchRenamePortV1, PhotoLibraryBackupPortV1 {
	readonly #ports: PhotoLibrarySessionPortsV1;
	readonly #lifetime = new AbortController();
	readonly #pending = new Set<Promise<unknown>>();
	#catalog: Promise<string> | null = null;
	#photo: PhotoCommandOwnerV1 | null = null;
	#previews: Promise<PhotoLibraryPreviewSchedulerPortV1> | null = null;
	#writing = false;
	#presetActive = false;
	#closed = false;
	#closing: Promise<void> | null = null;

	constructor(ports: PhotoLibrarySessionPortsV1) { this.#ports = ports; }

	async backupCatalog(options: PhotoLibraryBackupOptionsV1 = {}): Promise<PhotoLibraryBackupResultV1> {
		const request = admitPhotoLibraryBackupRequestV1(options), backup = this.#ports.backup;
		if (!backup) throw new Error('Photo catalog backup is unavailable.');
		const completed: { result: PhotoLibraryBackupResultV1 | null } = { result: null };
		try {
			return await this.#mutation(async (catalogId, signal) => {
				signal.throwIfAborted();
				const { exportPhotoLibraryBackupV1 } = await import('./photo-library-backup-v1.ts');
				signal.throwIfAborted();
				const result = await exportPhotoLibraryBackupV1(catalogId, {
					catalog: { readSnapshot: (...args) => backup.readSnapshot(...args),
						readSummaryPage: (...args) => this.#ports.catalog.readSummaryPage(...args),
						loadPhoto: (...args) => this.#ports.catalog.loadPhoto(...args) },
					loadOriginal: (original, admitted) => backup.loadOriginal(original, admitted),
				}, { ...request, signal });
				completed.result = Object.freeze({ catalogId, catalogName: result.document.catalog.name, photoCount: result.document.catalog.photoCount,
					byteLength: result.byteLength, blob: result.blob, notices: Object.freeze([]) });
				return completed.result;
			}, request.signal);
		} catch (error) {
			if (completed.result === null) throw error;
			return Object.freeze({ ...completed.result, notices: Object.freeze(['cleanup-failed'] as const) });
		}
	}

	readBatchRenameSelection(photoIds: readonly string[], options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryBatchRenameSnapshotV1> {
		return readPhotoLibraryBatchRenameSelectionV1(this.#batchRenamePorts(), photoIds, options);
	}

	planBatchRename(request: PhotoLibraryBatchRenameRequestV1): PhotoLibraryBatchRenamePlanV1 {
		if (this.#closed) throw new Error('The photo library is closed.');
		return planPhotoLibraryBatchRenameV1(request);
	}

	renamePhotos(plan: PhotoLibraryBatchRenamePlanV1, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryBatchRenameReceiptV1> {
		return renamePhotoLibraryBatchV1(this.#batchRenamePorts(), plan, options);
	}

	undoBatchRename(undo: PhotoLibraryBatchRenameUndoV1, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryBatchRenameReceiptV1> {
		return undoPhotoLibraryBatchRenameV1(this.#batchRenamePorts(), undo, options);
	}

	#batchRenamePorts(): PhotoBatchRenameSessionPortsV1 {
		return { repository: this.#ports.catalog, mutate: (run, signal) => this.#mutation(run, signal),
			withPhoto: (catalogId, photoId, signal, run) => this.#withPhoto(catalogId, photoId, signal, run) };
	}

	async readQueryStep(options: Readonly<{ query: PhotoLibraryQueryV1; cursor?: string | null; signal?: AbortSignal }>): Promise<PhotoLibraryQueryStepV1> {
		const request = admitPhotoLibraryQueryStepRequestV1(options);
		return this.#operation(async signal => {
			const catalogId = await this.#ready(); signal.throwIfAborted();
			return readPhotoLibraryQueryStepV1(this.#ports.catalog, catalogId, { ...request, signal });
		}, request.signal);
	}

	async rebuildQueryStep(options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryQueryBuildProgressV1> {
		const request = admitPhotoLibraryQueryBuildRequestV1(options);
		return this.#operation(async signal => {
			const catalogId = await this.#ready(); signal.throwIfAborted();
			return rebuildPhotoLibraryQueryStepV1(this.#ports.catalog, catalogId, { signal });
		}, request.signal);
	}

	async readDefinitionPage(options: PhotoLibraryDefinitionPageRequestV1): Promise<PhotoLibraryDefinitionPageV1> {
		const request = admitPhotoLibraryDefinitionPageRequestV1(options);
		return this.#operation(async signal => {
			const catalogId = await this.#ready(); signal.throwIfAborted();
			return readPhotoLibraryDefinitionPageV1(this.#ports.catalog, catalogId, { ...request, signal });
		}, request.signal);
	}

	async readDefinition(options: PhotoLibraryDefinitionReadRequestV1): Promise<PhotoLibraryDefinitionSnapshotV1> {
		const request = normalizePhotoLibraryDefinitionReadRequestV1(options);
		return this.#operation(async signal => {
			const catalogId = await this.#ready(); signal.throwIfAborted();
			return readPhotoLibraryDefinitionV1(this.#ports.catalog, catalogId, { ...request, signal });
		}, request.signal);
	}

	async applyDefinition(expectedRootRevision: number, command: PhotoLibraryDefinitionCommandV1,
		options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryDefinitionAcknowledgementV1> {
		const request = normalizePhotoLibraryDefinitionMutationV1(expectedRootRevision, command, options);
		return this.#mutation((catalogId, signal) => applyPhotoLibraryDefinitionV1(this.#ports.catalog, catalogId,
			request.expectedRootRevision, request.command, { signal }), request.signal);
	}

	async readMemberships(photoId: string, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryMembershipSnapshotV1> {
		const request = normalizePhotoLibraryMembershipReadV1(photoId, options);
		return this.#editPhoto(request.photoId, async (owner, signal) => readPhotoLibraryMembershipsV1(owner, request.photoId, { signal }), request.signal);
	}

	async applyMemberships(photoId: string, expectedRevision: number, changes: PhotoLibraryMembershipPatchV1,
		options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryMembershipAcknowledgementV1> {
		const request = normalizePhotoLibraryMembershipMutationV1(photoId, expectedRevision, changes, options);
		return this.#editPhoto(request.photoId, (owner, signal) => applyPhotoLibraryMembershipsV1(owner, request.photoId,
			request.expectedRevision, request.changes, { signal }), request.signal);
	}

	async readPreview(photoId: string, tier: PhotoLibraryPreviewTierV1,
		options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryPreviewOutcomeV1> {
		const key = id(photoId, 'photo ID'), admittedTier = oneOf(tier, ['thumbnail', 'fit-screen'] as const, 'preview tier');
		return this.#operation(async signal => {
			const catalogId = await this.#ready(); signal.throwIfAborted();
			if (!this.#ports.createPreviewScheduler) throw new Error('Photo preview is unavailable.');
			if (!this.#previews) {
				const pending = this.#ports.createPreviewScheduler(catalogId);
				this.#previews = pending;
				void pending.catch(() => { if (this.#previews === pending) this.#previews = null; });
			}
			const scheduler = await this.#previews; signal.throwIfAborted();
			const result = await scheduler.request({ photoId: key, tier: admittedTier, signal });
			signal.throwIfAborted();
			if (result.outcome !== 'ready') return Object.freeze({ outcome: result.outcome });
			const notices: Array<'persistence-failed' | 'cleanup-failed'> = [];
			if (result.cache === 'transient' || result.persistenceError !== undefined) notices.push('persistence-failed');
			if (result.cleanupErrors?.length) notices.push('cleanup-failed');
			return Object.freeze({ outcome: 'ready', cache: result.cache, notices: Object.freeze(notices),
				preview: Object.freeze({ photoId: key, tier: admittedTier, descriptor: result.preview.descriptor,
					byteLength: result.preview.byteLength, outputSha256: result.preview.outputSha256, body: result.preview.body }) });
		}, options.signal);
	}

	async readPage(options: Readonly<{ cursor?: string | null; signal?: AbortSignal }> = {}): Promise<PhotoLibraryPageV1> {
		const continuation = readCursor(options.cursor);
		return this.#operation(async signal => {
			const catalogId = await this.#ready(); signal.throwIfAborted();
			const root = await this.#ports.catalog.loadCatalog(catalogId);
			if (!root) throw new ReferenceError('Photo catalog is missing.');
			const page = await this.#ports.catalog.readSummaryPage(catalogId, { continuation, signal });
			signal.throwIfAborted();
			return Object.freeze({ catalogName: root.name, totalCount: root.photoCount,
				rows: Object.freeze(page.items.map(row => Object.freeze({ id: row.photoId, fileName: row.fileName,
					width: row.width, height: row.height, rating: row.rating, flag: row.flag, colorLabel: row.colorLabel }))),
				cursor: page.continuation === null ? null : JSON.stringify(page.continuation) });
		}, options.signal);
	}

	async readImportPresets(options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryImportPresetSnapshotV1> {
		const request = admitPhotoLibraryQueryBuildRequestV1(options), settings = this.#ports.settings;
		if (!settings) throw new Error('Photo import presets are unavailable.');
		return this.#presetOperation(() => this.#operation(async signal => {
			const catalogId = await this.#ready(); signal.throwIfAborted();
			return readPhotoImportPresetsV1(settings, catalogId, { signal });
		}, request.signal));
	}

	async applyImportPreset(command: PhotoLibraryImportPresetCommandV1,
		options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryImportPresetSnapshotV1> {
		const request = admitPhotoLibraryQueryBuildRequestV1(options), admitted = normalizePhotoImportPresetCommandV1(command), settings = this.#ports.settings;
		if (!settings) throw new Error('Photo import presets are unavailable.');
		return this.#presetOperation(() => this.#mutation(async (catalogId, signal) => {
			const root = await this.#ports.catalog.loadCatalog(catalogId); signal.throwIfAborted();
			if (!root) throw new ReferenceError('Photo catalog is missing.');
			return applyPhotoImportPresetV1(settings, root, admitted, { signal });
		}, request.signal));
	}

	async importFiles(files: readonly File[], options: PhotoLibraryImportRequestOptionsV1 = {}): Promise<readonly PhotoLibraryImportItemV1[]> {
		const request = admitPhotoLibraryImportRequestV1(options);
		const selected = readClosedDomainArray(files, 'selected photo files', 1, IMAGE_IMPORT_LIMITS.maximumFilesPerGesture) as readonly File[];
		return this.#mutation(async (catalogId, signal) => {
			const root = await this.#ports.catalog.loadCatalog(catalogId);
			if (!root) throw new ReferenceError('Photo catalog is missing.');
			const plan = planPhotoImportSettingsV1(selected, root, request.settings);
			const createId = this.#ports.createId ?? (() => crypto.randomUUID());
			const ownership = selected.map(() => ({ photoId: createId(), originalId: createId(), originalStorageKey: createId(), masterVersionId: createId() }));
			const prepared = (this.#ports.prepare ?? preparePhotoImportGestureV1)({ files: selected, ownership, catalog: root,
				createdAt: (this.#ports.now ?? (() => new Date().toISOString()))(), signal });
			const failed: PhotoLibraryImportItemV1[] = [];
			const admitted: Array<{ index: number; fileName: string; hasMetadataNotices: boolean }> = [];
			const acknowledged = new Set<number>();
			const present = (receipt: PhotoManagedImportReceiptV1) => {
				const selection = admitted[receipt.index];
				if (!selection) throw new Error('Photo publication receipt has no selected-file binding.');
				return Object.freeze({ ...receipt, ...selection });
			};
			const acknowledge = (receipt: PhotoManagedImportReceiptV1) => {
				if (receipt.status !== 'imported' || acknowledged.has(receipt.index)) return;
				const item = present(receipt); acknowledged.add(receipt.index);
				try { request.onAcknowledged?.(item); } catch { /* Publication observers cannot veto durable photos. */ }
			};
			const ports = this.#managedPorts();
			// The outer lease owns keyword-definition and photo publication together.
			let receipts: readonly PhotoManagedImportReceiptV1[];
			try {
				receipts = await (this.#ports.importPhotos ?? importManagedPhotosV1)(catalogId, bridge.call(this), {
					...ports, exclusive: async (_id, operation) => operation(signal),
				}, { signal, onPublished: acknowledge });
			} catch (failure) { this.#catalog = null; throw failure; }
			for (const receipt of receipts) acknowledge(receipt);
			const results = [...failed, ...receipts.map(present)].sort((a, b) => a.index - b.index);
			return Object.freeze(results);

			async function* bridge(this: PhotoLibrarySessionV1) {
				for await (const outcome of prepared) {
					signal.throwIfAborted();
					if (outcome.outcome === 'failed') {
						failed.push(Object.freeze({ index: outcome.index, fileName: outcome.fileName, photoId: null,
							status: 'failed', reusedOriginal: false, message: errorMessage(outcome.error), hasMetadataNotices: false }));
						continue;
					}
					try {
						const preparedPhoto = request.settings === undefined ? outcome.photo : applyPhotoImportSettingsV1(outcome.photo, plan, outcome.index);
						const resolved = await this.#keywords(catalogId, { ...outcome, photo: preparedPhoto }, createId, signal);
						const photo = normalizePhotoDocumentV1({ ...preparedPhoto, keywordIds: resolved.ids });
						admitted.push({ index: outcome.index, fileName: outcome.fileName,
							hasMetadataNotices: outcome.notices.length > 0 || (outcome.photo.extractedMetadata?.issues.length ?? 0) > 0 || resolved.notice });
						yield { photo, original: outcome.original };
					} catch (failure) {
						signal.throwIfAborted();
						failed.push(Object.freeze({ index: outcome.index, fileName: outcome.fileName, photoId: null,
							status: 'failed', reusedOriginal: false, message: errorMessage(failure), hasMetadataNotices: true }));
					}
				}
			}
		}, request.signal);
	}

	async setRating(photoId: string, rating: number, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryRowV1> {
		return this.applyAttributes(photoId, { rating }, options);
	}

	async applyAttributes(photoId: string, changes: PhotoLibraryAttributePatchV1, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryRowV1> {
		const key = id(photoId, 'photo ID'), patch = normalizePhotoLibraryAttributesV1(changes);
		return this.#editPhoto(key, async (owner, signal) => {
			const photo = await owner.execute({ type: 'set-attributes', changes: patch }, { signal });
			return Object.freeze({ id: photo.id, fileName: photo.metadata.fileName, rating: photo.rating,
				flag: photo.flag, colorLabel: photo.colorLabel, width: photo.original.width, height: photo.original.height });
		}, options.signal);
	}

	async readMetadata(photoId: string, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryMetadataSnapshotV1> {
		const key = id(photoId, 'photo ID');
		return this.#operation(async signal => {
			const catalogId = await this.#ready(); signal.throwIfAborted();
			const photo = await this.#ports.catalog.loadPhoto(catalogId, key);
			signal.throwIfAborted();
			if (!photo) throw new ReferenceError('The photo is missing.');
			return readPhotoLibraryMetadataSnapshotV1(photo);
		}, options.signal);
	}

	async applyMetadata(photoId: string, expectedRevision: number, changes: PhotoLibraryMetadataPatchV1,
		options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryMetadataSnapshotV1> {
		const key = id(photoId, 'photo ID'), revision = integer(expectedRevision, 0, Number.MAX_SAFE_INTEGER, 'expected photo revision');
		const patch = normalizePhotoLibraryMetadataPatchV1(changes);
		return this.#editPhoto(key, async (owner, signal) => {
			if (owner.history.present.revision !== revision) throw new PhotoCatalogRevisionConflictError('photo');
			return readPhotoLibraryMetadataSnapshotV1(await owner.execute({ type: 'set-metadata', changes: patch }, { signal }));
		}, options.signal);
	}

	async #editPhoto<Result>(key: string, run: (owner: PhotoCommandOwnerV1, signal: AbortSignal) => Promise<Result>, signal?: AbortSignal): Promise<Result> {
		return this.#mutation((catalogId, admitted) => this.#withPhoto(catalogId, key, admitted, run), signal);
	}

	async #withPhoto<Result>(catalogId: string, key: string, admitted: AbortSignal,
		run: (owner: PhotoCommandOwnerV1, signal: AbortSignal) => Promise<Result>): Promise<Result> {
		if (this.#photo?.history.present.id !== key) {
			await this.#photo?.close(); this.#photo = null;
			this.#photo = await PhotoCommandOwnerV1.open(this.#ports.catalog, catalogId, key);
		} else {
			const current = await this.#ports.catalog.loadPhoto(catalogId, key);
			admitted.throwIfAborted();
			if (!current) { await this.#photo.close(); this.#photo = null; throw new ReferenceError('The photo is missing.'); }
			if (current.revision !== this.#photo.history.present.revision) await this.#photo.reload({ signal: admitted });
		}
		try { admitted.throwIfAborted(); return await run(this.#photo, admitted); }
		catch (error) { await this.#photo.close(); this.#photo = null; throw error; }
	}

	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		this.#closed = true; this.#lifetime.abort();
		this.#closing = this.#close(); return this.#closing;
	}

	async #close(): Promise<void> {
		await Promise.allSettled([...this.#pending]);
		const errors: unknown[] = [];
		try { await (await this.#previews)?.close(); } catch (error) { errors.push(error); }
		try { await this.#photo?.close(); } catch (error) { errors.push(error); }
		try { await this.#ports.closeResources(); } catch (error) { errors.push(error); }
		if (errors.length === 1) throw errors[0];
		if (errors.length > 1) throw new AggregateError(errors, 'Photo library cleanup failed.');
	}

	#ready(): Promise<string> {
		if (this.#catalog) return this.#catalog;
		const attempt = (async () => {
			const root = await this.#ports.initialize(this.#lifetime.signal);
			this.#lifetime.signal.throwIfAborted();
			await recoverManagedPhotoImportV1(root.id, this.#managedPorts(), { signal: this.#lifetime.signal });
			return root.id;
		})();
		this.#catalog = attempt;
		void attempt.catch(() => { if (this.#catalog === attempt) this.#catalog = null; });
		return attempt;
	}

	#managedPorts(): PhotoManagedImportPortsV1 {
		return { catalog: this.#ports.catalog, media: this.#ports.media, journal: this.#ports.journal,
			...(this.#ports.exclusive ? { exclusive: this.#ports.exclusive } : {}) };
	}

	async #keywords(catalogId: string, outcome: Extract<PhotoLibraryPreparationOutcomeV1, { outcome: 'prepared' }>, createId: () => string, signal: AbortSignal) {
		const root = await this.#ports.catalog.loadCatalog(catalogId);
		if (!root) throw new ReferenceError('Photo catalog is missing.');
		const keywords = [...root.keywords], ids = [...outcome.photo.keywordIds];
		const encoder = new TextEncoder();
		// Reserve both keyword-definition and photo-publication revision growth.
		let rootBytes = encoder.encode(JSON.stringify({ ...root, revision: root.revision + 2, photoCount: root.photoCount + 1 })).byteLength;
		let notice = false;
		for (const candidate of outcome.keywordNames) {
			let label: string;
			try { label = name(candidate, 'imported keyword'); }
			catch { notice = true; continue; }
			const existing = keywords.find(node => node.name === label && node.parentId === null);
			if (existing && ids.includes(existing.id)) continue;
			if (ids.length >= LIGHTSCAPER_CATALOG_LIMITS.maximumMemberships) { notice = true; continue; }
			if (existing) { if (!ids.includes(existing.id)) ids.push(existing.id); continue; }
			if (keywords.length >= LIGHTSCAPER_CATALOG_LIMITS.maximumKeywords) { notice = true; continue; }
			const keyword = Object.freeze({ id: id(createId(), 'keyword ID'), name: label, parentId: null });
			const additionalBytes = encoder.encode(JSON.stringify(keyword)).byteLength + (keywords.length ? 1 : 0);
			if (rootBytes + additionalBytes > LIGHTSCAPER_CATALOG_LIMITS.maximumDocumentBytes) { notice = true; continue; }
			rootBytes += additionalBytes;
			keywords.push(keyword); ids.push(keyword.id);
		}
		if (keywords.length !== root.keywords.length) await this.#ports.catalog.saveCatalog(normalizePhotoCatalogRootV1({ ...root, keywords }), root.revision, { signal });
		return { ids, notice };
	}

	async #presetOperation<Result>(run: () => Promise<Result>): Promise<Result> {
		if (this.#presetActive) throw new Error('A photo import preset operation is already pending.');
		this.#presetActive = true;
		try { return await run(); }
		finally { this.#presetActive = false; }
	}

	async #mutation<Result>(run: (catalogId: string, signal: AbortSignal) => Promise<Result>, signal?: AbortSignal): Promise<Result> {
		if (this.#writing) throw new Error('A photo library change is already pending.');
		this.#writing = true;
		try {
			return await this.#operation(async admitted => {
				const catalogId = await this.#ready(); admitted.throwIfAborted();
				return (this.#ports.exclusive ?? withPhotoCatalogWriteLockV1)(catalogId, leaseSignal => run(catalogId, leaseSignal ?? admitted), admitted);
			}, signal);
		} finally { this.#writing = false; }
	}

	#operation<Result>(run: (signal: AbortSignal) => Promise<Result>, signal?: AbortSignal): Promise<Result> {
		if (this.#closed) return Promise.reject(new Error('The photo library session is closed.'));
		const admitted = signal ? AbortSignal.any([signal, this.#lifetime.signal]) : this.#lifetime.signal;
		const operation = Promise.resolve().then(() => { admitted.throwIfAborted(); return run(admitted); }).finally(() => { this.#pending.delete(operation); });
		this.#pending.add(operation); return operation;
	}
}

function readCursor(value: string | null | undefined): PhotoCatalogContinuationV1 | null {
	if (value === null || value === undefined) return null;
	if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > 1_024) throw new RangeError('Photo page cursor exceeds its scalar bound.');
	const input: unknown = JSON.parse(value);
	const cursor = record(input, 'photo page cursor', ['catalogId', 'indexRevision', 'scope', 'afterKey']);
	const scope = field(cursor, 'scope'), afterKey = field(cursor, 'afterKey');
	if (typeof scope !== 'string' || typeof afterKey !== 'string') throw new TypeError('Photo page cursor requires its indexed scope.');
	return { catalogId: id(field(cursor, 'catalogId'), 'cursor catalog ID'),
		indexRevision: integer(field(cursor, 'indexRevision'), 0, Number.MAX_SAFE_INTEGER, 'cursor revision'), scope, afterKey };
}

function errorMessage(error: unknown): string {
	if (!error || typeof error !== 'object') return 'Photo preparation failed.';
	const descriptor = Object.getOwnPropertyDescriptor(error, 'message');
	return descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string' ? descriptor.value.slice(0, 2_048) : 'Photo preparation failed.';
}
