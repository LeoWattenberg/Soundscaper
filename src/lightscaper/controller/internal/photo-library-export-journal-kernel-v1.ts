/* SPDX-License-Identifier: AGPL-3.0-only */
import type { PhotoLibraryExportJournalSettings, PhotoLibraryExportJournalAccess, PhotoLibraryExportSidecarRequest } from '../../../common/editor/photo-library-session-port-v2.ts';
import type { PhotoLibrarySessionPortsV2 } from '../photo-library-session-ports-v2.ts';
import { createPhotoExportSidecarV1, serializePhotoExportSidecarV1 } from '../../catalog/photo-export-sidecar-v1.ts';
import { normalizePhotoDocumentV1OrV2 } from '../../catalog/photo-document-v2.ts';
import { normalizePhotoRasterExportJournalV1, photoRasterExportJournalKeyV1 } from '../../storage/photo-raster-export-journal-v1.ts';
import { readPhotoDevelopSignalOptionsV2 } from '../../storage/photo-develop-preset-read-v2.ts';
import type { PhotoLibrarySessionPortsCurrentV1 } from '../photo-library-session-ports-current-v1.ts';
import { createPhotoExportSidecarCurrentV1, serializePhotoExportSidecarCurrentV1 } from '../../catalog/photo-export-sidecar-current-v1.ts';
import { normalizePhotoDocumentCurrentV1, serializePhotoDocumentCurrentV1 } from '../../catalog/photo-document-current-v1.ts';
import { admitPhotoLibraryExportSidecarBindingV1, readPhotoLibraryExportSignalOptionsV1 } from './photo-library-export-request-v1.ts';

export interface PhotoLibraryExportJournalHostV1 {
	readonly settings: Readonly<PhotoLibraryExportJournalSettings>;
	readonly ready: () => Promise<string>;
	readonly catalog: Pick<PhotoLibrarySessionPortsV2['catalog'], 'loadPhoto'>;
	readonly loadOriginal?: NonNullable<PhotoLibrarySessionPortsV2['backup']>['loadOriginal'];
	readonly verifyResources?: PhotoLibrarySessionPortsV2['verifyResources'];
	readonly operation: <Result>(run: (signal: AbortSignal) => Promise<Result>, signal?: AbortSignal, admit?: () => void) => Promise<Result>;
}
export interface PhotoLibraryExportJournalHostCurrentV1 extends Omit<PhotoLibraryExportJournalHostV1, 'catalog' | 'verifyResources'> {
	readonly catalog: Pick<PhotoLibrarySessionPortsCurrentV1['catalog'], 'loadPhoto'>;
	readonly verifyResources?: PhotoLibrarySessionPortsCurrentV1['verifyResources'];
}
type Host = PhotoLibraryExportJournalHostV1 | PhotoLibraryExportJournalHostCurrentV1;
const CHECK = AbortSignal.prototype.throwIfAborted;
const FILL = Uint8Array.prototype.fill;
const BLOB_SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;
const BLOB_BYTES = Blob.prototype.arrayBuffer;
const DIGEST = SubtleCrypto.prototype.digest;
const check = (signal: AbortSignal) => { Reflect.apply(CHECK, signal, []); };

/** Opening lends scalar methods, not a held Session operation. Each later CAS
 * owns one joined operation, so original/render acquisitions cannot deadlock. */
export function openPhotoLibraryExportJournalForProfileV1(profile: 'legacy2' | 'current3', host: Host, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<Readonly<PhotoLibraryExportJournalAccess>> {
	if (profile !== 'legacy2' && profile !== 'current3') throw new TypeError('Unsupported fixed export journal profile.');
	const { signal } = profile === 'current3' ? readPhotoLibraryExportSignalOptionsV1(options) : readPhotoDevelopSignalOptionsV2(options), store = host.settings;
	const get = store.get, insert = store.putIfAbsent, replace = store.replaceIfCurrent, run = host.operation, initialize = host.ready;
	const remove = store.deleteIfCurrent;
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
				const caller = (profile === 'current3' ? readPhotoLibraryExportSignalOptionsV1(options) : readPhotoDevelopSignalOptionsV2(options)).signal;
				let bound!: Readonly<PhotoLibraryExportSidecarRequest>;
				return operation(async current => {
					try {
						await checked(current); if (bound.catalogId !== catalogId) throw new Error('Photo export journal resource catalog changed.');
						const raw = await Reflect.apply(loadPhoto, catalog, [catalogId, bound.photoId]) as unknown; check(current);
						const photo = profile === 'current3' ? normalizePhotoDocumentCurrentV1(raw) : normalizePhotoDocumentV1OrV2(raw);
						const before = profile === 'current3' ? serializePhotoExportSidecarCurrentV1(createPhotoExportSidecarCurrentV1(photo, bound))
							: serializePhotoExportSidecarV1(createPhotoExportSidecarV1(photo, bound));
						const complete = profile === 'current3' ? serializePhotoDocumentCurrentV1(photo) : null;
						if (!loadOriginal) throw new Error('Photo export journal original verification is unavailable.');
						const body = await Reflect.apply(loadOriginal, host, [photo.original, current]) as Blob; check(current);
						if (Reflect.apply(BLOB_SIZE, body, []) !== photo.original.byteLength) throw new Error('Photo export journal original length changed.');
						const bytes = new Uint8Array(await Reflect.apply(BLOB_BYTES, body, []) as ArrayBuffer);
						try {
							check(current); const digest = await Reflect.apply(DIGEST, crypto.subtle, ['SHA-256', bytes]) as ArrayBuffer; check(current);
							if ([...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('') !== photo.original.contentSha256) throw new Error('Photo export journal original hash changed.');
						} finally { Reflect.apply(FILL, bytes, [0]); }
						if (profile === 'current3' || photo.schemaVersion === 2) { if (!verifyResources) throw new Error('Photo export journal LUT verification is unavailable.'); await Reflect.apply(verifyResources, host, [photo, current]); check(current); }
						const after = await Reflect.apply(loadPhoto, catalog, [catalogId, bound.photoId]) as unknown; check(current);
						const afterText = profile === 'current3' ? serializePhotoExportSidecarCurrentV1(createPhotoExportSidecarCurrentV1(after, bound))
							: serializePhotoExportSidecarV1(createPhotoExportSidecarV1(after, bound));
						if (afterText !== before || (complete !== null && serializePhotoDocumentCurrentV1(after) !== complete)) throw new Error('Photo export journal resources changed during verification.');
					} catch (error) { if (profile === 'current3') check(current); throw error; }
				}, caller ? AbortSignal.any([...(signal ? [signal] : []), caller]) : signal, () => {
					bound = admitPhotoLibraryExportSidecarBindingV1(request);
				});
			}, settings: Object.freeze<PhotoLibraryExportJournalSettings>({
			...(remove === undefined ? {} : { deleteIfCurrent(candidate: string, expected: unknown) {
				let before: ReturnType<typeof admitValue>;
				return operation(async current => { await checked(current); const ack = await Reflect.apply(remove, store, [key, before]) as boolean; if (profile === 'legacy2' || ack !== true) check(current); return ack; }, signal,
					() => { admitKey(candidate); before = admitValue(expected); });
			} }),
			get(candidate) { return operation(async current => {
				await checked(current); const value = await Reflect.apply(get, store, [key]) as unknown; check(current);
				if (value !== undefined) admitValue(value); return value;
			}, signal, () => { admitKey(candidate); }); },
			putIfAbsent(candidate, value) {
				let next: ReturnType<typeof admitValue>;
				return operation(async current => { await checked(current); const ack = await Reflect.apply(insert, store, [key, next]) as boolean; if (profile === 'legacy2' || ack !== true) check(current); return ack; }, signal,
					() => { admitKey(candidate); next = admitValue(value); });
			},
			replaceIfCurrent(candidate, expected, value) {
				let before: ReturnType<typeof admitValue>, next: ReturnType<typeof admitValue>;
				return operation(async current => { await checked(current); const ack = await Reflect.apply(replace, store, [key, before, next]) as boolean; if (profile === 'legacy2' || ack !== true) check(current); return ack; }, signal,
					() => { admitKey(candidate); before = admitValue(expected); next = admitValue(value);
						if (next.revision !== before.revision + 1) throw new TypeError('Photo export journal CAS revision must advance exactly once.'); });
			},
		}) });
	}, signal);
}
