/* SPDX-License-Identifier: AGPL-3.0-only */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { OpfsRepository, type OpfsBinaryWriter, type OpfsBinaryWriterPlan } from './opfs-repository.ts';
import { acquireTemporaryExportLease } from './temporary-export-sink.ts';
import { normalizeOpfsWorkerPath } from './opfs-sync-worker-protocol.ts';

export interface ImageHdrPixelStagingHandleV1 { readonly byteLength: number; readonly sha256: string; }
export interface ImageHdrPixelStagingWriterV1 { write(bytes: Uint8Array<ArrayBuffer>): Promise<void>; }
export interface ImageHdrPixelStagingStoreV1 {
	write(byteLength: number, produce: (writer: Readonly<ImageHdrPixelStagingWriterV1>) => void | Promise<void>): Promise<Readonly<ImageHdrPixelStagingHandleV1>>;
	withRead<Result>(handle: Readonly<ImageHdrPixelStagingHandleV1>, offset: number, length: number,
		consume: (bytes: Uint8Array<ArrayBuffer>) => Result | Promise<Result>): Promise<Result>;
}
/** Native transport seam; production always uses the existing OPFS repository. */
export interface ImageHdrPixelStagingBackendV1 {
	ready(): Promise<boolean>;
	planBinaryWriter(prefix: string, options?: Readonly<{ signal?: AbortSignal }>): Promise<OpfsBinaryWriterPlan | null>;
	read(path: string): Promise<unknown>;
	deletePathExact(path: string): Promise<void>;
	close(): void | Promise<void>;
}
export interface ImageHdrPixelStagingOptionsV1 {
	readonly signal?: AbortSignal;
	readonly backend?: ImageHdrPixelStagingBackendV1;
	readonly acquireLease?: (path: string) => Promise<() => Promise<void>>;
}
interface Entry {
	readonly path: string;
	readonly byteLength: number;
	release?: () => Promise<void>;
	opened?: boolean;
	writer?: OpfsBinaryWriter;
	snapshot?: Blob;
}
const MiB = 1024 * 1024, CHUNK = MiB, PLANE = 128 * MiB, MAX_ENTRIES = 9;
const Bytes = Uint8Array, SET = Bytes.prototype.set, FILL = Bytes.prototype.fill;
const TYPED = Object.getPrototypeOf(Bytes.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!, OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'byteLength')!.get!, TAG = Object.getOwnPropertyDescriptor(TYPED, Symbol.toStringTag)!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!, RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')!.get!;
const BLOB_SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!, SLICE = Blob.prototype.slice, ARRAY_BUFFER = Blob.prototype.arrayBuffer;
const ABORTED = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!, REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;

/** Persistent, scoped canonical pixel staging. All ranges and writes join
 * before exact deletion and existing export-file lease release. No staged
 * body, file capability or writable handle escapes the enclosing callback. */
export async function withImageHdrPixelStagingV1<Result>(
	consume: (store: Readonly<ImageHdrPixelStagingStoreV1>) => Result | Promise<Result>, options: Readonly<ImageHdrPixelStagingOptionsV1> = {},
): Promise<Result> {
	const rawSignal = Object.getOwnPropertyDescriptor(options, 'signal')?.value as unknown;
	const signal = captureSignal(rawSignal), check = () => { checkSignal(signal); };
	const prepared = (() => { try {
		check(); const input = record(options, 'HDR staging options', ['signal', 'backend', 'acquireLease'], []);
		if (typeof consume !== 'function') throw new TypeError('HDR staging requires a scoped consumer.');
		const backend = Object.hasOwn(input, 'backend') ? field(input, 'backend', 'HDR staging options') : nativeBackend();
		const captured = captureBackend(backend);
		const lease = Object.hasOwn(input, 'acquireLease') ? field(input, 'acquireLease', 'HDR staging options') : acquireTemporaryExportLease;
		if (typeof lease !== 'function') throw new TypeError('HDR staging requires a temporary-file lease authority.');
		return { backend: captured, lease: lease as NonNullable<ImageHdrPixelStagingOptionsV1['acquireLease']> };
	} catch (error) { check(); throw error; } })();
	const entries: Entry[] = [], handles = new WeakMap<object, Entry>(), pending = new Set<Promise<unknown>>(), background: unknown[] = [];
	let closed = false, busy = false, declared = 0;
	function launch<Value>(work: () => Promise<Value>): Promise<Value> {
		const promise = work(); pending.add(promise);
		void promise.then(() => { pending.delete(promise); }, (error: unknown) => { add(background, error); pending.delete(promise); });
		return promise;
	}
	function enter() {
		check(); if (closed) throw new Error('HDR staging is closed.');
		if (busy) throw new Error('HDR staging requires joined sequential operations.'); busy = true;
	}
	const store: Readonly<ImageHdrPixelStagingStoreV1> = Object.freeze({
		write(byteLength: number, produce: (writer: Readonly<ImageHdrPixelStagingWriterV1>) => void | Promise<void>) { return launch(async () => {
			enter();
			try {
				integer(byteLength, 1, PLANE, 'HDR canonical-plane capacity');
				if (entries.length >= MAX_ENTRIES || declared + byteLength > MAX_ENTRIES * PLANE) throw new RangeError('HDR staging exceeds its nine-plane disk capacity.');
				if (typeof produce !== 'function') throw new TypeError('HDR staging requires a scoped pixel writer.');
				const rawPlan = await prepared.backend.planBinaryWriter('hdr-canonical', { signal });
				if (!rawPlan) { check(); throw new Error('Persistent OPFS pixel staging is unavailable.'); }
				const plan = record(rawPlan, 'HDR staging write plan', ['path', 'open']);
				const path = normalizeOpfsWorkerPath(field(plan, 'path', 'HDR staging write plan'));
				const open = method(plan, 'open'), entry: Entry = { path, byteLength }; entries.push(entry); declared += byteLength;
				entry.release = await prepared.lease(path);
				if (typeof entry.release !== 'function') throw new TypeError('HDR staging lease did not return a release function.');
				check(); entry.opened = true;
				const writerValue = await open();
				if (!writerValue) { check(); throw new Error('Persistent OPFS pixel writer is unavailable.'); }
				entry.writer = captureWriter(writerValue, path); check();
				const writtenHash = await writePixels(entry.writer, byteLength, produce, check);
				await entry.writer.close({ signal }); entry.writer = undefined; check();
				const snapshot = await prepared.backend.read(path); check();
				if (Number(Reflect.apply(BLOB_SIZE, snapshot, [])) !== byteLength) throw new RangeError('HDR staging native snapshot length differs from its declaration.');
				entry.snapshot = snapshot as Blob;
				const digest = await hashSnapshot(entry.snapshot, byteLength, check);
				if (digest !== writtenHash) throw new Error('HDR staged pixels differ from their written SHA256.');
				const handle = Object.freeze({ byteLength, sha256: digest }); handles.set(handle, entry); return handle;
			} finally { busy = false; }
		}); },
		withRead<Value>(handle: Readonly<ImageHdrPixelStagingHandleV1>, offset: number, length: number, accept: (bytes: Uint8Array<ArrayBuffer>) => Value | Promise<Value>) {
			return launch(async () => {
				enter();
				try {
					const entry = handle && typeof handle === 'object' ? handles.get(handle) : undefined;
					if (!entry?.snapshot) throw new TypeError('HDR staging handle belongs to another owner.');
					integer(offset, 0, entry.byteLength - 1, 'HDR pixel range offset'); integer(length, 1, CHUNK, 'HDR pixel range bound');
					if (offset + length > entry.byteLength) throw new RangeError('HDR pixel range exceeds its staged plane.');
					if (typeof accept !== 'function') throw new TypeError('HDR range requires a scoped consumer.');
					const bytes = await readRange(entry.snapshot, offset, length);
					return await ownedBytes(bytes, async () => { check(); const result = await accept(bytes); check(); return result; });
				} finally { busy = false; }
			});
		},
	});
	let outcome: { value: Result } | { error: unknown };
	try {
		if (!await prepared.backend.ready()) throw new Error('Persistent OPFS pixel staging is required for HDR merging.');
		check(); const value = await consume(store); check(); outcome = { value };
	} catch (error) { outcome = { error }; }
	closed = true;
	// Accepted operations retain custody even when their caller forgets to await.
	await Promise.allSettled([...pending]);
	const failures: unknown[] = 'error' in outcome ? [outcome.error] : [];
	for (const error of background) add(failures, error);
	try { check(); } catch (error) { add(failures, error); }
	for (const entry of entries) {
		if (entry.writer) { try { await entry.writer.abort(); } catch (error) { add(failures, error); } }
		if (entry.opened) { try { await prepared.backend.deletePathExact(entry.path); } catch (error) { add(failures, error); } }
		entry.snapshot = undefined;
		// An ended owner releases even a failed deletion, allowing existing startup
		// recovery to retry the retained path. The cleanup failure suppresses result.
		try { await entry.release?.(); } catch (error) { add(failures, error); }
	}
	try { await prepared.backend.close(); } catch (error) { add(failures, error); }
	throwFailures(failures, 'HDR pixel staging and physical retirement failed.');
	if ('value' in outcome) return outcome.value;
	throw new Error('HDR staging has no admitted result.');
}

async function writePixels(writer: OpfsBinaryWriter, byteLength: number,
	produce: (writer: Readonly<ImageHdrPixelStagingWriterV1>) => void | Promise<void>, check: () => void): Promise<string> {
	const hash = sha256.create(), pending = new Set<Promise<void>>(), failures: unknown[] = [];
	let written = 0, closed = false, writing = false;
	const scoped = Object.freeze({ write(value: Uint8Array<ArrayBuffer>): Promise<void> {
		const operation = (async () => {
			check(); if (closed) throw new Error('HDR pixel writer is retired.');
			if (writing) throw new Error('HDR pixel writes must join sequentially.');
			const bytes = snapshotChunk(value);
			writing = true;
			try { await ownedBytes(bytes, async () => {
				if (written + bytes.byteLength > byteLength) throw new RangeError('HDR pixels exceed their declared length.');
				hash.update(bytes); written += bytes.byteLength; await writer.write(bytes); check();
			}); } finally { writing = false; }
		})();
		pending.add(operation); void operation.then(() => { pending.delete(operation); }, (error: unknown) => { add(failures, error); pending.delete(operation); }); return operation;
	} });
	try {
		let producer: { error: unknown } | undefined;
		try { await produce(scoped); } catch (error) { producer = { error }; }
		closed = true; await Promise.allSettled([...pending]);
		if (producer) { const primary = [producer.error]; for (const error of failures) add(primary, error); throwFailures(primary, 'HDR producer and pixel writes failed.'); }
		throwFailures(failures, 'HDR pixel writes failed.'); check();
		if (written !== byteLength) throw new RangeError('HDR pixel writer did not supply its exact declared length.');
		const digest = hash.digest(); try { return bytesToHex(digest); } finally { Reflect.apply(FILL, digest, [0]); }
	} finally { closed = true; hash.destroy(); }
}

async function hashSnapshot(blob: Blob, length: number, check: () => void): Promise<string> {
	const hash = sha256.create();
	try {
		for (let offset = 0; offset < length; offset += CHUNK) {
			check(); const bytes = await readRange(blob, offset, Math.min(CHUNK, length - offset));
			await ownedBytes(bytes, () => { check(); hash.update(bytes); });
		}
		const digest = hash.digest(); try { return bytesToHex(digest); } finally { Reflect.apply(FILL, digest, [0]); }
	} finally { hash.destroy(); }
}
async function readRange(blob: Blob, offset: number, length: number): Promise<Uint8Array<ArrayBuffer>> {
	const slice = Reflect.apply(SLICE, blob, [offset, offset + length]) as Blob;
	const buffer = await Reflect.apply(ARRAY_BUFFER, slice, []) as ArrayBuffer;
	if (Number(Reflect.apply(SIZE, buffer, [])) !== length || Reflect.apply(RESIZABLE, buffer, [])) throw new RangeError('HDR native range exceeds its dedicated physical bound.');
	return new Bytes(buffer);
}
function snapshotChunk(value: unknown): Uint8Array<ArrayBuffer> {
	if (Reflect.apply(TAG, value, []) !== 'Uint8Array') throw new TypeError('HDR staging accepts Uint8Array pixel chunks.');
	const buffer = Reflect.apply(BUFFER, value, []) as ArrayBuffer;
	const length = Number(Reflect.apply(LENGTH, value, [])), offset = Number(Reflect.apply(OFFSET, value, []));
	integer(length, 1, CHUNK, 'HDR pixel chunk bound');
	if (Number(Reflect.apply(SIZE, buffer, [])) > PLANE || Reflect.apply(RESIZABLE, buffer, [])) throw new RangeError('HDR pixel chunk exceeds its canonical-plane physical bound.');
	const copy = new Bytes(length); Reflect.apply(SET, copy, [new Bytes(buffer, offset, length)]); return copy;
}
async function ownedBytes<Result>(bytes: Uint8Array<ArrayBuffer>, consume: () => Result | Promise<Result>): Promise<Result> {
	const buffer = bytes.buffer, length = bytes.byteLength;
	let outcome: { value: Result } | { error: unknown };
	try { outcome = { value: await consume() }; } catch (error) { outcome = { error }; }
	const failures: unknown[] = 'error' in outcome ? [outcome.error] : [];
	try {
		if (Number(Reflect.apply(SIZE, buffer, [])) !== length) throw new Error('HDR scoped bytes detached before physical retirement.');
		Reflect.apply(FILL, new Bytes(buffer), [0]);
	} catch (error) { add(failures, error); }
	throwFailures(failures, 'HDR scoped bytes and physical retirement failed.');
	if ('value' in outcome) return outcome.value;
	throw new Error('HDR byte scope has no admitted result.');
}
function captureBackend(value: unknown): ImageHdrPixelStagingBackendV1 {
	const input = record(value, 'HDR staging backend', ['ready', 'planBinaryWriter', 'read', 'deletePathExact', 'close']);
	return Object.freeze({ ready: method(input, 'ready'), planBinaryWriter: method(input, 'planBinaryWriter'), read: method(input, 'read'),
		deletePathExact: method(input, 'deletePathExact'), close: method(input, 'close') }) as ImageHdrPixelStagingBackendV1;
}
function captureWriter(value: unknown, path: string): OpfsBinaryWriter {
	const input = record(value, 'HDR native pixel writer', ['path', 'write', 'close', 'abort']);
	if (field(input, 'path', 'HDR native pixel writer') !== path) throw new RangeError('HDR native writer changed its leased path.');
	return Object.freeze({ path, write: method(input, 'write'), close: method(input, 'close'), abort: method(input, 'abort') }) as OpfsBinaryWriter;
}
function method(input: Readonly<Record<string, unknown>>, name: string): (...args: unknown[]) => unknown {
	const fn = field(input, name, 'HDR native authority'); if (typeof fn !== 'function') throw new TypeError(`HDR native ${name} must be callable.`);
	return (...args) => Reflect.apply(fn, input, args) as unknown;
}
function nativeBackend(): ImageHdrPixelStagingBackendV1 {
	const repository = new OpfsRepository({ preferOpfs: true, storageManager: globalThis.navigator?.storage,
		opfsDirectoryName: 'audio-editor-exports', syncWorkerClient: null });
	return { async ready() { return Boolean(await repository.directory()); }, planBinaryWriter: repository.planBinaryWriter.bind(repository),
		read: path => repository.loadBinaryRecord({ storage: 'opfs', path }, 'The staged HDR pixels are missing.'),
		deletePathExact: repository.deletePathExact.bind(repository), close: repository.close.bind(repository) };
}
function captureSignal(value: unknown): AbortSignal | undefined {
	if (value === undefined) return undefined;
	Reflect.apply(ABORTED, value, []); return value as AbortSignal;
}
function checkSignal(signal: AbortSignal | undefined) { if (signal && Reflect.apply(ABORTED, signal, [])) throw Reflect.apply(REASON, signal, []) as unknown; }
function integer(value: unknown, minimum: number, maximum: number, name: string): asserts value is number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`${name} exceeds its bounded integer range.`);
}
function add(failures: unknown[], error: unknown) { if (!failures.some(value => Object.is(value, error))) failures.push(error); }
function throwFailures(failures: readonly unknown[], message: string) {
	if (failures.length === 1) throw failures[0]; if (failures.length > 1) throw new AggregateError(failures, message, { cause: failures[0] });
}
