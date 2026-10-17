/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField, readClosedDomainRecord } from '../../src/common/editor/closed-domain-value.ts';
import type { PhotoLibraryImportItemV1 } from '../../src/common/editor/photo-library-session-port-v1.ts';
import { MediaRepository } from '../../src/common/editor/storage/media-repository.ts';
import { OpfsSyncRepositoryBridge } from '../../src/common/editor/storage/opfs-sync-repository-bridge.ts';
import { WorkerRequestBroker } from '../../src/common/editor/worker-request-broker.ts';
import { createPhotoLibrarySessionV3 } from '../../src/lightscaper/photo-library-session-runtime-v3.ts';
import { PhotoLibrarySessionV2 } from '../../src/lightscaper/controller/photo-library-session-v2.ts';
import { PHOTO_LIBRARY_DEFAULT_CATALOG_DATABASE_NAME_V2 as CATALOG } from '../../src/lightscaper/storage/photo-library-location-v2.ts';
import { PHOTO_MEDIA_NAMESPACES_V1 as MEDIA, PhotoMediaStoreV1 } from '../../src/lightscaper/storage/photo-media-store.ts';
import { nativeCheckV1 as check, nativeDigestV1 as digest, nativeOutcomeV1 as outcome, nativeSameV1 as same,
	readDefaultImportSelectionNativeV1, type NativeOutcomeV1 } from './lightscaper-default-import-snapshot-native-v1.ts';
import { originalProcessCrashLiteralV1, readOriginalProcessCrashSnapshotNativeV1,
	ORIGINAL_PROCESS_CRASH_CURRENT_SHA256_V1, type OriginalProcessCrashIdentityV1,
	type OriginalProcessCrashSnapshotV1 } from './lightscaper-original-process-crash-snapshot-native-v1.ts';

type Session = Awaited<ReturnType<typeof createPhotoLibrarySessionV3>>;
export interface OriginalProcessCrashPreparedV1 {
	readonly schemaVersion: 1; readonly identity: Readonly<OriginalProcessCrashIdentityV1>;
	readonly baseline: Readonly<OriginalProcessCrashSnapshotV1>; readonly prefix: Readonly<OriginalProcessCrashSnapshotV1>;
	readonly native: { readonly writeBlobReturnedTrue: true; readonly operationId: 'media-asset-chunk-write'; readonly path: string;
		readonly writeBytes: 85; readonly writerOpens: 1; readonly writeAcks: 1; readonly closeAcks: 1;
		readonly companionJoined: true; readonly importPending: true; readonly signalAborted: false; readonly closeCallsBeforeKill: 0 };
}
export interface OriginalProcessCrashRecoveredV1 {
	readonly schemaVersion: 1; readonly before: Readonly<OriginalProcessCrashSnapshotV1>; readonly after: Readonly<OriginalProcessCrashSnapshotV1>;
	readonly second: Readonly<OriginalProcessCrashSnapshotV1>; readonly orphanGone: true; readonly leaseConsumed: true; readonly bindingConsumed: true;
	readonly intentRetired: true; readonly donorExact: true; readonly unrootedExact: true; readonly catalogExact: true; readonly idempotent: true;
	readonly pagePhotoCount: 1;
}

// A successful prepare deliberately retains its live actual Session and settled
// write continuation. Only the owned browser process SIGKILL releases this scope.
let armedOwner: Readonly<{ session: Session; importing: Promise<NativeOutcomeV1<readonly PhotoLibraryImportItemV1[]>>;
	release: () => void; restores: readonly (() => void)[] }> | null = null;

export async function prepareOriginalProcessCrashNativeV1(): Promise<Readonly<OriginalProcessCrashPreparedV1>> {
	check(armedOwner === null, 'An original crash prefix is already armed in this process.');
	const inventory = await indexedDB.databases();
	check(!inventory.some(row => row.name === CATALOG || row.name === MEDIA.databaseName), 'Preparation may not adopt a preexisting library.');
	const root = await navigator.storage.getDirectory();
	try { await root.getDirectoryHandle(MEDIA.opfsDirectoryName); throw new Error('Preparation may not adopt a preexisting original directory.'); }
	catch (error) { if (!nativeNotFound(error)) throw error; }
	const companion = workerCompanion();
	const donorBytes = originalProcessCrashLiteralV1('donor'), currentBytes = originalProcessCrashLiteralV1('current'), unrootedBytes = originalProcessCrashLiteralV1('unrooted');
	check(currentBytes.length === 85 && await digest(currentBytes) === ORIGINAL_PROCESS_CRASH_CURRENT_SHA256_V1, 'Current independent PNG literal changed.');
	const options = { name: 'Original process crash', indexedDB, locks: navigator.locks };
	const entered = deferred(), release = deferred(), restores: (() => void)[] = [];
	let session: Session | undefined, importing: Promise<NativeOutcomeV1<readonly PhotoLibraryImportItemV1[]>> | undefined;
	let importSettled = false, held = false, armed = false;
	const current: { sourceId: string; path: string | null; signal: AbortSignal | undefined } = { sourceId: '', path: null, signal: undefined };
	let closeCalls = 0, writerId = '', writeBytes = 0, writerOpens = 0, writeAcks = 0, closeAcks = 0;
	const requests = new Map<string, Readonly<{ type: string; byteLength: number }>>(), workers = new Set<Worker>();
	let prepared: Readonly<OriginalProcessCrashPreparedV1> | undefined, primary: unknown, failed = false;
	try {
		const setup = await createPhotoLibrarySessionV3(options);
		const seeded = await withJoinedOwner(setup, async () => {
			check((await setup.readPage()).totalCount === 0, 'Actual default initializer must produce an empty catalog.');
			const receipts = await setup.importFiles([new File([donorBytes], 'original-process-crash-donor.png', { type: 'image/png', lastModified: 0 })]);
			const donorPhotoId = receipts[0]?.photoId;
			check(receipts.length === 1 && receipts[0]?.status === 'imported' && typeof donorPhotoId === 'string', 'Donor requires its actual native imported ACK.');
			check((await setup.readPage()).totalCount === 1, 'Acknowledged donor must be readable through the actual Session.');
			const selected = await readDefaultImportSelectionNativeV1(indexedDB);
			check(selected.pointer.schemaVersion === 1 && selected.allocation === null && selected.location.catalogDatabaseName === CATALOG
				&& selected.location.mediaDatabaseName === MEDIA.databaseName, 'Actual fresh default profile was not selected.');
			return { donorPhotoId, catalogId: selected.location.catalogId };
		}, companion);
		const unrootedSourceId = 'original-process-crash-completed-unrooted', media = new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks });
		await withJoinedOwner(media, async () => {
			await media.ready();
			const original = await media.mediaRepository.writeAsset(unrootedSourceId, new Blob([unrootedBytes], { type: 'application/octet-stream' }),
				{ name: 'completed-unrooted-original.bin', mimeType: 'application/octet-stream' });
			check(original.storage === 'opfs' && original.sha256 === await digest(unrootedBytes), 'Separately completed unrooted original lacks real native metadata.');
		}, companion);
		observe();
		session = await createPhotoLibrarySessionV3(options);
		check((await session.readPage()).totalCount === 1, 'Current actual Session must start with only the acknowledged donor.');
		const initialIdentity: OriginalProcessCrashIdentityV1 = { ...seeded, unrootedSourceId, currentSourceId: '', currentPath: null };
		const baseline = await readOriginalProcessCrashSnapshotNativeV1(initialIdentity);
		armed = true;
		importing = outcome(session.importFiles([new File([currentBytes], 'original-process-crash-current.png', { type: 'image/png', lastModified: 0 })]));
		void importing.then(() => { importSettled = true; });
		await Promise.race([entered.promise, importing.then(value => {
			if (!value.ok) throw value.error; throw new Error('Actual import settled before the fulfilled worker Blob-write hold.');
		})]);
		check(held && current.path !== null && current.sourceId !== '' && current.signal !== undefined && !current.signal.aborted
			&& !importSettled && closeCalls === 0, 'Actual settled continuation must remain live without cancellation or Close.');
		const identity = Object.freeze({ ...seeded, unrootedSourceId, currentSourceId: current.sourceId, currentPath: current.path });
		const prefix = await readOriginalProcessCrashSnapshotNativeV1(identity);
		check(same(prefix.current, { filePresent: true, sha256: ORIGINAL_PROCESS_CRASH_CURRENT_SHA256_V1, byteLength: 85,
			leaseCount: 1, bindingCount: 1, bindingSameDirectory: true, metadataCount: 0, photoCount: 0, rootCount: 0, intentPresent: true }),
			'Actual native prefix is not flush-before-publication with complete durable recovery authority.');
		check(same(prefix.donor, baseline.donor) && same(prefix.unrooted, baseline.unrooted) && prefix.catalogJson === baseline.catalogJson,
			'Arming an unpublished current original changed acknowledged data.');
		prepared = Object.freeze({ schemaVersion: 1, identity, baseline, prefix,
			native: Object.freeze({ writeBlobReturnedTrue: true, operationId: 'media-asset-chunk-write', path: current.path, writeBytes: 85,
				writerOpens: 1, writeAcks: 1, closeAcks: 1, companionJoined: true, importPending: true, signalAborted: false, closeCallsBeforeKill: 0 }) });
		armedOwner = Object.freeze({ session, importing, release: release.resolve, restores: Object.freeze(restores) });
	} catch (error) { primary = error; failed = true; }
	donorBytes.fill(0); currentBytes.fill(0); unrootedBytes.fill(0);
	if (prepared) return prepared;
	// Refused qualification still joins actual work and resources; successful
	// preparation never calls this cleanup and never deletes durable data.
	const cleanup: unknown[] = []; release.resolve();
	if (importing) { const settled = await importing; if (!settled.ok && !Object.is(settled.error, primary)) cleanup.push(settled.error); }
	try { await companion(); } catch (error) { cleanup.push(error); }
	try { await session?.close(); } catch (error) { cleanup.push(error); }
	for (const restore of restores.reverse()) { try { restore(); } catch (error) { cleanup.push(error); } }
	if (cleanup.length) throw new AggregateError([...(failed ? [primary] : []), ...cleanup], 'Crash prefix preparation cleanup failed.', failed ? { cause: primary } : undefined);
	if (failed) throw primary; throw new Error('Crash prefix preparation produced no result.');

	function observe(): void {
		const original = MediaRepository.prototype.writeAsset;
		replace(MediaRepository.prototype, 'writeAsset', function(this: MediaRepository, ...args: Parameters<typeof original>) {
			if (armed && args[2]?.name === 'original-process-crash-current.png') {
				check(current.sourceId === '', 'Actual current import entered more than one immutable original write.'); current.sourceId = args[0];
			}
			return Reflect.apply(original, this, args) as ReturnType<typeof original>;
		});
		const close = PhotoLibrarySessionV2.prototype.close;
		replace(PhotoLibrarySessionV2.prototype, 'close', function(this: PhotoLibrarySessionV2) {
			if (armed && this === session) closeCalls++;
			return Reflect.apply(close, this, []) as ReturnType<typeof close>;
		});
		const bridgeWrite = OpfsSyncRepositoryBridge.prototype.writeBlob;
		replace(OpfsSyncRepositoryBridge.prototype, 'writeBlob', async function(this: OpfsSyncRepositoryBridge, ...args: Parameters<typeof bridgeWrite>) {
			if (!armed || args[1] !== 'media-asset-chunk-write' || args[3].size !== 85) return Reflect.apply(bridgeWrite, this, args) as ReturnType<typeof bridgeWrite>;
			check(current.sourceId !== '' && current.path === null && !held, 'Native write route lacks its current original or entered twice.');
			current.path = args[2]; current.signal = args[4];
			const written = await (Reflect.apply(bridgeWrite, this, args) as ReturnType<typeof bridgeWrite>);
			check(written === true && writerOpens === 1 && writeAcks === 1 && closeAcks === 1 && writeBytes === 85,
				'Actual worker write/flush/Close ACK closure is incomplete.');
			await companion(); held = true; entered.resolve(); await release.promise; return written;
		});
		const post = Worker.prototype.postMessage;
		replace(Worker.prototype, 'postMessage', function(this: Worker, ...args: Parameters<typeof post>) {
			const message: unknown = args[0];
			if (armed && current.path !== null && message !== null && typeof message === 'object') {
				const row = message as { id?: unknown; type?: unknown; operationId?: unknown; path?: unknown; writerId?: unknown; bytes?: unknown };
				const opening = row.type === 'open-writer' && row.operationId === 'media-asset-chunk-write' && row.path === current.path;
				if (opening) { check(workers.size === 0 || workers.has(this), 'Current native writer changed workers.'); workers.add(this); }
				if ((opening || workers.has(this) && row.writerId === writerId && writerId !== '') && typeof row.id === 'string' && typeof row.type === 'string') {
					check(requests.size < 8, 'Current native worker request closure exceeds its bound.');
					requests.set(row.id, { type: row.type, byteLength: row.bytes instanceof ArrayBuffer ? row.bytes.byteLength : 0 });
				}
			}
			return Reflect.apply(post, this, args) as ReturnType<typeof post>;
		});
		const resolve = WorkerRequestBroker.prototype.resolve;
		replace(WorkerRequestBroker.prototype, 'resolve', function(this: WorkerRequestBroker, ...args: Parameters<typeof resolve>) {
			const delivered = Reflect.apply(resolve, this, args) as ReturnType<typeof resolve>, witnessed = requests.get(args[0]);
			if (witnessed) {
				requests.delete(args[0]); check(delivered, 'Observed native reply was not an admitted genuine ACK.');
				if (witnessed.type === 'open-writer') { const value = args[1] as { writerId?: unknown }; check(typeof value.writerId === 'string', 'Actual writer ACK lacks its identity.'); writerId = value.writerId; writerOpens++; }
				if (witnessed.type === 'write') { writeAcks++; writeBytes += witnessed.byteLength; }
				if (witnessed.type === 'close-writer') closeAcks++;
			}
			return delivered;
		});
	}
	function replace(owner: object, key: string, value: unknown): void {
		const previous = Object.getOwnPropertyDescriptor(owner, key); check(previous !== undefined, 'Actual native observation method is missing.');
		Object.defineProperty(owner, key, { ...previous, value }); restores.push(() => Object.defineProperty(owner, key, previous));
	}
}

export async function readOriginalProcessCrashPrefixNativeV1(expected: unknown): Promise<Readonly<OriginalProcessCrashSnapshotV1>> {
	const admitted = captureExpected(expected);
	return readOriginalProcessCrashSnapshotNativeV1(admitted.identity);
}

/** Same real runtime3 startup/readPage on intact or already recovered actual state. */
export async function recoverOriginalProcessCrashNativeV1(expected: unknown): Promise<Readonly<OriginalProcessCrashRecoveredV1>> {
	check(armedOwner === null, 'The preparing process must be killed before recovery.');
	const admitted = captureExpected(expected), companion = workerCompanion(), before = await readOriginalProcessCrashSnapshotNativeV1(admitted.identity);
	check(before.stateJson === admitted.prefix.stateJson || before.stateJson === admitted.baseline.stateJson, 'Pre-readiness durable prefix differs from captured native state.');
	// An already recovered process opens no worker; only actual orphan removal
	// requires the native execution checkpoint before that owner closes.
	const checkpoint = before.current.filePresent ? companion : () => Promise.resolve();
	const session = await createPhotoLibrarySessionV3({ name: 'Original crash recovery', indexedDB, locks: navigator.locks });
	await withJoinedOwner(session, async () => { check((await session.readPage()).totalCount === 1, 'Ordinary recovery changed the acknowledged Photo count.'); }, checkpoint);
	const after = await readOriginalProcessCrashSnapshotNativeV1(admitted.identity);
	check(after.current.filePresent === false && after.current.leaseCount === 0 && after.current.bindingCount === 0 && !after.current.intentPresent,
		'Actual startup did not retire the exact orphan file, lease, directory witness and import intent.');
	check(after.stateJson === admitted.baseline.stateJson, 'Recovery changed completed donor/unrooted/catalog data or left extra durable state.');
	const again = await createPhotoLibrarySessionV3({ name: 'Original crash idempotence', indexedDB, locks: navigator.locks });
	await withJoinedOwner(again, async () => { check((await again.readPage()).totalCount === 1, 'Second ordinary recovery changed the Photo count.'); }, checkpoint);
	const second = await readOriginalProcessCrashSnapshotNativeV1(admitted.identity);
	check(second.stateJson === after.stateJson && same(second, after), 'Second actual startup is not idempotent.');
	return Object.freeze({ schemaVersion: 1, before, after, second, orphanGone: true, leaseConsumed: true, bindingConsumed: true, intentRetired: true,
		donorExact: true, unrootedExact: true, catalogExact: true, idempotent: true, pagePhotoCount: 1 });
}

function captureExpected(value: unknown): Readonly<{ identity: Readonly<OriginalProcessCrashIdentityV1>; baseline: Readonly<{ stateJson: string }>; prefix: Readonly<{ stateJson: string }> }> {
	const root = readClosedDomainRecord(value, 'crash expected receipt', ['schemaVersion', 'identity', 'baseline', 'prefix', 'native']);
	check(readClosedDomainField(root, 'schemaVersion', 'crash receipt') === 1, 'Unsupported crash receipt.');
	const ids = readClosedDomainRecord(readClosedDomainField(root, 'identity', 'crash receipt'), 'crash identity',
		['catalogId', 'donorPhotoId', 'unrootedSourceId', 'currentSourceId', 'currentPath']);
	const text = (key: string): string => { const current = readClosedDomainField(ids, key, 'crash identity');
		check(typeof current === 'string' && current.length > 0 && current.length <= 256 && current.trim() === current, 'Crash identity requires a bounded captured scalar.'); return current; };
	const state = (key: string): Readonly<{ stateJson: string }> => {
		const object = readClosedDomainField(root, key, 'crash receipt'); check(object !== null && typeof object === 'object', 'Crash expected snapshot is missing.');
		const descriptor = Object.getOwnPropertyDescriptor(object, 'stateJson'); check(descriptor !== undefined && 'value' in descriptor
			&& typeof descriptor.value === 'string' && new TextEncoder().encode(descriptor.value).byteLength <= 262_144, 'Crash expected state is not a bounded own string.');
		return Object.freeze({ stateJson: descriptor.value as string });
	};
	return Object.freeze({ identity: Object.freeze({ catalogId: text('catalogId'), donorPhotoId: text('donorPhotoId'), unrootedSourceId: text('unrootedSourceId'),
		currentSourceId: text('currentSourceId'), currentPath: text('currentPath') }), baseline: state('baseline'), prefix: state('prefix') });
}
async function withJoinedOwner<Value>(owner: { close(): Promise<void> }, run: () => Promise<Value>, companion: () => Promise<void>): Promise<Value> {
	const result = await outcome(run()), cleanup: unknown[] = [];
	try { await companion(); } catch (error) { cleanup.push(error); }
	try { await owner.close(); } catch (error) { cleanup.push(error); }
	if (cleanup.length) throw new AggregateError([...(!result.ok ? [result.error] : []), ...cleanup], 'Native crash owner cleanup failed.', !result.ok ? { cause: result.error } : undefined);
	if (!result.ok) throw result.error; return result.value;
}
function workerCompanion(): () => Promise<void> {
	const current = (globalThis as typeof globalThis & { __assertNativeOpfsWorkerExecution?: () => Promise<void> }).__assertNativeOpfsWorkerExecution;
	check(typeof current === 'function', 'Ordinary native worker execution companion is missing.'); return current;
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept; }); return { promise, resolve }; }
function nativeNotFound(value: unknown): boolean {
	try { return Reflect.apply(Object.getOwnPropertyDescriptor(DOMException.prototype, 'name')!.get!, value, []) === 'NotFoundError'; } catch { return false; }
}
