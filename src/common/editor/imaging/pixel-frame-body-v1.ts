/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { readPixelFrameV1, type PixelFrameLimitsV1, type PixelFrameV1 } from './pixel-frame-contract-v1.ts';

const BLOB_SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')?.get;
const BLOB_READ = Blob.prototype.arrayBuffer;
const BUFFER_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')?.get;
const ABORT_CHECK = AbortSignal.prototype.throwIfAborted;
const HASH_SPAN_BYTES = 65_536;
const HASH_TASK_BYTES = 1_048_576;

export interface PixelFrameBodyRequestV1 {
	readonly descriptor: unknown;
	readonly byteLength: number;
	readonly outputSha256: string;
	readonly body: unknown;
	readonly signal?: AbortSignal;
}

/** One joined, authenticated native read; the consumer borrows pixels only within its callback. */
export async function withPixelFrameBodyV1<T>(requestValue: PixelFrameBodyRequestV1,
	consume: (frame: PixelFrameV1) => Promise<T> | T, optionsValue: Readonly<{ limits: PixelFrameLimitsV1 }>): Promise<T> {
	const input = record(requestValue, 'pixel frame body request', ['descriptor', 'byteLength', 'outputSha256', 'body', 'signal'], ['descriptor', 'byteLength', 'outputSha256', 'body']);
	const options = record(optionsValue, 'pixel frame body options', ['limits']);
	const rawLimits = record(field(options, 'limits', 'pixel frame body options'), 'pixel frame body limits', ['maximumSidePixels', 'maximumPixels', 'maximumBytes']);
	const limits = Object.freeze(Object.fromEntries(Object.keys(rawLimits).map(key => [key, field(rawLimits, key, 'pixel frame body limits')])));
	const plan = admitPixelFrameV1(field(input, 'descriptor', 'pixel frame body request'), { limits });
	const length = field(input, 'byteLength', 'pixel frame body request');
	if (typeof length !== 'number' || !Number.isSafeInteger(length) || length !== plan.byteLength) throw new RangeError('Pixel frame body length disagrees with its descriptor.');
	const expected = field(input, 'outputSha256', 'pixel frame body request');
	if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/u.test(expected)) throw new TypeError('Pixel frame body requires a lowercase SHA-256 digest.');
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal', 'pixel frame body request') : undefined;
	if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('Pixel frame body requires a native cancellation signal.');
	if (typeof consume !== 'function') throw new TypeError('Pixel frame body requires a scoped consumer.');
	const check = () => { if (signal) Reflect.apply(ABORT_CHECK, signal, []); };
	check();
	const body = genuineBlob(field(input, 'body', 'pixel frame body request'), length);
	let buffer: unknown;
	const digest = sha256.create();
	try {
		try { buffer = await Reflect.apply(BLOB_READ, body, []) as unknown; }
		catch (error) { check(); throw error; }
		check();
		if (!(buffer instanceof ArrayBuffer)) throw new TypeError('Pixel frame native read requires an ArrayBuffer.');
		const frame = readPixelFrameV1({ descriptor: plan.descriptor, pixels: new Uint8Array(buffer) }, limits);
		for (let start = 0; start < length; start += HASH_SPAN_BYTES) {
			check();
			const end = Math.min(start + HASH_SPAN_BYTES, length);
			digest.update(new Uint8Array(buffer, start, end - start));
			if (end < length && end % HASH_TASK_BYTES === 0) {
				await new Promise<void>(resolve => { setTimeout(resolve, 0); });
				check();
			}
		}
		if (bytesToHex(digest.digest()) !== expected) throw new RangeError('Pixel frame body digest disagrees with its authenticated output.');
		check();
		const result = await consume(frame);
		check();
		return result;
	} finally {
		digest.destroy();
		// A consumer may retain or shadow its borrowed view; wipe through a fresh
		// intrinsic view. A detached buffer has no remaining owned bytes to wipe.
		if (buffer instanceof ArrayBuffer && BUFFER_SIZE && Number(Reflect.apply(BUFFER_SIZE, buffer, [])) > 0) new Uint8Array(buffer).fill(0);
	}
}

function genuineBlob(value: unknown, length: number): Blob {
	let size: unknown;
	try { if (!BLOB_SIZE) throw new TypeError(); size = Reflect.apply(BLOB_SIZE, value, []) as unknown; }
	catch { throw new TypeError('Pixel frame body must be a genuine Blob or File.'); }
	if (size !== length) throw new RangeError('Pixel frame Blob size disagrees with its declared length.');
	return value as Blob;
}
