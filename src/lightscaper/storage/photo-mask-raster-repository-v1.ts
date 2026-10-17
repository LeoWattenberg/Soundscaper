/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { BRUSH_MASK_RESOURCE_LIMITS_V1, normalizeBrushMaskResourceReferenceV1, withBrushMaskResourceV1,
	type BrushMaskResourceReferenceV1 } from '../../common/editor/imaging/brush-mask-resource-v1.ts';
import { request, transact } from '../../common/editor/storage/indexeddb-backend.ts';
import type { StorageRepositoryPort } from '../../common/editor/storage/repository-port.ts';

export interface PhotoMaskRasterReceiptV1 { readonly reference: Readonly<BrushMaskResourceReferenceV1>; readonly created: boolean; }
export interface PhotoMaskRasterOptionsV1 { readonly signal?: AbortSignal; }
interface BodyRow { readonly schemaVersion: 1; readonly kind: 'photo-mask-raster-body'; readonly reference: Readonly<BrushMaskResourceReferenceV1>; readonly bytes: Uint8Array<ArrayBuffer>; }

const REF_FIELDS = Object.freeze(['storageKey', 'sha256', 'width', 'height', 'byteLength']);
const NativeBytes = Uint8Array, TYPED = Object.getPrototypeOf(NativeBytes.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!, OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'byteLength')!.get!, TAG = Object.getOwnPropertyDescriptor(TYPED, Symbol.toStringTag)!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!, RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')!.get!;
const SET = NativeBytes.prototype.set, FILL = NativeBytes.prototype.fill, CHECK = AbortSignal.prototype.throwIfAborted;
const HAS = Map.prototype.has, GET = Map.prototype.get, PUT = Map.prototype.set;

/** Append-only SCMASK01 bodies in the selected media DB2 analysis domain.
 * Original custody and evictable previews do not own these logical keys.
 * Native transaction completion acknowledges insertion; memory is degraded.
 * This borrower owns no connection, deletion authority or queued recipe.
 * Each private encoded body is bounded by 1MiB+16; authentication also owns
 * one bounded body copy, so these are component bounds, not a total heap bound. */
export class PhotoMaskRasterRepositoryV1 {
	readonly #database: StorageRepositoryPort['database'];
	readonly #memory: StorageRepositoryPort['memory']['analysis'];
	#active: Promise<unknown> | null = null;
	#closed = false;
	#closing: Promise<void> | null = null;
	constructor(port: StorageRepositoryPort) {
		const database = port.database;
		if (typeof database !== 'function') throw new TypeError('Brush storage requires a database capability.');
		this.#database = database.bind(port); this.#memory = port.memory.analysis;
		Reflect.apply(HAS, this.#memory, ['']);
	}

	put(referenceValue: unknown, bytesValue: unknown, options: PhotoMaskRasterOptionsV1 = {}): Promise<Readonly<PhotoMaskRasterReceiptV1>> {
		return this.#run(async () => {
			const signal = admitSignal(options), reference = admitReference(referenceValue), bytes = copyBytes(bytesValue, reference.byteLength);
			const backing = bytes.buffer;
			try {
				// Authenticate outside the insertion scope. Its final abort check
				// cannot revoke a later completed native immutable insertion ACK.
				await withBrushMaskResourceV1({ reference, bytes, signal }, () => undefined);
				check(signal); const database = await this.#database(); check(signal);
				const next: BodyRow = Object.freeze({ schemaVersion: 1, kind: 'photo-mask-raster-body', reference, bytes });
				let created: boolean;
				if (!database) {
					if (Reflect.apply(HAS, this.#memory, [reference.storageKey])) {
						await verifyRow(Reflect.apply(GET, this.#memory, [reference.storageKey]), reference, signal); created = false;
					} else {
						check(signal); const persisted = copyBytes(bytes, reference.byteLength);
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

	/** Authenticate every delivery, including reused keys. The consumer joins
	 * the private raw-body scope and may not retain or transfer it. Its mutation
	 * cannot alter durable storage, and metadata alone is never body authority. */
	withBytes<Result>(referenceValue: unknown, consume: (bytes: Uint8Array<ArrayBuffer>) => Result | Promise<Result>, options: PhotoMaskRasterOptionsV1 = {}): Promise<Result> {
		return this.#run(async () => {
			const signal = admitSignal(options), reference = admitReference(referenceValue);
			if (typeof consume !== 'function') throw new TypeError('Brush reads require a scoped consumer.');
			const database = await this.#database(); check(signal);
			let stored: unknown;
			if (database) stored = await transact(database, 'analysis', 'readonly', stores => request(stores.analysis!.get(reference.storageKey)));
			else {
				if (!Reflect.apply(HAS, this.#memory, [reference.storageKey])) throw new ReferenceError('The brush body is missing.');
				stored = Reflect.apply(GET, this.#memory, [reference.storageKey]);
			}
			check(signal); if (stored === undefined && database) throw new ReferenceError('The brush body is missing.');
			const bytes = readRowBytes(stored, reference), backing = bytes.buffer;
			try { const result = await withBrushMaskResourceV1({ reference, bytes, signal }, () => consume(bytes)); check(signal); return result; }
			finally { wipe(bytes, backing); }
		});
	}

	/** Seal and drain. The admitted operation retains its exact failure;
	 * observing Close alone does not replace joining that operation's outcome. */
	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		this.#closed = true;
		this.#closing = (async () => { await this.#active?.catch(() => undefined); })();
		return this.#closing;
	}
	#run<Result>(operation: () => Promise<Result>): Promise<Result> {
		if (this.#closed) return Promise.reject(new Error('Brush storage is closed.'));
		if (this.#active) return Promise.reject(new Error('A brush storage operation is pending.'));
		let resolve!: (value: Result | PromiseLike<Result>) => void, reject!: (reason: unknown) => void;
		const work = new Promise<Result>((accept, refuse) => { resolve = accept; reject = refuse; }); this.#active = work;
		void work.then(() => { if (this.#active === work) this.#active = null; }, () => { if (this.#active === work) this.#active = null; });
		try { resolve(operation()); } catch (error) { reject(error); }
		return work;
	}
}

function admitSignal(value: unknown): AbortSignal | undefined {
	const input = record(value, 'brush storage options', ['signal'], []), signal = Object.hasOwn(input, 'signal') ? field(input, 'signal', 'brush storage options') : undefined;
	if (signal === undefined) return undefined;
	check(signal as AbortSignal);
	if (Object.getPrototypeOf(signal) !== AbortSignal.prototype
		|| ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener'].some(key => Object.hasOwn(signal as object, key))) {
		throw new TypeError('Brush storage requires an unshadowed native cancellation signal.');
	}
	return signal as AbortSignal;
}
function check(signal: AbortSignal | undefined): void { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }
function admitReference(value: unknown): Readonly<BrushMaskResourceReferenceV1> {
	if (typeof value === 'string') return normalizeBrushMaskResourceReferenceV1(value);
	const input = record(value, 'brush storage reference', REF_FIELDS), canonical = normalizeBrushMaskResourceReferenceV1(field(input, 'storageKey', 'brush storage reference'));
	for (const key of REF_FIELDS) if (field(input, key, 'brush storage reference') !== canonical[key as keyof BrushMaskResourceReferenceV1]) {
		throw new TypeError('Brush reference scalars differ from the canonical key.');
	}
	return canonical;
}
function readRowBytes(value: unknown, reference: Readonly<BrushMaskResourceReferenceV1>): Uint8Array<ArrayBuffer> {
	const wrapper = record(value, 'stored brush wrapper', ['key', 'value']);
	if (field(wrapper, 'key', 'stored brush wrapper') !== reference.storageKey) throw new TypeError('Stored brush key differs.');
	const row = record(field(wrapper, 'value', 'stored brush wrapper'), 'stored brush body', ['schemaVersion', 'kind', 'reference', 'bytes']);
	if (field(row, 'schemaVersion', 'stored brush body') !== 1 || field(row, 'kind', 'stored brush body') !== 'photo-mask-raster-body') {
		throw new TypeError('Stored brush body version or kind differs.');
	}
	const storedReference = admitReference(field(row, 'reference', 'stored brush body'));
	for (const key of REF_FIELDS) if (storedReference[key as keyof BrushMaskResourceReferenceV1] !== reference[key as keyof BrushMaskResourceReferenceV1]) {
		throw new TypeError('Stored brush reference differs.');
	}
	return copyBytes(field(row, 'bytes', 'stored brush body'), reference.byteLength);
}
async function verifyRow(value: unknown, reference: Readonly<BrushMaskResourceReferenceV1>, signal?: AbortSignal): Promise<void> {
	const bytes = readRowBytes(value, reference), backing = bytes.buffer;
	try { await withBrushMaskResourceV1({ reference, bytes, signal }, () => undefined); } finally { wipe(bytes, backing); }
}
function copyBytes(value: unknown, length: number): Uint8Array<ArrayBuffer> {
	if (Reflect.apply(TAG, value, []) !== 'Uint8Array') throw new TypeError('Brush bodies require native bytes.');
	for (const key of ['buffer', 'byteLength', 'byteOffset', 'length']) if (Object.hasOwn(value as object, key)) throw new TypeError('Brush bytes may not shadow geometry.');
	const buffer = Reflect.apply(BUFFER, value, []) as ArrayBuffer;
	if (length < 1 || length > BRUSH_MASK_RESOURCE_LIMITS_V1.maximumBodyBytes || Reflect.apply(RESIZABLE, buffer, []) !== false
		|| Reflect.apply(SIZE, buffer, []) !== length || Reflect.apply(LENGTH, value, []) !== length || Reflect.apply(OFFSET, value, []) !== 0) {
		throw new RangeError('Brush bytes require their exact bounded fixed backing.');
	}
	const bytes = new NativeBytes(length); Reflect.apply(SET, bytes, [new NativeBytes(buffer)]); return bytes;
}
function wipe(bytes: Uint8Array<ArrayBuffer>, buffer: ArrayBuffer): void { if (Reflect.apply(SIZE, buffer, []) > 0) Reflect.apply(FILL, bytes, [0]); }
