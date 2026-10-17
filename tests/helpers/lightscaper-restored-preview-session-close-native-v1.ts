/* SPDX-License-Identifier: AGPL-3.0-only */

import { readBinaryDerivativeCacheRecordV1, type BinaryDerivativeCacheRecordV1 } from '../../src/common/editor/storage/binary-derivative-cache-records.ts';
import { openDatabase, request, transact } from '../../src/common/editor/storage/indexeddb-backend.ts';
import { normalizeCatalogOriginalRoot } from '../../src/common/editor/storage/media-catalog-original-schema.ts';
import { MediaAssetLoadRepository } from '../../src/common/editor/storage/media-asset-load-repository.ts';
import { OpfsRepository } from '../../src/common/editor/storage/opfs-repository.ts';
import { OpfsSyncRepositoryBridge } from '../../src/common/editor/storage/opfs-sync-repository-bridge.ts';
import { PhotoCatalogRepositoryV2 } from '../../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { createPhotoLibraryRestoreRuntimeV2 } from '../../src/lightscaper/photo-library-restore-runtime-v2.ts';
import { createPhotoLibrarySessionV3 } from '../../src/lightscaper/photo-library-session-runtime-v3.ts';
import { PhotoPreviewCacheV1, PHOTO_PREVIEW_CACHE_PROFILE_V1 as PROFILE } from '../../src/lightscaper/preview/photo-preview-cache-v1.ts';
import { planPhotoPreviewV1 } from '../../src/lightscaper/preview/photo-preview-plan-v1.ts';
import { readPhotoLibrarySessionLocationV2, type PhotoLibrarySessionLocationV2 } from '../../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { PHOTO_LIBRARY_DEFAULT_CATALOG_DATABASE_NAME_V2 as CATALOG } from '../../src/lightscaper/storage/photo-library-location-v2.ts';
import { withPhotoLibraryInitializationLockV1 } from '../../src/lightscaper/storage/photo-library-namespace-lock-v1.ts';
import { PhotoMediaStoreV1, PHOTO_MEDIA_NAMESPACES_V1 as NAMES } from '../../src/lightscaper/storage/photo-media-store.ts';

export type PhotoRestoredPreviewSessionCloseCutV1 = 'payload-put' | 'inventory-put' | 'completed-ack';
type Session = Awaited<ReturnType<typeof createPhotoLibrarySessionV3>>;
type Outcome<Value> = { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly error: unknown };
interface PairSnapshot {
	readonly payload: number; readonly inventory: number; readonly pair: BinaryDerivativeCacheRecordV1 | null;
	readonly bodySha256: string | null;
}
export interface PhotoRestoredPreviewSessionCloseNativeResultV1 {
	readonly schemaVersion: 1; readonly cut: PhotoRestoredPreviewSessionCloseCutV1; readonly selectedRestoredProfile: true;
	readonly allocation: { readonly namespaceToken: string; readonly catalogDatabaseName: string; readonly mediaDatabaseName: string; readonly committedPointer: true };
	readonly close: { readonly samePromise: boolean; readonly newWorkRefused: boolean; readonly fulfilled: boolean;
		readonly subscriberExactCancellation: boolean; readonly heldPending: boolean; readonly resourceClosesWhileHeld: number; readonly resourceClosesBeforeTerminal: number;
		readonly selectedResourceClosesAfterRelease: { readonly catalog: number; readonly media: number } };
	readonly transaction: { readonly putSuccesses: readonly string[]; readonly complete: number; readonly abort: number; readonly terminalBeforeResources: boolean };
	readonly afterCut: PairSnapshot; readonly finalPair: PairSnapshot;
	readonly reopened: { readonly cache: string; readonly originalReads: number; readonly literalPixelsExact: boolean };
	readonly original: { readonly photoExact: boolean; readonly metadataExact: boolean; readonly recordExact: boolean;
		readonly contentTokenExact: boolean; readonly custodyExact: boolean; readonly bytesExact: boolean; readonly sha256: string };
	readonly donor: { readonly catalogExact: boolean; readonly photoExact: boolean; readonly originalMetadataExact: boolean;
		readonly originalRecordExact: boolean; readonly custodyExact: boolean; readonly bytesExact: boolean; readonly cacheExact: boolean };
	readonly previewNativeWriterOpens: number;
}

const PAYLOAD = 'videoDerivatives', INVENTORY = 'videoDerivativeCacheEntries', PREFIX = 'binary-cache-photo-preview-cache';
// Encoded opaque 2×2 PNG; every actual decoded pixel is the literal palette entry [255,32,0,255].
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQMAAABIeJ9nAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8gAP///4DcGxUAAAABYktHRAH/Ai3eAAAAB3RJTUUH6ggZEjoj/gYZhQAAAAxJREFUCNdjYGBgAAAABAABJzQnCgAAAABJRU5ErkJggg==';

/** Real V5 restore selects the allocated profile; all native requests and owner outcomes are forwarded unchanged. */
export async function qualifyPhotoRestoredPreviewSessionCloseNativeV1(cutValue: unknown): Promise<PhotoRestoredPreviewSessionCloseNativeResultV1> {
	if (cutValue !== 'payload-put' && cutValue !== 'inventory-put' && cutValue !== 'completed-ack') throw new RangeError('Unsupported restored preview Close cut.');
	const cut = cutValue, nativeFactory = indexedDB, root = await navigator.storage.getDirectory();
	const existingNames = new Set((await nativeFactory.databases()).map(row => row.name));
	check(!existingNames.has(NAMES.databaseName) && !existingNames.has(CATALOG), 'Qualification requires an absent default donor library.');
	try { await root.getDirectoryHandle(NAMES.opfsDirectoryName); throw new Error('Qualification cannot delete an existing original directory.'); }
	catch (error) { if (!notFound(error)) throw error; }
	const companionCandidate = (globalThis as typeof globalThis & { __assertNativeOpfsWorkerExecution?: () => Promise<void> }).__assertNativeOpfsWorkerExecution;
	check(typeof companionCandidate === 'function', 'The ordinary native worker companion must authenticate donor setup.');
	const companion = companionCandidate;
	const bytes = Uint8Array.from(atob(PNG), value => value.charCodeAt(0)), originalSha256 = await digest(bytes);
	const entered = deferred(), outcomeReady = deferred(), release = deferred(), restores: (() => void)[] = [], ownedNames = new Set<string>();
	let donorSession: Session | null = null, session: Session | null = null, reopened: Session | null = null;
	let restoreRuntime: ReturnType<typeof createPhotoLibraryRestoreRuntimeV2> | null = null;
	let previewTask: Promise<Outcome<Awaited<ReturnType<Session['readPreview']>>>> | null = null, closeTask: Promise<Outcome<void>> | null = null;
	let selected: Readonly<PhotoLibrarySessionLocationV2> | null = null, originalKey = '', targetKey = '';
	let phase: 'setup' | 'armed' | 'reopen' | 'verify' = 'setup', fired = false, released = false, closeSettled = false;
	let jobSignal: AbortSignal | undefined, samePromise = false, complete = 0, abort = 0;
	let resourceClosesWhileHeld = 0, resourceClosesBeforeTerminal = 0, previewNativeWriterOpens = 0, originalReads = 0;
	const selectedResourceClosesAfterRelease = { catalog: 0, media: 0 };
	const putSuccesses: string[] = [], cleanupFailures: unknown[] = [];
	let qualified: PhotoRestoredPreviewSessionCloseNativeResultV1 | null = null, primaryFailed = false, primary: unknown;
	const factory = observeFactory(nativeFactory);
	try {
		observeMethods();
		donorSession = await createPhotoLibrarySessionV3({ name: 'Restored preview Close donor', indexedDB: factory, locks: navigator.locks });
		check((await donorSession.readPage()).totalCount === 0, 'Default donor catalog must be empty before import.');
		const receipts = await donorSession.importFiles([new File([bytes], 'restored-preview-close.png', { type: 'image/png' })]);
		const receipt = receipts[0]; check(receipts.length === 1 && receipt?.status === 'imported' && receipt.photoId !== null, 'Actual donor import must acknowledge one Photo.');
		const photoId = receipt.photoId, donorSelection = await selection();
		check(donorSelection.pointer.schemaVersion === 1 && donorSelection.allocation === null, 'Donor must use the default native profile.');
		const backup = await donorSession.backupCatalog();
		check(backup.blob !== undefined && backup.blob !== null && backup.blob.size > 0 && backup.blob.size <= 128 * 1024, 'Actual one-photo V5 backup exceeds its fixture bound.');
		const donorBefore = await librarySnapshot(donorSelection, photoId);
		await companion();
		await donorSession.close(); donorSession = null;
		restoreRuntime = createPhotoLibraryRestoreRuntimeV2({ name: 'Restored preview Close donor', indexedDB: factory, locks: navigator.locks });
		const restored = await restoreRuntime.restoreArchive(backup.blob); await restoreRuntime.close(); restoreRuntime = null;
		selected = await selection();
		check(selected.pointer.schemaVersion === 2 && selected.allocation !== null && selected.location.namespaceToken !== null,
			'Actual private restore must publish a committed allocated pointer.');
		check(restored.photoCount === 1 && restored.originalCount === 1 && restored.catalogId === selected.location.catalogId,
			'Actual restore receipt differs from the selected complete library.');
		const before = await librarySnapshot(selected, photoId);
		check(same(before.photo, donorBefore.photo), 'V5 restore changed the complete donor Photo.');
		originalKey = before.photo.original.storageKey;
		const original = before.photo.original, plan = planPhotoPreviewV1({ binding: { catalogId: before.photo.catalogId, photoId,
			originalId: original.id, storageKey: originalKey, contentSha256: original.contentSha256, byteLength: original.byteLength,
			width: original.width, height: original.height }, source: { schemaVersion: 1, width: 2, height: 2,
			sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, tier: 'thumbnail' });
		targetKey = plan.key; check(plan.byteLength === 16, 'Literal thumbnail must be exactly sixteen bytes.');
		session = await createPhotoLibrarySessionV3({ name: 'Restored preview Close donor', indexedDB: factory, locks: navigator.locks });
		check((await session.readPage()).totalCount === 1, 'Current runtime3 failed to select the restored Photo.');
		phase = 'armed'; previewTask = settle(session.readPreview(photoId, 'thumbnail'));
		await Promise.race([entered.promise, previewTask.then(() => { check(fired, 'Preview settled without the requested native boundary.'); })]);
		check(fired && closeTask !== null, 'Actual allocated publication cut did not enter.');
		await outcomeReady.promise;
		// The native transaction is already terminal. Only its exact owner outcome
		// remains borrowed by the scheduler; no live transaction or ACK is fabricated.
		check(complete + abort === 1, 'Returned cache outcome must follow one genuine native transaction terminal.');
		const refused = await settle(session.readPage()); check(!refused.ok, 'Closed selected Session accepted new work.');
		for (let turn = 0; turn < 3; turn++) {
			check(!closeSettled && resourceClosesWhileHeld === 0, 'Close retired selected resources before the real cache outcome joined.');
			await new Promise<void>(resolve => { requestAnimationFrame(() => { resolve(); }); });
		}
		const heldPending = !closeSettled; check(heldPending, 'Close did not remain pending across held owner outcome delivery.');
		released = true; release.resolve(); const subscriber = await previewTask, closing = await closingWitness();
		check(jobSignal?.aborted === true, 'Actual scheduler cancellation must reach the cache owner.');
		const subscriberExactCancellation = !subscriber.ok && Object.is(subscriber.error, jobSignal.reason);
		check(subscriberExactCancellation && closing.ok, 'Selected Close or cancelled subscriber lost its real outcome.');
		check(selectedResourceClosesAfterRelease.catalog === 1 && selectedResourceClosesAfterRelease.media === 1,
			'Joined Close must retire each actual selected catalog and media connection exactly once after the held outcome.');
		session = null; phase = 'verify';
		const afterCut = await pairSnapshot(selected.location.mediaDatabaseName), committed = cut === 'completed-ack';
		check(committed ? afterCut.payload === 1 && afterCut.inventory === 1 : afterCut.payload === 0 && afterCut.inventory === 0,
			'The independently read durable pair disagrees with the requested native cut.');
		check(committed ? complete === 1 && abort === 0 : complete === 0 && abort === 1, 'Native transaction acknowledgement disagrees with durable state.');
		check(resourceClosesBeforeTerminal === 0 && previewNativeWriterOpens === 0, 'Allocated publication used an OPFS writer or retired resources before native settlement.');
		phase = 'reopen'; reopened = await createPhotoLibrarySessionV3({ name: 'Restored preview Close donor', indexedDB: factory, locks: navigator.locks });
		const again = await reopened.readPreview(photoId, 'thumbnail');
		check(again.outcome === 'ready' && again.cache === (committed ? 'hit' : 'stored'), 'Actual allocated reopen did not hit or regenerate as required.');
		const pixels = new Uint8Array(await again.preview.body.arrayBuffer()); let literalPixelsExact: boolean;
		try { literalPixelsExact = pixels.length === 16 && pixels.every((value, index) => value === [255, 32, 0, 255][index % 4]); }
		finally { pixels.fill(0); }
		check(literalPixelsExact && originalReads === (committed ? 0 : 1), 'Allocated reopen skipped real regeneration or changed literal pixels.');
		phase = 'verify'; const finalPair = await pairSnapshot(selected.location.mediaDatabaseName), after = await librarySnapshot(selected, photoId);
		check(finalPair.payload === 1 && finalPair.inventory === 1 && finalPair.bodySha256 === again.preview.outputSha256,
			'Reopened allocated cache pair is incomplete or unauthenticated.');
		if (committed) check(same(finalPair, afterCut), 'Cache hit changed the acknowledged native pair identity.');
		check(finalPair.pair?.originalMediaContentToken === before.contentToken, 'Cache no longer binds the allocated retained original token.');
		check(same(await selection(), selected), 'Close or reopen changed the committed selected allocation.');
		const donorAfter = await librarySnapshot(donorSelection, photoId);
		const originalResult = { photoExact: same(before.photo, after.photo), metadataExact: same(before.metadata, after.metadata),
			recordExact: before.recordJson === after.recordJson, contentTokenExact: before.contentToken === after.contentToken,
			custodyExact: before.custodyJson === after.custodyJson, bytesExact: before.bytesExact && after.bytesExact, sha256: originalSha256 };
		const donorResult = { catalogExact: donorBefore.catalogJson === donorAfter.catalogJson, photoExact: same(donorBefore.photo, donorAfter.photo),
			originalMetadataExact: same(donorBefore.metadata, donorAfter.metadata), originalRecordExact: donorBefore.recordJson === donorAfter.recordJson,
			custodyExact: donorBefore.custodyJson === donorAfter.custodyJson, bytesExact: donorBefore.bytesExact && donorAfter.bytesExact,
			cacheExact: donorBefore.cacheJson === donorAfter.cacheJson };
		check(Object.values(originalResult).every(value => value === true || value === originalSha256) && Object.values(donorResult).every(Boolean),
			'Allocated preview Close changed retained Photo/original facts or default donor data.');
		await reopened.close(); reopened = null;
		qualified = Object.freeze({ schemaVersion: 1, cut, selectedRestoredProfile: true,
			allocation: Object.freeze({ namespaceToken: selected.location.namespaceToken!, catalogDatabaseName: selected.location.catalogDatabaseName,
				mediaDatabaseName: selected.location.mediaDatabaseName, committedPointer: true }),
			close: Object.freeze({ samePromise, newWorkRefused: !refused.ok, fulfilled: closing.ok, subscriberExactCancellation,
				heldPending, resourceClosesWhileHeld, resourceClosesBeforeTerminal, selectedResourceClosesAfterRelease: Object.freeze({ ...selectedResourceClosesAfterRelease }) }),
			transaction: Object.freeze({ putSuccesses: Object.freeze([...putSuccesses]), complete, abort, terminalBeforeResources: resourceClosesBeforeTerminal === 0 }),
			afterCut, finalPair, reopened: Object.freeze({ cache: again.cache, originalReads, literalPixelsExact }),
			original: Object.freeze(originalResult), donor: Object.freeze(donorResult), previewNativeWriterOpens });
	} catch (error) { primaryFailed = true; primary = error; }
	finally {
		phase = 'verify'; released = true; release.resolve(); if (previewTask) await previewTask;
		if (donorSession) { try { await donorSession.close(); } catch (error) { cleanupFailures.push(error); } }
		if (closeTask) { const result = await closingWitness(); if (!result.ok) cleanupFailures.push(result.error); }
		else if (session) { try { await session.close(); } catch (error) { cleanupFailures.push(error); } }
		if (reopened) { try { await reopened.close(); } catch (error) { cleanupFailures.push(error); } }
		if (restoreRuntime) { try { await restoreRuntime.close(); } catch (error) { cleanupFailures.push(error); } }
		for (const restore of restores.reverse()) { try { restore(); } catch (error) { cleanupFailures.push(error); } }
		bytes.fill(0);
		const deleted = await Promise.allSettled([...ownedNames].map(removeDatabase));
		for (const result of deleted) if (result.status === 'rejected') cleanupFailures.push(result.reason as unknown);
		try { await root.removeEntry(NAMES.opfsDirectoryName, { recursive: true }); } catch (error) { if (!notFound(error)) cleanupFailures.push(error); }
	}
	if (cleanupFailures.length) throw new AggregateError([...(primaryFailed ? [primary] : []), ...cleanupFailures], 'Restored preview fixture cleanup failed.', primaryFailed ? { cause: primary } : undefined);
	if (primaryFailed) throw primary;
	check(qualified !== null, 'Restored preview qualification produced no joined scalar result.'); return qualified;

	function fire(at: PhotoRestoredPreviewSessionCloseCutV1): void {
		if (phase !== 'armed' || fired || at !== cut) return;
		check(session !== null, 'Current selected Session must own the native cut.'); fired = true;
		const closing = session.close(); samePromise = session.close() === closing;
		closeTask = settle(closing).then(value => { closeSettled = true; return value; }); entered.resolve();
	}
	function closingWitness(): Promise<Outcome<void>> { check(closeTask !== null, 'Actual selected Close witness missing.'); return closeTask; }
	function observeMethods(): void {
		const storePreview = PhotoPreviewCacheV1.prototype.store;
		replace(PhotoPreviewCacheV1.prototype, 'store', async function(this: PhotoPreviewCacheV1, ...args: Parameters<typeof storePreview>) {
			const observedPhase = phase, outcome = await settle(Reflect.apply(storePreview, this, args) as ReturnType<typeof storePreview>);
			if (observedPhase === 'armed' && fired) { outcomeReady.resolve(); await release.promise; }
			if (!outcome.ok) throw outcome.error; return outcome.value;
		});
		const plan = OpfsRepository.prototype.planBinaryWriter;
		replace(OpfsRepository.prototype, 'planBinaryWriter', async function(this: OpfsRepository, ...args: Parameters<typeof plan>) {
			const actual = await Reflect.apply(plan, this, args) as Awaited<ReturnType<typeof plan>>;
			if (args[0] === PREFIX && (phase === 'armed' || phase === 'reopen')) {
				check(actual === null, 'Allocated preview must select its real IndexedDB fallback.'); if (phase === 'armed') jobSignal = args[1]?.signal;
			} return actual;
		});
		const writer = OpfsSyncRepositoryBridge.prototype.openWriter;
		replace(OpfsSyncRepositoryBridge.prototype, 'openWriter', async function(this: OpfsSyncRepositoryBridge, ...args: Parameters<typeof writer>) {
			const actual = await Reflect.apply(writer, this, args) as Awaited<ReturnType<typeof writer>>;
			if (args[2].startsWith(PREFIX) && (phase === 'armed' || phase === 'reopen')) previewNativeWriterOpens++; return actual;
		});
		const load = MediaAssetLoadRepository.prototype.load;
		replace(MediaAssetLoadRepository.prototype, 'load', function(this: MediaAssetLoadRepository, ...args: Parameters<typeof load>) {
			if (phase === 'reopen' && args[0] === originalKey) originalReads++; return Reflect.apply(load, this, args) as ReturnType<typeof load>;
		});
	}
	function replace(owner: object, key: string, value: unknown): void {
		const saved = Object.getOwnPropertyDescriptor(owner, key); check(saved !== undefined, 'Native observation descriptor missing.');
		Object.defineProperty(owner, key, { ...saved, value }); restores.push(() => Object.defineProperty(owner, key, saved));
	}
	function observeFactory(native: IDBFactory): IDBFactory {
		const open = native.open.bind(native), remove = native.deleteDatabase.bind(native), cmp = native.cmp.bind(native), facades = new WeakMap<IDBDatabase, IDBDatabase>();
		return forward(native, key => key === 'open' ? (...args: Parameters<IDBFactory['open']>) => {
			if (!existingNames.has(args[0]) && (args[0] === NAMES.databaseName || args[0] === CATALOG
				|| /^lightscaper-photo-(?:media|catalog)-restore-[a-f0-9]{32}$/u.test(args[0]))) ownedNames.add(args[0]);
			const opening = open(...args);
			return forward(opening, property => {
				if (property !== 'result') return undefined;
				const database = opening.result; let facade = facades.get(database);
				if (!facade) { facade = observeDatabase(database); facades.set(database, facade); } return facade;
			});
		} : key === 'deleteDatabase' ? remove : key === 'cmp' ? cmp : undefined);
	}
	function observeDatabase(database: IDBDatabase): IDBDatabase {
		const transaction = database.transaction.bind(database), close = database.close.bind(database);
		let closed = false;
		return forward(database, key => key === 'close' ? () => {
			const observed = phase === 'armed' && fired, first = !closed;
			if (observed) { if (!released) resourceClosesWhileHeld++; if (complete + abort === 0) resourceClosesBeforeTerminal++; }
			close(); closed = true;
			if (observed && first && released && complete + abort === 1) {
				if (database.name === selected?.location.catalogDatabaseName) selectedResourceClosesAfterRelease.catalog++;
				if (database.name === selected?.location.mediaDatabaseName) selectedResourceClosesAfterRelease.media++;
			}
		} : key !== 'transaction' ? undefined : (...args: Parameters<IDBDatabase['transaction']>) => {
			const native = transaction(...args);
			if (phase !== 'armed' || database.name !== selected?.location.mediaDatabaseName || native.mode !== 'readwrite'
				|| ![PAYLOAD, INVENTORY, 'mediaAssets'].every(name => native.objectStoreNames.contains(name))) return native;
			let targeted = false;
			native.addEventListener('complete', () => { if (targeted) { complete++; fire('completed-ack'); } }, { once: true });
			native.addEventListener('abort', () => { if (targeted) abort++; }, { once: true });
			return forward(native, property => property !== 'objectStore' ? undefined : (name: string) => {
				const actual = native.objectStore(name), put = actual.put.bind(actual);
				return name !== PAYLOAD && name !== INVENTORY ? actual : forward(actual, method => method !== 'put' ? undefined : (...values: Parameters<IDBObjectStore['put']>) => {
					const writing = put(...values), candidate: unknown = values[0];
					if (candidate !== null && typeof candidate === 'object' && (candidate as { key?: unknown }).key === targetKey) {
						targeted = true; writing.addEventListener('success', () => { putSuccesses.push(name); fire(name === PAYLOAD ? 'payload-put' : 'inventory-put'); }, { once: true });
					} return writing;
				});
			});
		});
	}
	async function selection(): Promise<Readonly<PhotoLibrarySessionLocationV2>> {
		const anchor = new PhotoMediaStoreV1({ indexedDB: nativeFactory, locks: navigator.locks });
		try { return await withPhotoLibraryInitializationLockV1(navigator.locks, authority => readPhotoLibrarySessionLocationV2({
			settings: anchor.settingsRepository, initializeDefault: async () => { throw new Error('Qualification selection may not initialize a library.'); },
		}, authority.signal)); } finally { await anchor.close(); }
	}
	async function librarySnapshot(location: Readonly<PhotoLibrarySessionLocationV2>, photoId: string) {
		const media = new PhotoMediaStoreV1({ indexedDB: nativeFactory, locks: navigator.locks,
			databaseName: location.location.mediaDatabaseName, preferOpfs: location.allocation === null });
		const catalog = new PhotoCatalogRepositoryV2({ indexedDB: nativeFactory, databaseName: location.location.catalogDatabaseName, verifyOriginal: media.verifyOriginal });
		const result = await settle(read());
		const failures: unknown[] = [];
		if (location.allocation === null) {
			try { await companion(); } catch (error) { failures.push(error); }
		}
		try { await catalog.close(); } catch (error) { failures.push(error); }
		try { await media.close(); } catch (error) { failures.push(error); }
		if (failures.length) throw new AggregateError([...(!result.ok ? [result.error] : []), ...failures],
			'Native original snapshot cleanup failed.', !result.ok ? { cause: result.error } : undefined);
		if (!result.ok) throw result.error; return result.value;
		async function read() {
			const catalogSnapshot = await catalog.readSnapshot(location.location.catalogId), photo = await catalog.loadPhoto(location.location.catalogId, photoId);
			check(catalogSnapshot?.catalog.photoCount === 1 && photo !== null && photo.original.byteLength === bytes.length, 'Snapshot must contain one complete bounded original Photo.');
			await media.verifyOriginal(photo.original); const metadata = await media.mediaRepository.getAssetMetadata(photo.original.storageKey);
			const body = await media.mediaRepository.loadAsset(photo.original.storageKey); check(body !== null && body.size === bytes.length, 'Retained encoded original missing.');
			const encoded = new Uint8Array(await body.arrayBuffer()); let bytesExact: boolean;
			try { bytesExact = equal(bytes, encoded) && await digest(encoded) === originalSha256; } finally { encoded.fill(0); }
			const publicPage = await media.mediaRepository.catalogOriginals.readPage({ catalogId: photo.catalogId });
			const native = await withDatabase(location.location.mediaDatabaseName, database => transact(database, ['mediaAssets', 'catalogOriginalRoots', PAYLOAD, INVENTORY], 'readonly', async stores => {
				const record: unknown = await request(store(stores, 'mediaAssets').get(photo.original.storageKey));
				check(record !== null && typeof record === 'object', 'Retained original native record missing.');
				const token: unknown = (record as { mediaContentToken?: unknown }).mediaContentToken;
				check(typeof token === 'string', 'Retained original content token missing.');
				const rows: unknown[] = await request(store(stores, 'catalogOriginalRoots').getAll(undefined, 3));
				check(rows.length === 1 && publicPage.roots.length === 1 && publicPage.afterKey === null, 'One-photo custody probe must be complete.');
				const roots = rows.map(normalizeCatalogOriginalRoot), publicRoots = publicPage.roots.map(normalizeCatalogOriginalRoot), first = roots[0]!;
				check(same(roots, publicRoots) && first.photoId === photo.id && first.catalogId === photo.catalogId && first.assetId === photo.original.storageKey
					&& first.sourceId === photo.original.id && first.sha256 === originalSha256 && first.size === bytes.length && first.mediaContentToken === token && first.importId === null,
					'Actual native and public permanent original custody disagree.');
				const counts = await Promise.all([request(store(stores, PAYLOAD).count()), request(store(stores, INVENTORY).count())]);
				if (location.allocation === null) check(counts.every(count => count === 0), 'Default donor cache must remain empty.');
				return { recordJson: JSON.stringify(record), contentToken: token, custodyJson: JSON.stringify(roots), cacheJson: JSON.stringify(counts) };
			}));
			return { photo, metadata, catalogJson: JSON.stringify(catalogSnapshot), bytesExact, ...native };
		}
	}
	async function pairSnapshot(databaseName: string): Promise<PairSnapshot> {
		return withDatabase(databaseName, database => transact(database, [PAYLOAD, INVENTORY], 'readonly', async stores => {
			const payload: unknown[] = await request(store(stores, PAYLOAD).getAll(IDBKeyRange.only(targetKey), 2));
			const inventory: unknown[] = await request(store(stores, INVENTORY).getAll(IDBKeyRange.only(targetKey), 2));
			check(payload.length === inventory.length && payload.length <= 1, 'Allocated cache pair is torn or duplicated.');
			if (payload.length === 0) return Object.freeze({ payload: 0, inventory: 0, pair: null, bodySha256: null });
			const pair = readBinaryDerivativeCacheRecordV1(inventory[0], targetKey, PROFILE), bodyPair = readBinaryDerivativeCacheRecordV1(payload[0], targetKey, PROFILE, true);
			const blob: unknown = (payload[0] as { blob?: unknown }).blob;
			check(same(pair, bodyPair) && pair.storage === 'indexeddb-blob' && pair.path === null && pair.size === 16 && pair.sourceId === originalKey
				&& pair.originalSha256 === originalSha256 && pair.originalByteLength === bytes.length && blob instanceof Blob && blob.size === 16,
				'Actual allocated payload and scalar inventory disagree.');
			const data = new Uint8Array(await blob.arrayBuffer()); let bodySha256: string;
			try { bodySha256 = await digest(data); } finally { data.fill(0); }
			check(bodySha256 === pair.outputSha256, 'Allocated cache Blob digest changed.');
			return Object.freeze({ payload: 1, inventory: 1, pair, bodySha256 });
		}));
	}
	async function withDatabase<Value>(name: string, run: (database: IDBDatabase) => Promise<Value>): Promise<Value> {
		const database = await openDatabase(nativeFactory, name); try { return await run(database); } finally { database.close(); }
	}
	function removeDatabase(name: string): Promise<void> {
		return new Promise((resolve, reject) => { const removing = nativeFactory.deleteDatabase(name);
			removing.onsuccess = () => resolve(); removing.onerror = () => reject(removing.error); removing.onblocked = () => reject(new Error('Owned database cleanup blocked.')); });
	}
}

function forward<Value extends object>(value: Value, replacement: (key: PropertyKey) => unknown): Value {
	return new Proxy(value, { get(target, key) { const changed = replacement(key); if (changed !== undefined) return changed;
		const actual: unknown = Reflect.get(target, key, target); return typeof actual === 'function' ? actual.bind(target) as unknown : actual; },
		set(target, key, next: unknown) { return Reflect.set(target, key, next, target); } });
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function settle<Value>(work: Promise<Value>): Promise<Outcome<Value>> { return work.then(value => ({ ok: true, value }), (error: unknown) => ({ ok: false, error })); }
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function same(first: unknown, second: unknown): boolean { return JSON.stringify(first) === JSON.stringify(second); }
function equal(first: Uint8Array, second: Uint8Array): boolean { return first.length === second.length && first.every((value, index) => value === second[index]); }
function store(stores: Readonly<Record<string, IDBObjectStore>>, name: string): IDBObjectStore { const value = stores[name]; check(value, 'Actual native store missing.'); return value; }
async function digest(bytes: Uint8Array): Promise<string> {
	const owned = new Uint8Array(bytes);
	try { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', owned.buffer)), byte => byte.toString(16).padStart(2, '0')).join(''); }
	finally { owned.fill(0); }
}
function notFound(error: unknown): boolean {
	try { return Reflect.apply(Object.getOwnPropertyDescriptor(DOMException.prototype, 'name')!.get!, error, []) === 'NotFoundError'; }
	catch { return false; }
}
