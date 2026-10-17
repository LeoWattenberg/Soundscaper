/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { withCubeLutResourceV1 } from '../../common/editor/imaging/cube-lut-resource-v1.ts';
import { request, transact } from '../../common/editor/storage/indexeddb-backend.ts';
import type { StorageRepositoryPort } from '../../common/editor/storage/repository-port.ts';
import { normalizeVideoColorGradeV1 } from '../../common/editor/video-color-management-v27.ts';
import { VIDEO_COLOR_LIMITS_V1, type VideoCubeLutReferenceV1 } from '../../common/editor/video-color-cube-lut-v27.ts';

export interface PhotoCubeLutReceiptV1 { readonly reference: Readonly<VideoCubeLutReferenceV1>; readonly created: boolean; }
export interface PhotoCubeLutOptionsV1 { readonly signal?: AbortSignal; }
interface BodyRow { readonly schemaVersion: 1; readonly kind: 'photo-cube-lut-body'; readonly reference: Readonly<VideoCubeLutReferenceV1>; readonly bytes: Uint8Array<ArrayBuffer>; }

const NativeBytes = Uint8Array, TYPED = Object.getPrototypeOf(NativeBytes.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!, OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'byteLength')!.get!, TAG = Object.getOwnPropertyDescriptor(TYPED, Symbol.toStringTag)!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!, RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')!.get!;
const SET = NativeBytes.prototype.set, FILL = NativeBytes.prototype.fill, CHECK = AbortSignal.prototype.throwIfAborted;
const HAS = Map.prototype.has, GET = Map.prototype.get, PUT = Map.prototype.set;

/** Append-only immutable resources in the selected media DB2 analysis domain.
 * LUT keys are separate from computed analysis, original roots and evictable
 * previews. This borrower owns no database connection and exposes no deletion
 * or reclaim authority. Native completion acknowledges insertion; memory is
 * explicitly degraded. One operation is admitted, with no caller recipe queue.
 * Each scoped raw view/backing is <=16MiB; parsing adds bounded V27 scratch,
 * so these component bounds are not a total JS heap claim. */
export class PhotoCubeLutRepositoryV1 {
	readonly #database: StorageRepositoryPort['database'];
	readonly #memory: StorageRepositoryPort['memory']['analysis'];
	#active: Promise<unknown> | null = null;
	#closed = false;
	#closing: Promise<void> | null = null;
	constructor(port: StorageRepositoryPort) {
		const database = port.database;
		if (typeof database !== 'function') throw new TypeError('LUT storage requires a database capability.');
		this.#database = database.bind(port); this.#memory = port.memory.analysis;
		Reflect.apply(HAS, this.#memory, ['']); // Require the existing native memory domain.
	}

	put(referenceValue: unknown, bytesValue: unknown, options: PhotoCubeLutOptionsV1 = {}): Promise<Readonly<PhotoCubeLutReceiptV1>> {
		return this.#run(async () => {
			const signal = admitSignal(options), reference = admitReference(referenceValue), bytes = copyBytes(bytesValue);
			const backing = bytes.buffer;
			try {
				// Authenticate before publication. The scoped parser's final abort
				// check must not revoke an already completed native insertion ACK.
				await withCubeLutResourceV1({ reference, bytes, signal }, () => undefined);
				check(signal); const database = await this.#database(); check(signal);
				const next: BodyRow = Object.freeze({ schemaVersion: 1, kind: 'photo-cube-lut-body', reference, bytes });
				let created: boolean;
				if (!database) {
					if (Reflect.apply(HAS, this.#memory, [reference.storageKey])) {
						await verifyRow(Reflect.apply(GET, this.#memory, [reference.storageKey]), reference, signal); created = false;
					} else {
						check(signal); const persisted = copyBytes(bytes);
						Reflect.apply(PUT, this.#memory, [reference.storageKey, { key: reference.storageKey, value: { ...next, bytes: persisted } }]); created = true;
					}
				} else created = await transact(database, 'analysis', 'readwrite', async stores => {
					const store = stores.analysis!, current: unknown = await request(store.get(reference.storageKey)); check(signal);
					if (current !== undefined) { await verifyRow(current, reference, signal); return false; }
					await request(store.add({ key: reference.storageKey, value: next })); return true;
				});
				return Object.freeze({ reference, created });
			} finally { wipe(bytes, backing); }
		});
	}

	/** The consumer borrows authenticated raw bytes until it settles. It must
	 * not retain or transfer the view. Its mutation cannot alter persisted data.
	 * Complete reference/body authentication precedes every delivery, including
	 * reused keys; metadata is never sufficient content authority. */
	withBytes<T>(referenceValue: unknown, consume: (bytes: Uint8Array<ArrayBuffer>) => T | Promise<T>, options: PhotoCubeLutOptionsV1 = {}): Promise<T> {
		return this.#run(async () => {
			const signal = admitSignal(options), reference = admitReference(referenceValue);
			if (typeof consume !== 'function') throw new TypeError('LUT reads require a scoped consumer.');
			const database = await this.#database(); check(signal);
			let stored: unknown;
			if (database) stored = await transact(database, 'analysis', 'readonly', stores => request(stores.analysis!.get(reference.storageKey)));
			else { if (!Reflect.apply(HAS, this.#memory, [reference.storageKey])) throw new ReferenceError('The LUT body is missing.'); stored = Reflect.apply(GET, this.#memory, [reference.storageKey]); }
			check(signal); if (stored === undefined && database) throw new ReferenceError('The LUT body is missing.');
			const bytes = readRowBytes(stored, reference), backing = bytes.buffer;
			try { const result = await withCubeLutResourceV1({ reference, bytes, signal }, () => consume(bytes)); check(signal); return result; }
			finally { wipe(bytes, backing); }
		});
	}

	/** Seal and drain only. Each admitted promise owns its exact outcome; the
	 * caller must join that promise for failure evidence as well as this drain.
	 * No borrowed connection is closed or target cleanup acknowledged here. */
	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		this.#closed = true;
		this.#closing = (async () => { await this.#active?.catch(() => undefined); })();
		return this.#closing;
	}
	#run<T>(operation: () => Promise<T>): Promise<T> {
		if (this.#closed) return Promise.reject(new Error('LUT storage is closed.'));
		if (this.#active) return Promise.reject(new Error('A LUT storage operation is pending.'));
		let resolve!: (value: T | PromiseLike<T>) => void, reject!: (reason: unknown) => void;
		const work = new Promise<T>((accept, refuse) => { resolve = accept; reject = refuse; }); this.#active = work;
		void work.then(() => { if (this.#active === work) this.#active = null; }, () => { if (this.#active === work) this.#active = null; });
		try { resolve(operation()); } catch (error) { reject(error); }
		return work;
	}
}

function admitSignal(value: unknown): AbortSignal | undefined {
	const input = record(value, 'LUT storage options', ['signal'], []), signal = Object.hasOwn(input, 'signal') ? field(input, 'signal', 'LUT storage options') as AbortSignal | undefined : undefined;
	check(signal); return signal;
}
function check(signal: AbortSignal | undefined): void { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }
function admitReference(value: unknown): Readonly<VideoCubeLutReferenceV1> {
	const reference = normalizeVideoColorGradeV1({ ...normalizeVideoColorGradeV1(), lut: value }).lut;
	if (!reference) throw new TypeError('LUT storage requires an exact reference.'); return reference;
}
function readRowBytes(value: unknown, reference: Readonly<VideoCubeLutReferenceV1>): Uint8Array<ArrayBuffer> {
	const wrapper = record(value, 'stored LUT wrapper', ['key', 'value']);
	if (field(wrapper, 'key', 'stored LUT wrapper') !== reference.storageKey) throw new TypeError('Stored LUT key differs.');
	const row = record(field(wrapper, 'value', 'stored LUT wrapper'), 'stored LUT body', ['schemaVersion', 'kind', 'reference', 'bytes']);
	if (field(row, 'schemaVersion', 'stored LUT body') !== 1 || field(row, 'kind', 'stored LUT body') !== 'photo-cube-lut-body'
		|| JSON.stringify(admitReference(field(row, 'reference', 'stored LUT body'))) !== JSON.stringify(reference)) throw new TypeError('Stored LUT reference differs.');
	return copyBytes(field(row, 'bytes', 'stored LUT body'));
}
async function verifyRow(value: unknown, reference: Readonly<VideoCubeLutReferenceV1>, signal?: AbortSignal): Promise<void> {
	const bytes = readRowBytes(value, reference), backing = bytes.buffer;
	try { await withCubeLutResourceV1({ reference, bytes, signal }, () => undefined); } finally { wipe(bytes, backing); }
}
function copyBytes(value: unknown): Uint8Array<ArrayBuffer> {
	if (Reflect.apply(TAG, value, []) !== 'Uint8Array') throw new TypeError('LUT bodies require native bytes.');
	for (const key of ['buffer', 'byteLength', 'byteOffset', 'length']) if (Object.hasOwn(value as object, key)) throw new TypeError('LUT bytes may not shadow geometry.');
	const buffer = Reflect.apply(BUFFER, value, []) as ArrayBuffer, size = Number(Reflect.apply(SIZE, buffer, []));
	const length = Number(Reflect.apply(LENGTH, value, [])), offset = Number(Reflect.apply(OFFSET, value, []));
	if (Reflect.apply(RESIZABLE, buffer, []) !== false || length < 1 || length > VIDEO_COLOR_LIMITS_V1.maximumCubeLutBytes
		|| size > VIDEO_COLOR_LIMITS_V1.maximumCubeLutBytes || offset + length > size) throw new RangeError('LUT bytes exceed their fixed backing bound.');
	const bytes = new NativeBytes(length); Reflect.apply(SET, bytes, [new NativeBytes(buffer, offset, length)]); return bytes;
}
function wipe(bytes: Uint8Array<ArrayBuffer>, buffer: ArrayBuffer): void { if (Reflect.apply(SIZE, buffer, []) > 0) Reflect.apply(FILL, bytes, [0]); }
