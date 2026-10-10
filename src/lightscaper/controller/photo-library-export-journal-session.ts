/* SPDX-License-Identifier: AGPL-3.0-only */
import type { PhotoLibraryExportJournalSettings, PhotoLibraryExportJournalAccess, PhotoLibraryExportSidecarRequest } from '../../common/editor/photo-library-session-port-v2.ts';
import type { PhotoLibrarySessionPortsV2 } from './photo-library-session-ports-v2.ts';
import { createPhotoExportSidecarV1, serializePhotoExportSidecarV1 } from '../catalog/photo-export-sidecar-v1.ts';
import { normalizePhotoDocumentV1OrV2 } from '../catalog/photo-document-v2.ts';
import { normalizePhotoRasterExportJournalV1, photoRasterExportJournalKeyV1 } from '../storage/photo-raster-export-journal-v1.ts';
import { readPhotoDevelopSignalOptionsV2 } from '../storage/photo-develop-preset-read-v2.ts';
import { field, id, integer, record } from '../catalog/value-validation.ts';

interface Host {
	readonly settings: Readonly<PhotoLibraryExportJournalSettings>;
	readonly ready: () => Promise<string>;
	readonly catalog: Pick<PhotoLibrarySessionPortsV2['catalog'], 'loadPhoto'>;
	readonly loadOriginal?: NonNullable<PhotoLibrarySessionPortsV2['backup']>['loadOriginal'];
	readonly verifyResources?: PhotoLibrarySessionPortsV2['verifyResources'];
	readonly operation: <Result>(run: (signal: AbortSignal) => Promise<Result>, signal?: AbortSignal, admit?: () => void) => Promise<Result>;
}
const CHECK = AbortSignal.prototype.throwIfAborted;
const BLOB_SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;
const BLOB_BYTES = Blob.prototype.arrayBuffer;
const DIGEST = SubtleCrypto.prototype.digest;
const check = (signal: AbortSignal) => { Reflect.apply(CHECK, signal, []); };

/** Opening lends scalar methods, not a held Session operation. Each later CAS
 * owns one joined operation, so original/render acquisitions cannot deadlock. */
export function openPhotoLibraryExportJournalSession(host: Host, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<Readonly<PhotoLibraryExportJournalAccess>> {
	const { signal } = readPhotoDevelopSignalOptionsV2(options), store = host.settings;
	const get = store.get, insert = store.putIfAbsent, replace = store.replaceIfCurrent, run = host.operation, initialize = host.ready;
	const catalog = host.catalog, loadPhoto = catalog.loadPhoto, loadOriginal = host.loadOriginal, verifyResources = host.verifyResources;
	if ([get, insert, replace, run, initialize].some(method => typeof method !== 'function')) throw new TypeError('Photo export journal Session requires selected CAS capabilities.');
	const ready = () => Reflect.apply(initialize, host, []) as Promise<string>;
	const operation: Host['operation'] = (...args) => Reflect.apply(run, host, args);
	return operation(async admitted => {
		const catalogId = await ready(); check(admitted); const key = photoRasterExportJournalKeyV1(catalogId);
		const admitKey = (candidate: string) => { if (candidate !== key) throw new TypeError('Photo export journal key is outside the selected catalog.'); };
		const admitValue = (value: unknown) => {
			const journal = normalizePhotoRasterExportJournalV1(value);
			if (journal.catalogId !== catalogId) throw new TypeError('Photo export journal belongs to another selected catalog.'); return journal;
		};
		const checked = async (current: AbortSignal) => { check(current); if (await ready() !== catalogId) throw new Error('Photo export journal selected catalog changed.'); check(current); };
		return Object.freeze({ catalogId,
			verifyResources(request: Readonly<PhotoLibraryExportSidecarRequest>, options: Readonly<{ signal?: AbortSignal }> = {}) {
				const caller = readPhotoDevelopSignalOptionsV2(options).signal;
				let bound!: Readonly<PhotoLibraryExportSidecarRequest>;
				return operation(async current => {
					await checked(current); if (bound.catalogId !== catalogId) throw new Error('Photo export journal resource catalog changed.');
					const raw = await Reflect.apply(loadPhoto, catalog, [catalogId, bound.photoId]) as unknown; check(current);
					const photo = normalizePhotoDocumentV1OrV2(raw), before = serializePhotoExportSidecarV1(createPhotoExportSidecarV1(photo, bound));
					if (!loadOriginal) throw new Error('Photo export journal original verification is unavailable.');
					const body = await Reflect.apply(loadOriginal, host, [photo.original, current]) as Blob; check(current);
					if (Reflect.apply(BLOB_SIZE, body, []) !== photo.original.byteLength) throw new Error('Photo export journal original length changed.');
					const bytes = new Uint8Array(await Reflect.apply(BLOB_BYTES, body, []) as ArrayBuffer);
					try {
						check(current); const digest = await Reflect.apply(DIGEST, crypto.subtle, ['SHA-256', bytes]) as ArrayBuffer; check(current);
						if ([...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('') !== photo.original.contentSha256) throw new Error('Photo export journal original hash changed.');
					} finally { bytes.fill(0); }
					if (photo.schemaVersion === 2) { if (!verifyResources) throw new Error('Photo export journal LUT verification is unavailable.'); await Reflect.apply(verifyResources, host, [photo, current]); check(current); }
					const after = await Reflect.apply(loadPhoto, catalog, [catalogId, bound.photoId]) as unknown; check(current);
					if (serializePhotoExportSidecarV1(createPhotoExportSidecarV1(after, bound)) !== before) throw new Error('Photo export journal resources changed during verification.');
				}, caller ? AbortSignal.any([...(signal ? [signal] : []), caller]) : signal, () => {
					const input = record(request, 'photo export resource binding', ['catalogId', 'photoId', 'versionId', 'expectedRevision']);
					bound = Object.freeze({ catalogId: id(field(input, 'catalogId'), 'resource catalog ID'), photoId: id(field(input, 'photoId'), 'resource photo ID'),
						versionId: id(field(input, 'versionId'), 'resource version ID'), expectedRevision: integer(field(input, 'expectedRevision'), 0, Number.MAX_SAFE_INTEGER, 'resource revision') });
				});
			}, settings: Object.freeze<PhotoLibraryExportJournalSettings>({
			get(candidate) { return operation(async current => {
				await checked(current); const value = await Reflect.apply(get, store, [key]) as unknown; check(current);
				if (value !== undefined) admitValue(value); return value;
			}, signal, () => { admitKey(candidate); }); },
			putIfAbsent(candidate, value) {
				let next: ReturnType<typeof admitValue>;
				return operation(async current => { await checked(current); const ack = await Reflect.apply(insert, store, [key, next]) as boolean; check(current); return ack; }, signal,
					() => { admitKey(candidate); next = admitValue(value); });
			},
			replaceIfCurrent(candidate, expected, value) {
				let before: ReturnType<typeof admitValue>, next: ReturnType<typeof admitValue>;
				return operation(async current => { await checked(current); const ack = await Reflect.apply(replace, store, [key, before, next]) as boolean; check(current); return ack; }, signal,
					() => { admitKey(candidate); before = admitValue(expected); next = admitValue(value);
						if (next.revision !== before.revision + 1) throw new TypeError('Photo export journal CAS revision must advance exactly once.'); });
			},
		}) });
	}, signal);
}
