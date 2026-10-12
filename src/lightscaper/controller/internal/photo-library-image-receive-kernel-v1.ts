/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryImageReceiveReceiptV2 } from '../../../common/editor/photo-library-image-receive-port-v2.ts';
import type { PhotoLibraryImageReceiveRequestV1, PhotoLibraryImageReceiveOptionsV1, PhotoLibraryImageReceiveReceiptV1 } from '../../../common/editor/photo-library-image-receive-port-v1.ts';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../../common/editor/closed-domain-value.ts';
import type { OpenFramescaperBrowserNativeImageV1 } from '../../../common/editor/timeline-image-native-decode-v1.ts';
import { normalizePhotoDocumentCurrentV1, serializePhotoDocumentCurrentV1 } from '../../catalog/photo-document-current-v1.ts';
import type { PhotoLibrarySessionPortsCurrentV1 } from '../photo-library-session-ports-current-v1.ts';
import { capturePhotoManagedImportPortsCurrentV1, type PhotoManagedImportPortsCurrentV1 } from '../../import/managed-import-ports-current-v1.ts';
import { importManagedPhotosCurrentV1 } from '../../import/managed-import-current-v1.ts';
import { normalizePhotoCatalogRootV1 } from '../../catalog/catalog-root.ts';
import { normalizePhotoDocumentV1OrV2, serializePhotoDocumentV1OrV2 } from '../../catalog/photo-document-v2.ts';
import type { PhotoCatalogContinuationV1 } from '../../catalog/repository-types.ts';
import { LIGHTSCAPER_CATALOG_LIMITS } from '../../catalog/types.ts';
import { id, utcTimestamp } from '../../catalog/value-validation.ts';
import { importManagedPhotosV2 } from '../../import/managed-import-v2.ts';
import { capturePhotoManagedImportPortsV2, type PhotoManagedImportPortsV2 } from '../../import/managed-import-ports-v2.ts';
import { readPhotoDevelopSignalOptionsV2 } from '../../storage/photo-develop-preset-read-v2.ts';
import { capturePhotoLibrarySessionPorts, capturePhotoLibrarySessionPortsCurrentV1 } from '../photo-library-session-bindings.ts';
import type { PhotoLibrarySessionPortsV2 } from '../photo-library-session-ports-v2.ts';
import { resolvePhotoImportKeywordsV1 } from '../photo-library-import-keywords-v1.ts';

type Profile = 'legacy2' | 'current3';
type Photo = ReturnType<typeof normalizePhotoDocumentCurrentV1>;
type Ports = PhotoLibrarySessionPortsV2 | PhotoLibrarySessionPortsCurrentV1;
type Managed = PhotoManagedImportPortsV2 | PhotoManagedImportPortsCurrentV1;
type Receipt = PhotoLibraryImageReceiveReceiptV1 | PhotoLibraryImageReceiveReceiptV2;
interface ReceivePort { receive(request: Readonly<PhotoLibraryImageReceiveRequestV1>, options?: Readonly<PhotoLibraryImageReceiveOptionsV1>): Promise<Readonly<Receipt>> }
function normalizePhoto(profile: Profile, value: unknown): Photo { return profile === 'legacy2' ? normalizePhotoDocumentV1OrV2(value) : normalizePhotoDocumentCurrentV1(value); }
function serializePhoto(profile: Profile, value: unknown): string { return profile === 'legacy2' ? serializePhotoDocumentV1OrV2(value) : serializePhotoDocumentCurrentV1(value); }
export interface PhotoLibraryImageReceiveHostForProfileV1 {
	readonly ports: Ports; readonly managed: Managed;
	readonly mutate: <Result>(run: (catalogId: string, signal: AbortSignal) => Promise<Result>, signal?: AbortSignal) => Promise<Result>;
	readonly resetReady: () => void;
}
const SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!, SLICE = Blob.prototype.slice;
const CHECK = AbortSignal.prototype.throwIfAborted, NativeDate = Date, ISO = Date.prototype.toISOString;
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }
function pin<Method extends (...args: never[]) => unknown>(value: unknown, receiver: unknown): Method {
	if (typeof value !== 'function') throw new TypeError('Image receive requires callable selected capabilities.');
	return ((...args: unknown[]) => Reflect.apply(value, receiver, args)) as unknown as Method;
}

/** One selected Session mutation owns the whole receive. Native original and
 * packed canonical equality precede any store write. Unique retained LUTs are
 * installed serially; managed publication retains its existing original roots
 * and intent. Authenticated unreferenced LUT/keyword entries can remain after
 * refusal: this is not an atomic transaction across the selected databases. */
export function createPhotoLibraryImageReceiveSessionForProfileV1(profile: Profile, host: PhotoLibraryImageReceiveHostForProfileV1,
	dependencies: Readonly<{ openImage?: OpenFramescaperBrowserNativeImageV1 }> = {}): Readonly<ReceivePort> {
	if (profile !== 'legacy2' && profile !== 'current3') throw new TypeError('Unsupported fixed image receive profile.');
	const input = record(host, 'image receive host', ['ports', 'managed', 'mutate', 'resetReady']);
	const portsValue = field(input, 'ports', 'image receive host');
	const ports = profile === 'legacy2' ? capturePhotoLibrarySessionPorts(portsValue as PhotoLibrarySessionPortsV2) : capturePhotoLibrarySessionPortsCurrentV1(portsValue as PhotoLibrarySessionPortsCurrentV1);
	const managedValue = field(input, 'managed', 'image receive host');
	const managed = profile === 'legacy2' ? capturePhotoManagedImportPortsV2(managedValue as PhotoManagedImportPortsV2) : capturePhotoManagedImportPortsCurrentV1(managedValue as PhotoManagedImportPortsCurrentV1);
	const mutate = pin<PhotoLibraryImageReceiveHostForProfileV1['mutate']>(field(input, 'mutate', 'image receive host'), host);
	const resetReady = pin<PhotoLibraryImageReceiveHostForProfileV1['resetReady']>(field(input, 'resetReady', 'image receive host'), host);
	const cryptoOwner = globalThis.crypto, uuid = cryptoOwner.randomUUID;
	const createId = ports.createId ?? (() => Reflect.apply(uuid, cryptoOwner, []) as string), now = ports.now ?? (() => Reflect.apply(ISO, new NativeDate(), []) as string);
	const resourceOwner = ports.cubeLutResources, maskOwner = ports.maskRasterResources;
	const deps = record(dependencies, 'image receive native dependencies', ['openImage'], []);
	const openImage = Object.hasOwn(deps, 'openImage') ? pin<OpenFramescaperBrowserNativeImageV1>(field(deps, 'openImage', 'image receive native dependencies'), dependencies) : undefined;
	return Object.freeze<ReceivePort>({ receive(value, options = {}) {
		let firstSignal: AbortSignal | undefined;
		try {
			if (profile === 'current3') {
				const descriptor = Object.getOwnPropertyDescriptor(options, 'signal');
				if (descriptor && Object.hasOwn(descriptor, 'value')) { firstSignal = descriptor.value as AbortSignal | undefined; if (firstSignal) check(firstSignal); }
			}
			const request = record(value, 'image receive request', ['archive', 'sourceId', 'imageClipId'], ['archive', 'sourceId']);
			const sourceId = id(field(request, 'sourceId', 'image receive request'), 'selected image source ID');
			const imageClipId = Object.hasOwn(request, 'imageClipId') ? id(field(request, 'imageClipId', 'image receive request'), 'selected image clip ID') : undefined;
			const selected = field(request, 'archive', 'image receive request'), size = Number(Reflect.apply(SIZE, selected, []));
			if (size < 1 || size > 256 * 1024 * 1024) throw new RangeError('Image receive archive exceeds its fixed byte bound.');
			const archive = Reflect.apply(SLICE, selected, [0, size]) as Blob;
			const { signal } = readPhotoDevelopSignalOptionsV2(options);
			const state: { ack: Readonly<Receipt> | null } = { ack: null };
			const work = mutate(async (catalogId, admitted) => {
				const { withPhotoFramescaperHandoffReadForProfileV1 } = await import('./photo-framescaper-handoff-read-kernel-v1.ts'); check(admitted);
				return withPhotoFramescaperHandoffReadForProfileV1(profile, { archive, sourceId, ...(imageClipId === undefined ? {} : { imageClipId }), signal: admitted }, async view => {
					const { preparePhotoFramescaperHandoffOriginalForProfileV1 } = await import('./photo-framescaper-handoff-original-kernel-v1.ts'); check(admitted);
					const original = await preparePhotoFramescaperHandoffOriginalForProfileV1(profile, { source: view.source, originalBlob: view.originalBlob,
						canonicalFrameSha256: view.canonicalFrameSha256, signal: admitted }, openImage ? { openImage } : {}); check(admitted);
					const rootValue = await managed.catalog.loadCatalog(catalogId); check(admitted);
					const root = normalizePhotoCatalogRootV1(rootValue);
					if (root.id !== catalogId) throw new Error('Image receive catalog differs from the selected catalog.');
					const virtual = view.source.provenance.origin.schemaFamily === 'lightscaper' && view.source.provenance.origin.versionKind === 'virtual-copy';
					const ownership = { photoId: id(createId(), 'fresh photo ID'), originalId: id(createId(), 'fresh original ID'),
						storageKey: id(createId(), 'fresh original storage key'), masterVersionId: id(createId(), 'fresh master version ID'),
						...(virtual ? { selectedVersionId: id(createId(), 'fresh selected version ID') } : {}) };
					const identities = new Set(Object.values(ownership));
					if (identities.size !== Object.values(ownership).length) throw new Error('Fresh image receive identities must be distinct.');
					if ([...root.folders, ...root.keywords, ...root.collections].some(value => identities.has(value.id))) throw new Error('Fresh receive identity collides with selected catalog definitions.');
					await assertUnused(catalogId, identities, root.photoCount, admitted); check(admitted);
					const { createPhotoFramescaperHandoffPhotoForProfileV1 } = await import('./photo-image-handoff-model-kernel-v1.ts'); check(admitted);
					let photo = createPhotoFramescaperHandoffPhotoForProfileV1(profile, { source: view.source, catalog: root, ownership,
						createdAt: utcTimestamp(now(), 'image receive time'), metadata: original.metadata, extractedMetadata: original.extractedMetadata });
					if (view.lutReferences.length) {
						if (!resourceOwner || !managed.verifyResources) throw new Error('Selected receive LUT storage and verification are unavailable.');
						const resources = await resourceOwner(); check(admitted);
						const put = pin<typeof resources.put>(Object.getOwnPropertyDescriptor(resources, 'put')?.value, resources);
						for (const reference of view.lutReferences) {
							await view.withLutBytes(reference, bytes => put(reference, bytes, { signal: admitted })); check(admitted);
						}
					}
					if (view.maskRasterReferences?.length) {
						if (profile !== 'current3' || !maskOwner || !view.withMaskRasterBytes || !managed.verifyResources) throw new Error('Selected receive brush storage and verification are unavailable.');
						const resources = await Reflect.apply(maskOwner, ports, []); check(admitted);
						const put = pin<typeof resources.put>(Object.getOwnPropertyDescriptor(resources, 'put')?.value, resources);
						for (const reference of view.maskRasterReferences) { await view.withMaskRasterBytes(reference, bytes => put(reference, bytes, { signal: admitted })); check(admitted); }
					}
					const keywordId = () => {
						const identity = id(createId(), 'fresh keyword ID');
						if (identities.has(identity)) throw new Error('Fresh keyword identity collides with receive ownership.');
						identities.add(identity); return identity;
					};
					const keywords = await resolvePhotoImportKeywordsV1(ports.catalog, catalogId, { photo, keywordNames: original.keywordNames }, keywordId, admitted, true); check(admitted);
					photo = normalizePhoto(profile, { ...photo, keywordIds: keywords.ids });
					if (managed.verifyResources) await Reflect.apply(managed.verifyResources, managed, [photo, admitted]); check(admitted);
					return await publish(photo, original.originalBlob, catalogId, admitted, state);
				});
			}, signal);
			return work.catch((failure: unknown) => {
				resetReady();
				if (state.ack === null) throw failure;
				return Object.freeze({ ...state.ack, settlement: 'recovery-pending' as const, failure });
			});
		} catch (error) { if (firstSignal) { try { check(firstSignal); } catch (reason) { return Promise.reject(reason); } } return Promise.reject(error); }
	} });

	async function assertUnused(catalogId: string, identities: ReadonlySet<string>, count: number, signal: AbortSignal): Promise<void> {
		let continuation: PhotoCatalogContinuationV1 | null = null, seen = 0;
		do {
			const page = await ports.catalog.readSummaryPage(catalogId, { continuation, signal }); check(signal);
			if (page.items.length > 64 || seen + page.items.length > count) throw new RangeError('Image receive identity scan exceeds its selected catalog bound.');
			for (const summary of page.items) {
				const value = await managed.catalog.loadPhoto(catalogId, summary.photoId); check(signal);
				const photo = normalizePhoto(profile, value);
				if (photo.catalogId !== catalogId || photo.id !== summary.photoId) throw new Error('Receive identity scan photo changed.');
				const used = [photo.id, photo.original.id, photo.original.storageKey, ...photo.versions.map(version => version.id)];
				if (used.some(identity => identities.has(identity))) throw new Error('Fresh image receive identity already exists.');
			}
			seen += page.items.length;
			if (page.continuation && (page.items.length === 0 || page.continuation.afterKey === continuation?.afterKey)) throw new Error('Receive identity scan did not advance.');
			continuation = page.continuation;
		} while (continuation);
		if (seen !== count || count > LIGHTSCAPER_CATALOG_LIMITS.maximumPhotos) throw new Error('Receive selected catalog identity inventory changed.');
	}

	async function publish(photo: Photo, original: Blob, catalogId: string, signal: AbortSignal,
		state: { ack: Readonly<Receipt> | null }): Promise<Readonly<Receipt>> {
		let candidate: Photo | null = null, authorizedReuse: string | null = null, reusedOriginal = false;
		let failed = false, firstFailure: unknown;
		const watch = <Method extends (...args: never[]) => unknown>(method: Method): Method => (async (...args: unknown[]) => {
			try { return await Reflect.apply(method, undefined, args); }
			catch (error) { if (!failed) { failed = true; firstFailure = error; } throw error; }
		}) as unknown as Method;
		const refuse = (error: unknown, readback?: Readonly<{ failure: unknown }>): never => {
			const failures = [failed ? firstFailure : error];
			if (!failures.includes(error)) failures.push(error);
			if (readback && !failures.includes(readback.failure)) failures.push(readback.failure);
			if (failures.length > 1) throw new AggregateError(failures, 'Image receive and native settlement failed.', { cause: failures[0] });
			throw failures[0];
		};
		const acknowledge = (value: Photo) => {
			state.ack ??= Object.freeze({ schemaVersion: profile === 'legacy2' ? 1 : 2, status: 'imported', catalogId, photoId: value.id,
				originalId: value.original.id, activeVersionId: value.activeVersionId, revision: 0,
				reusedOriginal, settlement: 'complete' });
		};
		const matches = (value: Photo) => {
			if (value.original.storageKey !== photo.original.storageKey && value.original.storageKey !== authorizedReuse) return false;
			return serializePhoto(profile, value) === serializePhoto(profile, { ...photo, original: { ...photo.original, storageKey: value.original.storageKey } });
		};
		const { verifyResources, ...publicationPorts } = managed;
		const publication: PhotoManagedImportPortsCurrentV1 = { ...publicationPorts, exclusive: async (_id, run) => run(signal),
			journal: { get: watch(managed.journal.get), putIfAbsent: watch(managed.journal.putIfAbsent), deleteIfCurrent: watch(managed.journal.deleteIfCurrent) },
			...(verifyResources ? { verifyResources: watch(async (value: Photo, signal?: AbortSignal) => {
				const admitted = profile === 'legacy2' ? normalizePhotoDocumentV1OrV2(value) : value;
				await Reflect.apply(verifyResources, managed, [admitted, signal]);
			}) } : {}),
			media: { writeAsset: watch(managed.media.writeAsset), custody: {
				stage: watch(managed.media.custody.stage), readPage: watch(managed.media.custody.readPage), promote: watch(managed.media.custody.promote), releaseStaged: watch(managed.media.custody.releaseStaged),
				findDigestPage: watch(async (...args: Parameters<typeof managed.media.custody.findDigestPage>) => {
					const page = await managed.media.custody.findDigestPage(...args);
					if (args[0] !== photo.original.contentSha256) throw new Error('Receive digest lookup differs from the authenticated original.');
					const match = page.matches.find(item => item.size === photo.original.byteLength);
					if (match) { authorizedReuse = match.assetId; reusedOriginal = true; }
					return page;
				}) } },
			catalog: { loadCatalog: watch(managed.catalog.loadCatalog), loadPhoto: watch(managed.catalog.loadPhoto),
				publishPhotos: watch(async (idValue, revision, values, options) => {
					if (idValue !== catalogId || values.length !== 1) throw new Error('Receive publication escaped its single selected photo.');
					candidate = normalizePhoto(profile, values[0]);
					if (!matches(candidate)) throw new Error('Receive publication differs from its complete verified candidate.');
					const result = await Reflect.apply(managed.catalog.publishPhotos, managed.catalog, [idValue, revision, values, options]); acknowledge(candidate); return result;
				}) } };
		try {
			const receipts = profile === 'legacy2' ? await importManagedPhotosV2(catalogId, [{ photo: normalizePhotoDocumentV1OrV2(photo), original }], publication as PhotoManagedImportPortsV2, { signal })
				: await importManagedPhotosCurrentV1(catalogId, [{ photo, original }], publication as PhotoManagedImportPortsCurrentV1, { signal });
			if (state.ack) return state.ack;
			if (candidate !== null) {
				const stored = await managed.catalog.loadPhoto(catalogId, photo.id); check(signal);
				if (stored !== null) {
					const saved = normalizePhoto(profile, stored);
					if (matches(saved)) { acknowledge(saved); return state.ack!; }
				}
			}
			if (failed) throw firstFailure;
			throw new Error(receipts[0]?.message ?? 'Image receive was not published.');
		} catch (error) {
			if (state.ack !== null) refuse(error);
			// A lost native ACK is recovered only with the whole expected saved
			// document, never the managed importer's original-only fallback.
			let readbackFailure: Readonly<{ failure: unknown }> | undefined;
			if (candidate !== null) {
				try {
					const stored = await managed.catalog.loadPhoto(catalogId, photo.id);
					if (stored !== null) {
						const saved = normalizePhoto(profile, stored);
						if (matches(saved)) acknowledge(saved);
					}
				} catch (failure) { readbackFailure = { failure }; }
			}
			return refuse(error, readbackFailure);
		}
	}
}
