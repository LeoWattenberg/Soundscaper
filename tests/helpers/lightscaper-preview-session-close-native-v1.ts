/* SPDX-License-Identifier: AGPL-3.0-only */

import { binaryDerivativeManifestV1, normalizeBinaryDerivativeCacheIdentityV1, readBinaryDerivativeCacheRecordV1,
	type BinaryDerivativeCacheRecordV1 } from '../../src/common/editor/storage/binary-derivative-cache-records.ts';
import { openDatabase, request, transact } from '../../src/common/editor/storage/indexeddb-backend.ts';
import { OpfsRepository, type OpfsBinaryWriter } from '../../src/common/editor/storage/opfs-repository.ts';
import { OpfsSyncRepositoryBridge } from '../../src/common/editor/storage/opfs-sync-repository-bridge.ts';
import { PhotoCatalogRepositoryV2 } from '../../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { createPhotoLibrarySessionV3 } from '../../src/lightscaper/photo-library-session-runtime-v3.ts';
import { PHOTO_PREVIEW_CACHE_PROFILE_V1 as PROFILE } from '../../src/lightscaper/preview/photo-preview-cache-v1.ts';
import { planPhotoPreviewV1 } from '../../src/lightscaper/preview/photo-preview-plan-v1.ts';
import { PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1 } from '../../src/lightscaper/storage/photo-library-catalog-pointer.ts';
import { readPhotoLibraryLocationPointerV2, PHOTO_LIBRARY_DEFAULT_CATALOG_DATABASE_NAME_V2 as CATALOG } from '../../src/lightscaper/storage/photo-library-location-v2.ts';
import { PhotoMediaStoreV1, PHOTO_MEDIA_NAMESPACES_V1 as NAMES } from '../../src/lightscaper/storage/photo-media-store.ts';

export type PhotoPreviewSessionCloseCutV1 = 'after-write' | 'after-close' | 'payload-put' | 'inventory-put' | 'completed-ack' | 'cleanup-ack';
type Session = Awaited<ReturnType<typeof createPhotoLibrarySessionV3>>;
type Outcome<Value> = { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly error: unknown };
interface PairSnapshot {
	readonly payload: number; readonly inventory: number; readonly pair: BinaryDerivativeCacheRecordV1 | null;
	readonly pathPresent: boolean; readonly bodySha256: string | null;
}
export interface PhotoPreviewSessionCloseNativeResultV1 {
	readonly schemaVersion: 1; readonly cut: PhotoPreviewSessionCloseCutV1; readonly selectedDefaultProfile: true;
	readonly close: { readonly samePromise: boolean; readonly heldPending: boolean | null; readonly newWorkRefused: boolean;
		readonly resourceClosesWhileHeld: number; readonly fulfilled: boolean; readonly cleanupFailureExact: boolean };
	readonly native: { readonly writerOpens: number; readonly writeBytes: number; readonly closeAcks: number;
		readonly operationId: 'media-asset-chunk-write'; readonly workerProof: boolean };
	readonly transaction: { readonly putSuccesses: readonly string[]; readonly complete: number; readonly abort: number };
	readonly afterCut: PairSnapshot; readonly finalPair: PairSnapshot; readonly oldPathAbsent: boolean | null;
	readonly reopened: { readonly cache: string; readonly nativeWriterOpens: number; readonly originalReads: number; readonly literalPixelsExact: boolean };
	readonly original: { readonly photoExact: boolean; readonly metadataExact: boolean; readonly custodyExact: boolean; readonly bytesExact: boolean; readonly sha256: string };
}

const PAYLOAD = 'videoDerivatives', INVENTORY = 'videoDerivativeCacheEntries', PREFIX = 'binary-cache-photo-preview-cache';
// Independent encoded 2x2 PNG: its first PLTE entry is [255,32,0], all four indices are zero.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQMAAABIeJ9nAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8gAP///4DcGxUAAAABYktHRAH/Ai3eAAAAB3RJTUUH6ggZEjoj/gYZhQAAAAxJREFUCNdjYGBgAAAABAABJzQnCgAAAABJRU5ErkJggg==';

/** Real selected runtime3 and native sync worker; observations never substitute a decoder or scheduler. */
export async function qualifyPhotoPreviewSessionCloseNativeV1(cut: PhotoPreviewSessionCloseCutV1): Promise<PhotoPreviewSessionCloseNativeResultV1> {
	check(['after-write', 'after-close', 'payload-put', 'inventory-put', 'completed-ack', 'cleanup-ack'].includes(cut), 'Unknown native Close cut.');
	const root = await navigator.storage.getDirectory(), nativeFactory = indexedDB;
	check(!(await nativeFactory.databases()).some(item => item.name === NAMES.databaseName || item.name === CATALOG), 'Qualification requires a fresh selected library.');
	let existing: FileSystemDirectoryHandle | null = null;
	try { existing = await root.getDirectoryHandle(NAMES.opfsDirectoryName); } catch (error) { if (!notFound(error)) throw error; }
	if (existing) check((await directoryNames(existing)).length === 0, 'Qualification cannot delete a preexisting native directory.');
	const entered = deferred(), release = deferred(), cleanupFailure = Symbol('native delete completed; cleanup acknowledgement lost');
	const bytes = Uint8Array.from(atob(PNG), value => value.charCodeAt(0)), originalSha256 = await digest(bytes);
	let session: Session | null = null, reopened: Session | null = null;
	let previewTask: Promise<Outcome<Awaited<ReturnType<Session['readPreview']>>>> | null = null;
	let closeTask: Promise<Outcome<void>> | null = null, closePromise: Promise<void> | null = null;
	let phase: 'setup' | 'armed' | 'reopen' | 'verify' = 'setup', fired = false, released = false, closeSettled = false;
	let targetKey = '', originalKey = '', newPath: string | null = null, oldPath: string | null = null;
	const targetRepositories = new WeakSet<OpfsRepository>(); let jobSignal: AbortSignal | undefined;
	let nativeWriterOpens = 0, writeBytes = 0, closeAcks = 0, workerProof = false, reopenWriterOpens = 0, originalReads = 0;
	let complete = 0, abort = 0, samePromise = false, heldPending: boolean | null = null, resourceClosesWhileHeld = 0;
	const putSuccesses: string[] = [], restores: (() => void)[] = [];
	const cleanupFailures: unknown[] = []; let qualified: PhotoPreviewSessionCloseNativeResultV1 | null = null;
	let primaryFailed = false, primary: unknown;
	const held = cut === 'after-write' || cut === 'after-close' || cut === 'cleanup-ack';
	const committed = cut === 'completed-ack' || cut === 'cleanup-ack';
	function fire(at: PhotoPreviewSessionCloseCutV1): void {
		if (phase !== 'armed' || fired || at !== cut) return;
		check(session !== null, 'The selected Session must own the cut.'); fired = true;
		closePromise = session.close(); samePromise = session.close() === closePromise;
		closeTask = settle(closePromise).then(result => { closeSettled = true; return result; }); entered.resolve();
	}
	function closingWitness(): Promise<Outcome<void>> { check(closeTask !== null, 'The selected Close witness is required.'); return closeTask; }
	async function companion(): Promise<void> {
		const callback = (globalThis as typeof globalThis & { __assertNativeOpfsWorkerExecution?: () => Promise<void> }).__assertNativeOpfsWorkerExecution;
		check(typeof callback === 'function', 'The ordinary native worker companion is required.'); await callback(); workerProof = true;
	}
	const factory = observeFactory(nativeFactory);
	observeMethods();
	try {
		session = await createPhotoLibrarySessionV3({ name: 'Preview Session Close qualification', indexedDB: factory, locks: navigator.locks });
		check((await session.readPage()).totalCount === 0, 'The actual selected catalog was not empty.');
		const receipts = await session.importFiles([new File([bytes], 'preview-close.png', { type: 'image/png' })]);
		const receipt = receipts[0]; check(receipts.length === 1 && receipt?.status === 'imported' && receipt.photoId !== null, 'Actual managed import did not acknowledge one Photo.');
		const photoId = receipt.photoId, before = await originalSnapshot(photoId);
		originalKey = before.photo.original.storageKey;
		const original = before.photo.original;
		const plan = planPhotoPreviewV1({ binding: { catalogId: before.photo.catalogId, photoId, originalId: original.id,
			storageKey: original.storageKey, contentSha256: original.contentSha256, byteLength: original.byteLength, width: original.width, height: original.height },
			source: { schemaVersion: 1, width: 2, height: 2, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, tier: 'thumbnail' });
		targetKey = plan.key; check(plan.byteLength === 16 && before.bytesExact, 'The retained literal original or preview plan changed.');
		if (cut === 'cleanup-ack') {
			const baseline = await session.readPreview(photoId, 'thumbnail');
			check(baseline.outcome === 'ready' && baseline.cache === 'stored', 'Actual baseline preview must be stored.');
			const pair = await snapshot(targetKey, null); oldPath = pair.pair?.path ?? null;
			check(oldPath !== null && pair.bodySha256 === baseline.preview.outputSha256, 'Baseline native pair was not complete.');
			// Explicit disposable future-labelled cache data: version2 is admitted by shared
			// storage, but mismatches the real current Photo preview recipe1. No forced miss.
			await withDatabase(async database => transact(database, [PAYLOAD, INVENTORY], 'readwrite', async stores => {
				const payload: unknown = await request(store(stores, PAYLOAD).get(targetKey));
				const inventory: unknown = await request(store(stores, INVENTORY).get(targetKey));
				const scalar = readBinaryDerivativeCacheRecordV1(inventory, targetKey, PROFILE);
				const identity = normalizeBinaryDerivativeCacheIdentityV1(JSON.parse(scalar.binaryDerivativeManifest) as unknown, PROFILE);
				const updated = { ...scalar, recipeVersion: 2, binaryDerivativeManifest: binaryDerivativeManifestV1({ ...identity, recipeVersion: 2 }) };
				check(payload !== null && typeof payload === 'object', 'Baseline payload is required.');
				readBinaryDerivativeCacheRecordV1(updated, targetKey, PROFILE);
				await Promise.all([request(store(stores, PAYLOAD).put({ ...payload, ...updated })), request(store(stores, INVENTORY).put(updated))]);
			}));
			check((await snapshot(targetKey, oldPath)).pair?.recipeVersion === 2, 'Synthetic mismatch must remain an admitted exact pair.');
		}
		phase = 'armed'; previewTask = settle(session.readPreview(photoId, 'thumbnail'));
		await Promise.race([entered.promise, previewTask.then(() => { check(fired, 'Preview settled without the requested native boundary.'); })]);
		check(fired && closeTask !== null && newPath !== null, 'Actual native cut did not enter.');
		const refused = await settle(session.readPage()); check(!refused.ok, 'Closed Session accepted new work.');
		if (held) {
			// Keep the actual native acknowledgement held across independent browser
			// turns; one microtask could miss an incorrectly early cleanup chain.
			check(!closeSettled && resourceClosesWhileHeld === 0, 'Close retired resources before native acknowledgement joined.');
			for (let turn = 0; turn < 3; turn++) {
				await new Promise<void>(resolve => { setTimeout(resolve, 16); });
				check(!closeSettled && resourceClosesWhileHeld === 0, 'Close retired resources while native acknowledgement remained held.');
			}
			heldPending = true;
		}
		released = true; release.resolve();
		const subscriber = await previewTask, closing = await closingWitness();
		check(jobSignal?.aborted === true, 'Actual scheduler cancellation did not reach the native plan.');
		check(!subscriber.ok && subscriber.error === jobSignal.reason, 'Cancelled preview subscriber lost the native reason.');
		const cleanupFailureExact = !closing.ok && containsOpaque(closing.error, cleanupFailure);
		check(cut === 'cleanup-ack' ? cleanupFailureExact : closing.ok, 'Close lost a distinct cleanup failure or failed ordinary cancellation.');
		session = null; phase = 'verify';
		const afterCut = await snapshot(targetKey, newPath);
		check(committed ? afterCut.payload === 1 && afterCut.inventory === 1 && afterCut.pathPresent : afterCut.payload === 0 && afterCut.inventory === 0 && !afterCut.pathPresent,
			'The independently read pair disagrees with actual transaction acknowledgement.');
		check(nativeWriterOpens === 1 && writeBytes === 16 && workerProof, 'Actual native sync writer proof is incomplete.');
		check(committed ? complete === 1 && abort === 0 : complete === 0, 'Transaction completion disagrees with the cut.');
		if (cut === 'payload-put' || cut === 'inventory-put') check(abort === 1, 'Session cancellation must abort the native publication transaction.');
		const oldPathAbsent = oldPath === null ? null : !await pathExists(oldPath); check(oldPathAbsent !== false, 'Acknowledged native replacement left the old path.');
		phase = 'reopen'; reopened = await createPhotoLibrarySessionV3({ name: 'Preview Session Close qualification', indexedDB: factory, locks: navigator.locks });
		const again = await reopened.readPreview(photoId, 'thumbnail');
		check(again.outcome === 'ready' && again.cache === (committed ? 'hit' : 'stored'), 'Actual reopen did not hit or regenerate as required.');
		const previewBytes = new Uint8Array(await again.preview.body.arrayBuffer());
		let literalPixelsExact: boolean;
		try { literalPixelsExact = literalPixels(previewBytes); check(literalPixelsExact, 'Native reopened preview disagrees with literal PNG palette pixels.'); } finally { previewBytes.fill(0); }
		check(committed ? reopenWriterOpens === 0 && originalReads === 0 : reopenWriterOpens === 1 && originalReads === 1, 'Reopen substituted a cache hit or skipped native regeneration.');
		await companion(); phase = 'verify';
		const finalPair = await snapshot(targetKey, null), after = await originalSnapshot(photoId);
		check(finalPair.payload === 1 && finalPair.inventory === 1 && finalPair.pathPresent && finalPair.bodySha256 === again.preview.outputSha256, 'Reopened acknowledged native pair is incomplete.');
		if (committed) check(JSON.stringify(finalPair) === JSON.stringify(afterCut), 'Reopen changed the acknowledged pair token or native body.');
		check(finalPair.pair?.originalMediaContentToken === after.mediaContentToken, 'Preview no longer binds the current retained original token.');
		const originalResult = { photoExact: JSON.stringify(before.photo) === JSON.stringify(after.photo), metadataExact: JSON.stringify(before.metadata) === JSON.stringify(after.metadata) && before.record === after.record,
			custodyExact: before.custody === after.custody, bytesExact: before.bytesExact && after.bytesExact, sha256: originalSha256 };
		check(Object.values(originalResult).every(value => value === true || value === originalSha256), 'Preview Close mutated retained original facts or custody.');
		await reopened.close(); reopened = null;
		qualified = Object.freeze({ schemaVersion: 1, cut, selectedDefaultProfile: true, close: Object.freeze({ samePromise, heldPending, newWorkRefused: !refused.ok,
			resourceClosesWhileHeld, fulfilled: closing.ok, cleanupFailureExact }), native: Object.freeze({ writerOpens: nativeWriterOpens, writeBytes, closeAcks,
			operationId: 'media-asset-chunk-write', workerProof }), transaction: Object.freeze({ putSuccesses: Object.freeze([...putSuccesses]), complete, abort }),
			afterCut, finalPair, oldPathAbsent, reopened: Object.freeze({ cache: again.cache, nativeWriterOpens: reopenWriterOpens, originalReads, literalPixelsExact }), original: Object.freeze(originalResult) });
	} catch (error) { primaryFailed = true; primary = error; }
	finally {
		phase = 'verify'; released = true; release.resolve();
		if (previewTask) await previewTask;
		if (session) { const result = closeTask ? await closeTask : await settle(session.close()); if (!result.ok) cleanupFailures.push(result.error); }
		if (reopened) { const result = await settle(reopened.close()); if (!result.ok) cleanupFailures.push(result.error); }
		for (const restore of restores.reverse()) { try { restore(); } catch (error) { cleanupFailures.push(error); } } bytes.fill(0);
		const cleanup = await Promise.allSettled([removeDatabase(NAMES.databaseName), removeDatabase(CATALOG), root.removeEntry(NAMES.opfsDirectoryName, { recursive: true })]);
		for (const result of cleanup) if (result.status === 'rejected') cleanupFailures.push(result.reason as unknown);
	}
	if (cleanupFailures.length) throw new AggregateError([...(primaryFailed ? [primary] : []), ...cleanupFailures], 'Native preview Close fixture cleanup failed.', primaryFailed ? { cause: primary } : undefined);
	if (primaryFailed) throw primary;
	check(qualified !== null, 'Native qualification did not produce joined scalar evidence.'); return qualified;

	function observeMethods(): void {
		const plan = OpfsRepository.prototype.planBinaryWriter;
		replace(OpfsRepository.prototype, 'planBinaryWriter', async function(this: OpfsRepository, ...args: Parameters<typeof plan>) {
			const actual = await Reflect.apply(plan, this, args);
			if (args[0] !== PREFIX || (phase !== 'armed' && phase !== 'reopen')) return actual;
			check(actual !== null, 'The actual selected cache must admit native OPFS staging.');
			if (phase === 'armed') { targetRepositories.add(this); newPath = actual.path; jobSignal = args[1]?.signal; }
			return { path: actual.path, open: async () => {
				const writer = await actual.open(); check(writer !== null, 'The actual native OPFS writer was unavailable.');
				const write = writer.write.bind(writer), close = writer.close.bind(writer), abortWriter = writer.abort.bind(writer);
				return { path: writer.path, async write(...values: Parameters<OpfsBinaryWriter['write']>) {
					await write(...values); fire('after-write'); if (phase === 'armed' && cut === 'after-write') await release.promise;
				}, async close(...values: Parameters<OpfsBinaryWriter['close']>) {
					await close(...values); fire('after-close'); if (phase === 'armed' && cut === 'after-close') await release.promise;
				}, abort: abortWriter };
			} };
		});
		const open = OpfsSyncRepositoryBridge.prototype.openWriter;
		replace(OpfsSyncRepositoryBridge.prototype, 'openWriter', async function(this: OpfsSyncRepositoryBridge, ...args: Parameters<typeof open>) {
			const writer = await Reflect.apply(open, this, args);
			if (!args[2].startsWith(PREFIX) || (phase !== 'armed' && phase !== 'reopen')) return writer;
			check(writer !== null && args[1] === 'media-asset-chunk-write', 'Sync-worker native writer acknowledgement is required; fallback does not qualify.');
			const observedPhase = phase; if (observedPhase === 'armed') nativeWriterOpens++; else reopenWriterOpens++;
			const write = writer.write.bind(writer), close = writer.close.bind(writer), abortWriter = writer.abort.bind(writer);
			return { async write(...values: Parameters<typeof writer.write>) {
				const length = values[0].byteLength; await write(...values);
				if (observedPhase === 'armed') writeBytes += length; await companion();
			}, async close(...values: Parameters<typeof writer.close>) {
				await close(...values); if (observedPhase === 'armed') closeAcks++; await companion();
			}, abort: abortWriter };
		});
		const remove = OpfsRepository.prototype.deletePath;
		replace(OpfsRepository.prototype, 'deletePath', async function(this: OpfsRepository, ...args: Parameters<typeof remove>) {
			await Reflect.apply(remove, this, args);
			if (phase === 'armed' && cut === 'cleanup-ack' && oldPath !== null && args[0] === oldPath) {
				check(!await pathExists(oldPath), 'Genuine old-path deletion did not settle.'); fire('cleanup-ack'); await release.promise; throw cleanupFailure;
			}
		});
		const close = OpfsRepository.prototype.close;
		replace(OpfsRepository.prototype, 'close', function(this: OpfsRepository) {
			if (fired && held && !released && targetRepositories.has(this)) resourceClosesWhileHeld++;
			return Reflect.apply(close, this, []);
		});
		const load = OpfsRepository.prototype.loadBinaryRecord;
		replace(OpfsRepository.prototype, 'loadBinaryRecord', async function(this: OpfsRepository, ...args: Parameters<typeof load>) {
			const observedPhase = phase, originalRead = args[0].sourceId === originalKey
				&& (args[2] === undefined || args[2] === 'media-asset-chunk-read');
			const loaded = await Reflect.apply(load, this, args);
			if (observedPhase === 'reopen' && originalRead) originalReads++;
			return loaded;
		});
	}
	function replace(owner: object, key: string, value: unknown): void {
		const saved = Object.getOwnPropertyDescriptor(owner, key); check(saved !== undefined, 'Native observation descriptor is required.');
		Object.defineProperty(owner, key, { ...saved, value }); restores.push(() => Object.defineProperty(owner, key, saved));
	}
	function observeFactory(native: IDBFactory): IDBFactory {
		const open = native.open.bind(native), remove = native.deleteDatabase.bind(native), cmp = native.cmp.bind(native);
		const facades = new WeakMap<IDBDatabase, IDBDatabase>();
		return forward(native, key => key === 'open' ? (...args: Parameters<IDBFactory['open']>) => {
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
		return forward(database, key => key === 'close' ? () => { if (fired && held && !released) resourceClosesWhileHeld++; close(); }
			: key !== 'transaction' ? undefined : (...args: Parameters<IDBDatabase['transaction']>) => {
				const native = transaction(...args);
				if (phase !== 'armed' || native.mode !== 'readwrite' || ![PAYLOAD, INVENTORY, 'mediaAssets'].every(name => native.objectStoreNames.contains(name))) return native;
				let targeted = false;
				native.addEventListener('complete', () => { if (targeted) { complete++; fire('completed-ack'); } }, { once: true });
				native.addEventListener('abort', () => { if (targeted) abort++; }, { once: true });
				return forward(native, property => property !== 'objectStore' ? undefined : (name: string) => {
					const actual = native.objectStore(name), put = actual.put.bind(actual);
					return name !== PAYLOAD && name !== INVENTORY ? actual : forward(actual, method => method !== 'put' ? undefined : (...values: Parameters<IDBObjectStore['put']>) => {
						const writing = put(...values), record: unknown = values[0];
						if (record !== null && typeof record === 'object' && (record as { key?: unknown }).key === targetKey) {
							targeted = true; writing.addEventListener('success', () => {
								putSuccesses.push(name); fire(name === PAYLOAD ? 'payload-put' : 'inventory-put');
							}, { once: true });
						} return writing;
					});
				});
			});
	}
	async function originalSnapshot(photoId: string) {
		const media = new PhotoMediaStoreV1({ indexedDB: nativeFactory, locks: navigator.locks });
		const catalog = new PhotoCatalogRepositoryV2({ indexedDB: nativeFactory, verifyOriginal: media.verifyOriginal });
		try {
			const pointer = readPhotoLibraryLocationPointerV2(await media.settingsRepository.get(PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1));
			check(pointer.schemaVersion === 1, 'Actual fresh initialization must select the default anchor profile.');
			const photo = await catalog.loadPhoto(pointer.catalogId, photoId); check(photo !== null, 'Imported full Photo is missing.');
			const metadata = await media.mediaRepository.getAssetMetadata(photo.original.storageKey);
			check(metadata?.storage === 'opfs' && typeof metadata.path === 'string', 'Actual retained original must use native OPFS.');
			const originalBody = await media.mediaRepository.loadAsset(photo.original.storageKey);
			check(originalBody !== null, 'Retained original is unavailable.'); const retained = new Uint8Array(await originalBody.arrayBuffer());
			let bytesExact: boolean;
			try { bytesExact = equal(bytes, retained) && await digest(retained) === originalSha256 && await fileDigest(metadata.path) === originalSha256; } finally { retained.fill(0); }
			const authority = await withDatabase(database => transact(database, ['mediaAssets', 'catalogOriginalRoots'], 'readonly', async stores => {
				const record: unknown = await request(store(stores, 'mediaAssets').get(photo.original.storageKey));
				check(record !== null && typeof record === 'object', 'Native original scalar record is required.');
				const mediaContentToken: unknown = (record as { mediaContentToken?: unknown }).mediaContentToken;
				check(typeof mediaContentToken === 'string', 'Native original content token is required.');
				const rows: unknown[] = await request(store(stores, 'catalogOriginalRoots').getAll(undefined, 3));
				check(rows.length > 0 && rows.length < 3, 'One imported original must have bounded actual custody roots.');
				return { custody: JSON.stringify(rows), record: JSON.stringify(record), mediaContentToken };
			}));
			return { photo, metadata, ...authority, bytesExact };
		} finally { try { await catalog.close(); } finally { await media.close(); } }
	}
	async function snapshot(key: string, path: string | null): Promise<PairSnapshot> {
		const pair = await withDatabase(database => transact(database, [PAYLOAD, INVENTORY], 'readonly', async stores => {
			const payload: unknown[] = await request(store(stores, PAYLOAD).getAll(IDBKeyRange.only(key), 2));
			const inventory: unknown[] = await request(store(stores, INVENTORY).getAll(IDBKeyRange.only(key), 2));
			check(payload.length === inventory.length && payload.length <= 1, 'Native cache pair is torn or duplicated.');
			if (payload.length === 0) return null;
			const first = readBinaryDerivativeCacheRecordV1(payload[0], key, PROFILE, true), second = readBinaryDerivativeCacheRecordV1(inventory[0], key, PROFILE);
			check(JSON.stringify(first) === JSON.stringify(second) && first.storage === 'opfs' && first.path !== null && first.size === 16, 'Paired native scalar records disagree.'); return first;
		}));
		const actualPath = pair?.path ?? path, pathPresent = actualPath !== null && await pathExists(actualPath);
		const bodySha256 = pair?.path && pathPresent ? await fileDigest(pair.path) : null;
		check(pair === null || bodySha256 === pair.outputSha256, 'Native cache body no longer authenticates.');
		return Object.freeze({ payload: pair ? 1 : 0, inventory: pair ? 1 : 0, pair, pathPresent, bodySha256 });
	}
	async function withDatabase<Value>(run: (database: IDBDatabase) => Promise<Value>): Promise<Value> {
		const database = await openDatabase(nativeFactory, NAMES.databaseName); try { return await run(database); } finally { database.close(); }
	}
	async function pathExists(path: string): Promise<boolean> {
		try { const directory = await root.getDirectoryHandle(NAMES.opfsDirectoryName); await directory.getFileHandle(path); return true; }
		catch (error) { if (notFound(error)) return false; throw error; }
	}
	async function fileDigest(path: string): Promise<string> {
		const directory = await root.getDirectoryHandle(NAMES.opfsDirectoryName), file = await (await directory.getFileHandle(path)).getFile();
		check(file.size <= 1024, 'Literal native file exceeds its fixture bound.'); const contents = new Uint8Array(await file.arrayBuffer());
		try { return await digest(contents); } finally { contents.fill(0); }
	}
	function removeDatabase(name: string): Promise<void> {
		return new Promise((resolve, reject) => { const deleting = nativeFactory.deleteDatabase(name); deleting.onsuccess = () => resolve();
			deleting.onerror = () => reject(deleting.error); deleting.onblocked = () => reject(new Error('Owned native database cleanup was blocked.')); });
	}
}

function forward<Value extends object>(value: Value, replacement: (key: PropertyKey) => unknown): Value {
	return new Proxy(value, { get(target, key) { const replaced = replacement(key); if (replaced !== undefined) return replaced;
		const original: unknown = Reflect.get(target, key, target); return typeof original === 'function' ? original.bind(target) as unknown : original; },
		set(target, key, next: unknown) { return Reflect.set(target, key, next, target); } });
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function settle<Value>(operation: Promise<Value>): Promise<Outcome<Value>> {
	return operation.then(value => ({ ok: true, value }), (error: unknown) => ({ ok: false, error }));
}
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function store(stores: Readonly<Record<string, IDBObjectStore>>, name: string): IDBObjectStore { const value = stores[name]; check(value, 'Native store missing.'); return value; }
function equal(first: Uint8Array, second: Uint8Array): boolean { return first.length === second.length && first.every((value, index) => value === second[index]); }
function literalPixels(bytes: Uint8Array): boolean { return bytes.length === 16 && bytes.every((value, index) => value === [255, 32, 0, 255][index % 4]); }
async function digest(bytes: Uint8Array): Promise<string> { const owned = new Uint8Array(bytes); try {
	return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', owned.buffer)), byte => byte.toString(16).padStart(2, '0')).join('');
} finally { owned.fill(0); } }
function notFound(error: unknown): boolean { return error instanceof DOMException && error.name === 'NotFoundError'; }
function containsOpaque(error: unknown, expected: unknown): boolean {
	return error === expected || error instanceof AggregateError && error.errors.some((item: unknown) => containsOpaque(item, expected));
}
async function directoryNames(directory: FileSystemDirectoryHandle): Promise<string[]> {
	const iterable = directory as FileSystemDirectoryHandle & { keys(): AsyncIterableIterator<string> };
	const names: string[] = []; for await (const name of iterable.keys()) { names.push(name); if (names.length === 2) break; } return names;
}
