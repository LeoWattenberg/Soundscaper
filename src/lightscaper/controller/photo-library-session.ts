/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray } from '../../common/editor/closed-domain-value.ts';
import type { PhotoLibraryAttributePatchV1, PhotoLibraryImportItemV1, PhotoLibraryPageV1, PhotoLibraryRowV1, PhotoLibrarySessionPortV1 } from '../../common/editor/photo-library-session-port-v1.ts';
import { IMAGE_IMPORT_LIMITS } from '../../common/editor/image-import-admission.ts';
import { normalizePhotoCatalogRootV1 } from '../catalog/catalog-root.ts';
import { normalizePhotoDocumentV1 } from '../catalog/photo-document.ts';
import type { PhotoCatalogContinuationV1 } from '../catalog/repository-types.ts';
import { LIGHTSCAPER_CATALOG_LIMITS } from '../catalog/types.ts';
import { field, id, integer, name, record } from '../catalog/value-validation.ts';
import { withPhotoCatalogWriteLockV1 } from '../import/catalog-write-lock-v1.ts';
import { importManagedPhotosV1, recoverManagedPhotoImportV1 } from '../import/managed-import-v1.ts';
import type { PhotoManagedImportPortsV1 } from '../import/managed-import-ports-v1.ts';
import { preparePhotoImportGestureV1 } from '../import/photo-import-preparation-v1.ts';
import { PhotoCommandOwnerV1 } from './photo-command-owner.ts';
import { normalizePhotoLibraryAttributesV1 } from './photo-library-attributes.ts';
import type { PhotoLibraryPreparationOutcomeV1, PhotoLibrarySessionPortsV1 } from './photo-library-session-ports.ts';

/** Product session owns lifetime, bounded presentation pages and a single writer. */
export class PhotoLibrarySessionV1 implements PhotoLibrarySessionPortV1 {
	readonly #ports: PhotoLibrarySessionPortsV1;
	readonly #lifetime = new AbortController();
	readonly #pending = new Set<Promise<unknown>>();
	#catalog: Promise<string> | null = null;
	#photo: PhotoCommandOwnerV1 | null = null;
	#writing = false;
	#closed = false;
	#closing: Promise<void> | null = null;

	constructor(ports: PhotoLibrarySessionPortsV1) { this.#ports = ports; }

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

	async importFiles(files: readonly File[], options: Readonly<{ signal?: AbortSignal }> = {}): Promise<readonly PhotoLibraryImportItemV1[]> {
		const selected = readClosedDomainArray(files, 'selected photo files', 1, IMAGE_IMPORT_LIMITS.maximumFilesPerGesture) as readonly File[];
		return this.#mutation(async (catalogId, signal) => {
			const root = await this.#ports.catalog.loadCatalog(catalogId);
			if (!root) throw new ReferenceError('Photo catalog is missing.');
			const createId = this.#ports.createId ?? (() => crypto.randomUUID());
			const ownership = selected.map(() => ({ photoId: createId(), originalId: createId(), originalStorageKey: createId(), masterVersionId: createId() }));
			const prepared = (this.#ports.prepare ?? preparePhotoImportGestureV1)({ files: selected, ownership, catalog: root,
				createdAt: (this.#ports.now ?? (() => new Date().toISOString()))(), signal });
			const failed: PhotoLibraryImportItemV1[] = [];
			const admitted: Array<{ index: number; fileName: string; hasMetadataNotices: boolean }> = [];
			const ports = this.#managedPorts();
			// The outer lease owns keyword-definition and photo publication together.
			const receipts = await (this.#ports.importPhotos ?? importManagedPhotosV1)(catalogId, bridge.call(this), {
				...ports, exclusive: async (_id, operation) => operation(signal),
			}, { signal });
			const results = [...failed, ...receipts.map(receipt => {
				const selection = admitted[receipt.index];
				if (!selection) throw new Error('Photo publication receipt has no selected-file binding.');
				return Object.freeze({ ...receipt, ...selection });
			})].sort((a, b) => a.index - b.index);
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
						const resolved = await this.#keywords(catalogId, outcome, createId, signal);
						const photo = normalizePhotoDocumentV1({ ...outcome.photo, keywordIds: resolved.ids });
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
		}, options.signal);
	}

	async setRating(photoId: string, rating: number, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryRowV1> {
		return this.applyAttributes(photoId, { rating }, options);
	}

	async applyAttributes(photoId: string, changes: PhotoLibraryAttributePatchV1, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryRowV1> {
		const key = id(photoId, 'photo ID'), patch = normalizePhotoLibraryAttributesV1(changes);
		return this.#mutation(async (catalogId, signal) => {
			if (this.#photo?.history.present.id !== key) {
				await this.#photo?.close();
				this.#photo = null;
				this.#photo = await PhotoCommandOwnerV1.open(this.#ports.catalog, catalogId, key);
			} else {
				const current = await this.#ports.catalog.loadPhoto(catalogId, key);
				signal.throwIfAborted();
				if (!current) { await this.#photo.close(); this.#photo = null; throw new ReferenceError('The photo is missing.'); }
				if (current.revision !== this.#photo.history.present.revision) await this.#photo.reload({ signal });
			}
			try {
				const photo = await this.#photo.execute({ type: 'set-attributes', changes: patch }, { signal });
				return Object.freeze({ id: photo.id, fileName: photo.metadata.fileName, rating: photo.rating,
					flag: photo.flag, colorLabel: photo.colorLabel, width: photo.original.width, height: photo.original.height });
			}
			catch (error) { await this.#photo.close(); this.#photo = null; throw error; }
		}, options.signal);
	}

	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		this.#closed = true; this.#lifetime.abort();
		this.#closing = this.#close(); return this.#closing;
	}

	async #close(): Promise<void> {
		await Promise.allSettled([...this.#pending]);
		await this.#photo?.close();
		await this.#ports.closeResources();
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
