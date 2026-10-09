/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import {
	parseCubeLutV1, requireCubeLutBody, VIDEO_COLOR_LIMITS_V1,
	type ParsedCubeLutV1, type VideoCubeLutReferenceV1,
} from '../video-color-cube-lut-v27.ts';
import { normalizeVideoColorGradeV1 } from '../video-color-management-v27.ts';

export interface CubeLutResourceRequestV1 {
	readonly reference: unknown;
	readonly bytes: unknown;
	readonly signal?: AbortSignal;
}

export interface CubeLutResourceV1 {
	readonly reference: Readonly<VideoCubeLutReferenceV1>;
	readonly body: ParsedCubeLutV1;
}

const NativeBytes = Uint8Array;
const TYPED = Object.getPrototypeOf(NativeBytes.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!;
const OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'byteLength')!.get!;
const TAG = Object.getOwnPropertyDescriptor(TYPED, Symbol.toStringTag)!.get!;
const BUFFER_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')!.get!;
const SET = NativeBytes.prototype.set;
const FILL = NativeBytes.prototype.fill;
const ABORT_CHECK = AbortSignal.prototype.throwIfAborted;

/**
 * The callback borrows the existing privately parsed V27 body, never a new
 * clone admission. Its reference retains the V27 linear Rec709 LUT process.
 * Caller bytes and their fixed backing are each <=16MiB; one detached raw copy
 * is owned here and wiped after the joined consumer. Parsing is synchronous
 * between intrinsic cancellation checks. V27 parsing also owns UTF8/text and
 * lattice scratch: this is not a whole-heap bound. Its frozen numeric array
 * cannot be zeroed; references are released here on settlement and consumers
 * must not retain the borrowed body. No body cache or persistence is created.
 */
export async function withCubeLutResourceV1<T>(
	requestValue: unknown,
	consume: (resource: Readonly<CubeLutResourceV1>) => T | Promise<T>,
): Promise<T> {
	const input = record(requestValue, 'cube LUT resource', ['reference', 'bytes', 'signal'], ['reference', 'bytes']);
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal', 'cube LUT resource') : undefined;
	const check = () => { if (signal !== undefined) Reflect.apply(ABORT_CHECK, signal, []); };
	check();
	if (typeof consume !== 'function') throw new TypeError('Cube LUT resource requires a scoped consumer.');
	// This existing closed normalizer is the sole persisted-reference authority.
	const reference = normalizeVideoColorGradeV1({ ...normalizeVideoColorGradeV1(),
		lut: field(input, 'reference', 'cube LUT resource') }).lut;
	if (reference === null) throw new TypeError('Cube LUT resource requires a LUT reference.');
	const source = field(input, 'bytes', 'cube LUT resource');
	if (Reflect.apply(TAG, source, []) !== 'Uint8Array') throw new TypeError('Cube LUT bytes require a native Uint8Array.');
	for (const name of ['buffer', 'byteLength', 'byteOffset', 'length']) {
		if (Object.hasOwn(source as object, name)) throw new TypeError('Cube LUT bytes may not shadow intrinsic geometry.');
	}
	const buffer = Reflect.apply(BUFFER, source, []) as ArrayBuffer;
	const backingLength = Number(Reflect.apply(BUFFER_SIZE, buffer, []));
	const byteLength = Number(Reflect.apply(LENGTH, source, []));
	const byteOffset = Number(Reflect.apply(OFFSET, source, []));
	if (Reflect.apply(RESIZABLE, buffer, []) !== false) throw new TypeError('Cube LUT bytes require a fixed ArrayBuffer.');
	if (byteLength < 1 || byteLength > VIDEO_COLOR_LIMITS_V1.maximumCubeLutBytes
		|| backingLength > VIDEO_COLOR_LIMITS_V1.maximumCubeLutBytes || byteOffset + byteLength > backingLength) {
		throw new RangeError('Cube LUT bytes exceed the admitted fixed-buffer bound.');
	}
	const checkSource = () => {
		check();
		if (Reflect.apply(BUFFER_SIZE, buffer, []) !== backingLength
			|| Reflect.apply(BUFFER, source, []) !== buffer || Reflect.apply(LENGTH, source, []) !== byteLength
			|| Reflect.apply(OFFSET, source, []) !== byteOffset) {
			throw new RangeError('Cube LUT source buffer was detached or changed before completion.');
		}
	};
	checkSource();
	const bytes = new Uint8Array(byteLength);
	const transient: { text?: string; body?: ParsedCubeLutV1 } = {};
	try {
		Reflect.apply(SET, bytes, [new NativeBytes(buffer, byteOffset, byteLength)]);
		checkSource();
		// Match the existing Frame importer: no byte-order mark is discarded.
		if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) throw new TypeError('Cube LUT UTF8 must not start with a BOM.');
		transient.text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
		transient.body = parseCubeLutV1(transient.text);
		transient.text = undefined;
		requireCubeLutBody(reference, transient.body);
		checkSource();
		const result = await consume(Object.freeze({ reference, body: transient.body }));
		checkSource();
		return result;
	} finally {
		transient.text = undefined;
		transient.body = undefined;
		Reflect.apply(FILL, bytes, [0]);
	}
}
