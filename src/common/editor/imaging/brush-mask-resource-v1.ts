/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';

export const BRUSH_MASK_RESOURCE_LIMITS_V1 = Object.freeze({ maximumSide: 1024, maximumPixels: 1_048_576,
	headerBytes: 16, maximumBodyBytes: 1_048_592 });
export interface BrushMaskResourceReferenceV1 {
	readonly storageKey: string;
	readonly sha256: string;
	readonly width: number;
	readonly height: number;
	readonly byteLength: number;
}
export interface BrushMaskResourceV1 { readonly reference: Readonly<BrushMaskResourceReferenceV1>; readonly alpha: Uint8Array<ArrayBuffer>; }
export interface PreparedBrushMaskResourceV1 { readonly reference: Readonly<BrushMaskResourceReferenceV1>; readonly bytes: Uint8Array<ArrayBuffer>; }
export interface BrushMaskResourceRequestV1 { readonly reference: unknown; readonly bytes: unknown; readonly signal?: AbortSignal; }
export interface PrepareBrushMaskResourceRequestV1 { readonly width: number; readonly height: number; readonly alpha: unknown; readonly signal?: AbortSignal; }

const NativeBytes = Uint8Array, TYPED = Object.getPrototypeOf(NativeBytes.prototype) as object;
const TAG = Object.getOwnPropertyDescriptor(TYPED, Symbol.toStringTag)!.get!;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!, OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'byteLength')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!, RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')!.get!;
const SET = NativeBytes.prototype.set, FILL = NativeBytes.prototype.fill, SUBARRAY = NativeBytes.prototype.subarray;
const GET32 = DataView.prototype.getUint32, PUT32 = DataView.prototype.setUint32;
const CHECK = AbortSignal.prototype.throwIfAborted, SIGNAL_PROTOTYPE = AbortSignal.prototype;
const HEADER = Object.freeze([83, 67, 77, 65, 83, 75, 48, 49]); // SCMASK01.
const REFERENCE = /^brush-mask-v1:([1-9]\d{0,3}):([1-9]\d{0,3}):([0-9a-f]{64})$/u;
const REF_FIELDS = Object.freeze(['storageKey', 'sha256', 'width', 'height', 'byteLength']);

/** The resource namespace is logical content identity, never a physical Source ID. */
export function normalizeBrushMaskResourceReferenceV1(value: unknown): Readonly<BrushMaskResourceReferenceV1> {
	if (typeof value !== 'string') throw new TypeError('Brush references require a canonical primitive string.');
	const match = REFERENCE.exec(value);
	if (!match) throw new TypeError('Brush reference version, dimensions or digest is invalid.');
	const width = dimension(Number(match[1])), height = dimension(Number(match[2]));
	return Object.freeze({ storageKey: value, sha256: match[3]!, width, height, byteLength: width * height + 16 });
}

/** Authenticate a private exact body copy, then borrow its alpha until the
 * consumer settles. No storage/capability/decoded RGBA authority is created.
 * Alpha has linear coverage semantics, without any color transfer function.
 * This <=1MiB+16 copy is a component bound; a renderer must also charge its
 * source read, RGBA expansion, graph planes and overlay overlap before use. */
export async function withBrushMaskResourceV1<Result>(value: unknown,
	consume: (resource: Readonly<BrushMaskResourceV1>) => Result | Promise<Result>): Promise<Result> {
	const input = record(value, 'brush resource request', ['reference', 'bytes', 'signal'], ['reference', 'bytes']);
	const signal = captureSignal(input); check(signal);
	if (typeof consume !== 'function') throw new TypeError('Brush resources require a scoped consumer.');
	const reference = admitReference(field(input, 'reference', 'brush resource request'));
	const bytes = copyBytes(field(input, 'bytes', 'brush resource request'), reference.byteLength), backing = bytes.buffer;
	try {
		const view = new DataView(backing);
		if (HEADER.some((byte, index) => bytes[index] !== byte)
			|| Reflect.apply(GET32, view, [8, true]) !== reference.width || Reflect.apply(GET32, view, [12, true]) !== reference.height) {
			throw new TypeError('Brush body header differs from its exact reference.');
		}
		if (digest(bytes) !== reference.sha256) throw new TypeError('Brush body SHA256 differs from its exact reference.');
		check(signal);
		const alpha = Reflect.apply(SUBARRAY, bytes, [16]) as Uint8Array<ArrayBuffer>;
		const result = await consume(Object.freeze({ reference, alpha })); check(signal); return result;
	} finally { wipe(bytes, backing); }
}

/** Build canonical bytes from a copied alpha plane. Installation may run in
 * the awaited consumer; only its detached scalar receipt should escape.
 * A completed native installation ACK belongs to that storage owner, which
 * must retain it independently of this scope's final cancellation check. */
export async function withPreparedBrushMaskResourceV1<Result>(value: unknown,
	consume: (prepared: Readonly<PreparedBrushMaskResourceV1>) => Result | Promise<Result>): Promise<Result> {
	const input = record(value, 'brush preparation', ['width', 'height', 'alpha', 'signal'], ['width', 'height', 'alpha']);
	const signal = captureSignal(input); check(signal);
	if (typeof consume !== 'function') throw new TypeError('Brush preparation requires a scoped consumer.');
	const width = dimension(field(input, 'width', 'brush preparation')), height = dimension(field(input, 'height', 'brush preparation'));
	const alpha = copyBytes(field(input, 'alpha', 'brush preparation'), width * height), alphaBacking = alpha.buffer;
	let bytes: Uint8Array<ArrayBuffer> | undefined;
	let backing: ArrayBuffer | undefined;
	try {
		bytes = new NativeBytes(alpha.length + 16); backing = bytes.buffer; Reflect.apply(SET, bytes, [HEADER]);
		const view = new DataView(backing); Reflect.apply(PUT32, view, [8, width, true]); Reflect.apply(PUT32, view, [12, height, true]);
		Reflect.apply(SET, bytes, [alpha, 16]);
		const reference = normalizeBrushMaskResourceReferenceV1(`brush-mask-v1:${width}:${height}:${digest(bytes)}`);
		check(signal); const result = await consume(Object.freeze({ reference, bytes })); check(signal); return result;
	} finally { wipe(alpha, alphaBacking); if (bytes && backing) wipe(bytes, backing); }
}

function admitReference(value: unknown): Readonly<BrushMaskResourceReferenceV1> {
	if (typeof value === 'string') return normalizeBrushMaskResourceReferenceV1(value);
	const input = record(value, 'brush reference', REF_FIELDS), canonical = normalizeBrushMaskResourceReferenceV1(field(input, 'storageKey', 'brush reference'));
	for (const key of REF_FIELDS) if (field(input, key, 'brush reference') !== canonical[key as keyof BrushMaskResourceReferenceV1]) {
		throw new TypeError('Brush reference scalars differ from its canonical storage key.');
	}
	return canonical;
}
function dimension(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 1024) throw new RangeError('Brush dimensions require integers from 1 through 1024.');
	return value;
}
function captureSignal(input: Readonly<Record<string, unknown>>): AbortSignal | undefined {
	const value = Object.hasOwn(input, 'signal') ? field(input, 'signal', 'brush request') : undefined;
	if (value === undefined) return undefined;
	if (typeof value !== 'object' || value === null) throw new TypeError('Brush work requires a native cancellation signal.');
	Reflect.apply(CHECK, value, []);
	if (Object.getPrototypeOf(value) !== SIGNAL_PROTOTYPE || ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener'].some(key => Object.hasOwn(value, key))) {
		throw new TypeError('Brush cancellation may not shadow native behavior.');
	}
	return value as AbortSignal;
}
function check(signal: AbortSignal | undefined): void { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }
function copyBytes(value: unknown, length: number): Uint8Array<ArrayBuffer> {
	if (Reflect.apply(TAG, value, []) !== 'Uint8Array') throw new TypeError('Brush bytes require a native Uint8Array.');
	for (const key of ['buffer', 'byteLength', 'byteOffset', 'length']) if (Object.hasOwn(value as object, key)) throw new TypeError('Brush byte geometry may not be shadowed.');
	const buffer = Reflect.apply(BUFFER, value, []) as ArrayBuffer;
	if (Reflect.apply(RESIZABLE, buffer, []) !== false || Reflect.apply(SIZE, buffer, []) !== length
		|| Reflect.apply(LENGTH, value, []) !== length || Reflect.apply(OFFSET, value, []) !== 0) {
		throw new RangeError('Brush bytes require their exact fixed native backing and admitted length.');
	}
	const copy = new NativeBytes(length); Reflect.apply(SET, copy, [new NativeBytes(buffer)]); return copy;
}
function digest(bytes: Uint8Array<ArrayBuffer>): string {
	const hashed = sha256(bytes); try { return bytesToHex(hashed); } finally { Reflect.apply(FILL, hashed, [0]); }
}
function wipe(bytes: Uint8Array<ArrayBuffer>, backing: ArrayBuffer): void { if (Reflect.apply(SIZE, backing, []) > 0) Reflect.apply(FILL, bytes, [0]); }
