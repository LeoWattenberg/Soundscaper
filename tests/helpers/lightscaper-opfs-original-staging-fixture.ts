/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { setImmediate as nextTurn, setTimeout as delay } from 'node:timers/promises';
import { openDatabase } from '../../src/common/editor/storage/indexeddb-backend.ts';
import type { MediaAssetStagingLeaseRecord } from '../../src/common/editor/storage/media-asset-staging-schema.ts';
import { PhotoMediaStoreV1, PHOTO_MEDIA_NAMESPACES_V1 as MEDIA } from '../../src/lightscaper/storage/photo-media-store.ts';
import { mediaRestoreFixture } from './lightscaper-media-restore-fixture.ts';
import { controlledLocks, installAcquisitionPlatform, observed, WriterAcquisitionFixture } from './lightscaper-opfs-writer-acquisition-fixture.ts';

export const ORIGINAL_BYTES = Uint8Array.of(17, 61, 149, 233);
export const PRIOR_BYTES = Uint8Array.of(3, 79, 181, 251, 29);
export const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
export type NativeStorageFixture = ReturnType<typeof mediaRestoreFixture>;
export interface CapturedOriginalPrefix {
	readonly rows: ReadonlyMap<string, readonly unknown[]>;
	readonly files: ReadonlyMap<string, Uint8Array<ArrayBuffer>>;
	readonly lease: MediaAssetStagingLeaseRecord;
	readonly prior: Readonly<Record<string, unknown>>;
	readonly priorMetadata: Readonly<Record<string, unknown>>;
	readonly priorPath: string;
	readonly directoryIdentity: string;
}

const directoryIdentities = new WeakMap<object, string>();

class ControlledDirectoryHandle {
	get kind(): 'directory' { directoryIdentity(this); return 'directory'; }
	get name(): string { directoryIdentity(this); return MEDIA.opfsDirectoryName; }
	isSameEntry(other: FileSystemHandle): Promise<boolean> {
		return Promise.resolve(directoryIdentity(this) === directoryIdentity(other));
	}
}

function directoryIdentity(value: object): string {
	const identity = directoryIdentities.get(value);
	if (!identity) throw new TypeError('An explicitly registered controlled native directory is required.');
	return identity;
}

function clonedDirectory(identity: string): object {
	const handle = Object.create(ControlledDirectoryHandle.prototype) as object;
	directoryIdentities.set(handle, identity); return handle;
}

/** Explicit Node serialization/brand model; native clone capability is qualified separately. */
export function installDirectoryModel(fixture: Readonly<{ directory: object }>, identity: string = randomUUID()) {
	Object.setPrototypeOf(fixture.directory, ControlledDirectoryHandle.prototype);
	directoryIdentities.set(fixture.directory, identity);
	const slots = ['FileSystemHandle', 'FileSystemDirectoryHandle', 'structuredClone'];
	const saved = slots.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
	const nativeClone = globalThis.structuredClone;
	let cloneFailure: DOMException | null = null;
	const cloning = <Value>(value: Value, options?: StructuredSerializeOptions): Value => {
		const handles: Array<Readonly<{ path: readonly string[]; identity: string }>> = [];
		const prepare = (input: unknown, path: readonly string[]): unknown => {
			if (!input || typeof input !== 'object') return input;
			const registered = directoryIdentities.get(input);
			if (registered) { handles.push({ path, identity: registered }); return null; }
			if (Array.isArray(input)) return input.map((entry: unknown, index) => prepare(entry, [...path, String(index)]));
			const prototype: unknown = Object.getPrototypeOf(input);
			if (prototype !== Object.prototype && prototype !== null) return input;
			return Object.fromEntries(Object.entries(input).map(([key, entry]) => [key, prepare(entry, [...path, key])]));
		};
		const prepared = prepare(value, []);
		if (handles.length && cloneFailure) { const error = cloneFailure; cloneFailure = null; throw error; }
		let result: unknown = nativeClone(prepared, options);
		for (const handle of handles) {
			const copy = clonedDirectory(handle.identity);
			if (!handle.path.length) { result = copy; continue; }
			let parent = result as Record<string, unknown>;
			for (const key of handle.path.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
			parent[handle.path.at(-1)!] = copy;
		}
		return result as Value;
	};
	Object.defineProperty(globalThis, 'FileSystemHandle', { configurable: true, value: ControlledDirectoryHandle });
	Object.defineProperty(globalThis, 'FileSystemDirectoryHandle', { configurable: true, value: ControlledDirectoryHandle });
	Object.defineProperty(globalThis, 'structuredClone', { configurable: true, value: cloning });
	return { identity,
		refuseNextClone() { cloneFailure = new DOMException('Controlled directory serialization refused.', 'DataCloneError'); },
		reset() { for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } } };
}

// Enumeration is driven by successful opens in this actual controlled port,
// rather than an invented list asserting that another namespace cannot exist.
export function enumerableFactory(native: NativeStorageFixture): IDBFactory {
	const registered = new Map<string, number>();
	const factory = Object.create(native.factory) as IDBFactory;
	factory.open = (name, version) => {
		const opening = native.factory.open(name, version);
		let listener: IDBOpenDBRequest['onsuccess'] = null;
		Object.defineProperty(opening, 'onsuccess', { configurable: true,
			get: () => function (this: IDBOpenDBRequest, event: Event) {
				registered.set(name, opening.result.version); listener?.call(this, event);
			}, set: (value: IDBOpenDBRequest['onsuccess']) => { listener = value; } });
		return opening;
	};
	factory.deleteDatabase = name => {
		const removing = native.factory.deleteDatabase(name);
		let listener: IDBOpenDBRequest['onsuccess'] = null;
		Object.defineProperty(removing, 'onsuccess', { configurable: true,
			get: () => function (this: IDBOpenDBRequest, event: Event) {
				registered.delete(name); listener?.call(this, event);
			}, set: (value: IDBOpenDBRequest['onsuccess']) => { listener = value; } });
		return removing;
	};
	factory.databases = () => Promise.resolve([...registered].map(([name, version]) => ({ name, version })));
	return factory;
}

export function pathLeases(native: NativeStorageFixture, databaseName = MEDIA.databaseName): MediaAssetStagingLeaseRecord[] {
	return (native.raw(databaseName).records(databaseName, 'mediaAssetStaging') as unknown[])
		.filter((value): value is MediaAssetStagingLeaseRecord => value !== null && typeof value === 'object'
			&& 'kind' in value && value.kind === 'lease' && 'path' in value && typeof value.path === 'string');
}

export async function taskTurns(milliseconds = 0): Promise<void> {
	for (let turn = 0; turn < 3; turn++) await nextTurn();
	if (milliseconds) await delay(milliseconds);
}

export async function enteredOrOutcome<Value>(entered: Promise<void>, work: ReturnType<typeof observed<Value>>): Promise<void> {
	await Promise.race([entered, work.then(result => {
		if (!result.ok) throw result.error;
		throw new Error('The actual owner settled without entering the expected storage hold.');
	})]);
}

/**
 * Capture a real whole-Blob write held at its computed Close result and a
 * committed unrooted original; the optional legacy case uses a streamed writer.
 * Join the source cancellation and Close before returning either durable prefix.
 * A later replay models retained state after an owner stops; it is not a native
 * browser process kill, and source cleanup is never target recovery evidence.
 */
export async function captureOriginalPrefix(legacyStreamed = false): Promise<CapturedOriginalPrefix> {
	const fixture = new WriterAcquisitionFixture(), native = mediaRestoreFixture(), locks = controlledLocks();
	const factory = enumerableFactory(native), reset = installAcquisitionPlatform(fixture, locks);
	const model = installDirectoryModel(fixture), stop = new AbortController();
	const media = new PhotoMediaStoreV1({ indexedDB: factory, locks });
	let writer: Awaited<ReturnType<typeof media.mediaRepository.beginAssetWrite>> | undefined;
	let writing: ReturnType<typeof observed<Record<string, unknown>>> | undefined;
	let result: CapturedOriginalPrefix | undefined, primary: unknown, failed = false;
	const cleanupErrors: unknown[] = [];
	try {
		await media.ready();
		const prior = await media.mediaRepository.writeAsset('original-prior', new Blob([PRIOR_BYTES]),
			{ name: 'kept-original.bin', mimeType: 'application/octet-stream' });
		assert.equal(prior.storage, 'opfs'); const priorPath = prior.path; assert.ok(typeof priorPath === 'string');
		if (legacyStreamed) {
			writer = await media.mediaRepository.beginAssetWrite('original-new',
				{ name: 'original-new.bin', mimeType: 'application/octet-stream' },
				{ expectedBytes: ORIGINAL_BYTES.byteLength, expectedSha256: digest(ORIGINAL_BYTES) });
			await writer.write(ORIGINAL_BYTES);
		} else {
			fixture.arm('close-result');
			writing = observed(media.mediaRepository.writeAsset('original-new', new Blob([ORIGINAL_BYTES]),
				{ name: 'original-new.bin', mimeType: 'application/octet-stream' }, { signal: stop.signal }));
			await enteredOrOutcome(fixture.entered.promise, writing);
		}
		const leases = pathLeases(native); assert.equal(leases.length, 1);
		const lease = leases[0]!; assert.equal(lease.sourceId, 'original-new'); assert.ok(lease.path);
		const database = await openDatabase(factory, MEDIA.databaseName);
		const rows = new Map<string, readonly unknown[]>();
		try { for (const store of database.objectStoreNames) rows.set(store, native.raw(MEDIA.databaseName).records(MEDIA.databaseName, store)); }
		finally { database.close(); }
		if (!legacyStreamed) {
			const binding = (rows.get('settings') as Record<string, unknown>[])
				.find(row => row.key === `audio-editor-opfs-directory-binding-v1:${lease.leaseId}`);
			assert.ok(binding); const value = binding.value as Record<string, unknown>;
			assert.equal(value.sourceId, lease.sourceId); assert.equal(value.path, lease.path);
			assert.equal(await Reflect.apply(FileSystemHandle.prototype.isSameEntry, fixture.directory, [value.directoryHandle]), true);
		}
		const files = new Map([...fixture.files].map(([path, file]) => [path, new Uint8Array(file.bytes)]));
		assert.deepEqual(files.get(lease.path), ORIGINAL_BYTES); assert.deepEqual(files.get(priorPath), PRIOR_BYTES);
		const record = (rows.get('mediaAssets') as Record<string, unknown>[]).find(value => value.sourceId === 'original-prior');
		assert.ok(record); assert.equal(typeof record.mediaContentToken, 'string');
		result = { rows, files, lease: structuredClone(lease), prior: structuredClone(record), priorMetadata: structuredClone(prior), priorPath,
			directoryIdentity: model.identity };
	} catch (error) { primary = error; failed = true; }
	try {
		if (writing) {
			stop.abort(Symbol('Captured source owner stopped after actual file Close.'));
			const closing = observed(media.close()); fixture.releaseAll(); await writing;
			const closed = await closing; if (!closed.ok) cleanupErrors.push(closed.error);
		} else {
			fixture.releaseAll(); try { await writer?.abort(); } catch (error) { cleanupErrors.push(error); }
			try { await media.close(); } catch (error) { cleanupErrors.push(error); }
		}
	} catch (error) { cleanupErrors.push(error); }
	finally {
		try { await fixture.dispose(); } catch (error) { cleanupErrors.push(error); }
		try { model.reset(); } catch (error) { cleanupErrors.push(error); }
		try { reset(); } catch (error) { cleanupErrors.push(error); }
	}
	const failures = [...(failed ? [primary] : []), ...cleanupErrors];
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) throw new AggregateError(failures, 'Captured source owner cleanup failed.', { cause: failed ? primary : failures[0] });
	assert.ok(result); return result;
}

export async function replayOriginalPrefix(prefix: CapturedOriginalPrefix, directoryIdentityValue = prefix.directoryIdentity) {
	const fixture = new WriterAcquisitionFixture(), native = mediaRestoreFixture(), locks = controlledLocks();
	const factory = enumerableFactory(native), reset = installAcquisitionPlatform(fixture, locks);
	const model = installDirectoryModel(fixture, directoryIdentityValue);
	const stores: PhotoMediaStoreV1[] = [], pending: Promise<unknown>[] = [];
	try {
		const database = await openDatabase(factory, MEDIA.databaseName);
		try { for (const [store, records] of prefix.rows) for (const record of records) native.raw(MEDIA.databaseName).seedRecord(MEDIA.databaseName, store, record); }
		finally { database.close(); }
		for (const [path, bytes] of prefix.files) fixture.seed(path, bytes);
		const open = (options: ConstructorParameters<typeof PhotoMediaStoreV1>[0] = {}) => {
			const media = new PhotoMediaStoreV1({ indexedDB: factory, locks, ...options }); stores.push(media); return media;
		};
		return { fixture, native, factory, locks, model, open,
			track<Value>(work: Promise<Value>): ReturnType<typeof observed<Value>> { const outcome = observed(work); pending.push(outcome); return outcome; },
			async dispose(): Promise<void> {
				fixture.releaseAll(); await Promise.allSettled(pending);
				const closed = await Promise.allSettled(stores.map(media => media.close()));
				const errors = closed.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(result => result.reason as unknown);
				try { await fixture.dispose(); } catch (error) { errors.push(error); } finally { model.reset(); reset(); }
				if (errors.length === 1) throw errors[0];
				if (errors.length > 1) throw new AggregateError(errors, 'Controlled storage fixture cleanup failed.');
			} };
	} catch (error) { try { await fixture.dispose(); } finally { model.reset(); reset(); } throw error; }
}

export function assertPriorUnchanged(prefix: CapturedOriginalPrefix, native: NativeStorageFixture, fixture: WriterAcquisitionFixture): void {
	const records = native.raw(MEDIA.databaseName).records(MEDIA.databaseName, 'mediaAssets') as Record<string, unknown>[];
	assert.deepEqual(records.find(record => record.sourceId === 'original-prior'), prefix.prior);
	assert.deepEqual(fixture.files.get(prefix.priorPath)?.bytes, PRIOR_BYTES);
	assert.deepEqual(native.raw(MEDIA.databaseName).records(MEDIA.databaseName, 'catalogOriginalRoots'), []);
}
