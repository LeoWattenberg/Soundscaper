/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainArray, readClosedDomainField as field, readClosedDomainRecord as record,
} from '../closed-domain-value.ts';
import { applyPreparedManagedSdrByteFrameV1 } from '../video-color-byte-encoding.ts';
import {
	normalizeVideoColorGradeV1, normalizeVideoSourceColorInterpretationV1,
	prepareManagedSdrGradeStackV1, type VideoColorOutputSpaceV1,
} from '../video-color-management-v27.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import {
	readPixelFrameV1, type PixelFrameDescriptorV1, type PixelFrameLimitsV1,
} from './pixel-frame-contract-v1.ts';

export interface ManagedSdrPixelFrameV1 {
	readonly descriptor: Readonly<PixelFrameDescriptorV1 & { sampleFormat: 'unorm8' }>;
	readonly pixels: Uint8Array<ArrayBuffer>;
}

export interface ManagedSdrPixelFrameRequestV1 {
	readonly frame: unknown;
	readonly grades: readonly unknown[];
	readonly decoding: 'file' | 'canvas-readback' | 'linear';
	readonly interpretation?: unknown;
	readonly output: VideoColorOutputSpaceV1;
	readonly signal?: AbortSignal;
}

// Leave room for the existing ungraded byte kernel's 256-byte transfer lookup.
const CHUNK_BYTES = 256 * 1024 - 256;
const MAXIMUM_SETTINGS_BYTES = 64 * 1024;
const ABORT_CHECK = AbortSignal.prototype.throwIfAborted;
const BUFFER_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')?.get;

/** The consumer borrows one managed byte frame; every owned byte is wiped when it settles. */
export async function withManagedSdrPixelFrameV1<T>(
	requestValue: unknown,
	consume: (frame: ManagedSdrPixelFrameV1) => T | Promise<T>,
	optionsValue: Readonly<{ limits: PixelFrameLimitsV1 }>,
): Promise<T> {
	const input = record(requestValue, 'managed SDR frame request',
		['frame', 'grades', 'decoding', 'interpretation', 'output', 'signal'], ['frame', 'grades', 'decoding', 'output']);
	const options = record(optionsValue, 'managed SDR frame options', ['limits']);
	const limitsRecord = record(field(options, 'limits', 'managed SDR frame options'), 'managed SDR frame limits',
		['maximumSidePixels', 'maximumPixels', 'maximumBytes']);
	const limits = Object.freeze(Object.fromEntries(Object.keys(limitsRecord)
		.map(key => [key, field(limitsRecord, key, 'managed SDR frame limits')])));
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal', 'managed SDR frame request') : undefined;
	if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('Managed SDR requires a native cancellation signal.');
	const check = () => { if (signal) Reflect.apply(ABORT_CHECK, signal, []); };
	check();
	if (typeof consume !== 'function') throw new TypeError('Managed SDR requires a scoped frame consumer.');
	const decoding = field(input, 'decoding', 'managed SDR frame request');
	if (decoding !== 'file' && decoding !== 'canvas-readback' && decoding !== 'linear') {
		throw new RangeError('Managed SDR frame decoding is unsupported.');
	}
	const output = field(input, 'output', 'managed SDR frame request');
	if (output !== 'srgb' && output !== 'rec709' && output !== 'linear-rec709-d65') {
		throw new RangeError('Managed SDR frame output space is unsupported.');
	}
	const interpretation = Object.hasOwn(input, 'interpretation')
		? normalizeVideoSourceColorInterpretationV1(field(input, 'interpretation', 'managed SDR frame request')) : undefined;
	const grades = readClosedDomainArray(field(input, 'grades', 'managed SDR frame request'), 'managed SDR frame grades', 0, 64)
		.map(value => {
			const grade = normalizeVideoColorGradeV1(value);
			if (grade.lut !== null) throw new RangeError('This managed SDR frame route requires numeric grades without LUTs.');
			return grade;
		});
	// A legal null-LUT grade is <=444 JSON bytes; all 64 grades are <=28,481.
	if (JSON.stringify(grades).length > MAXIMUM_SETTINGS_BYTES) throw new RangeError('Managed SDR grade settings exceed their byte budget.');
	const prepared = prepareManagedSdrGradeStackV1({ decoding, interpretation, grades });
	const rawFrame = record(field(input, 'frame', 'managed SDR frame request'), 'managed SDR source frame', ['descriptor', 'pixels']);
	const profile = decoding === 'linear'
		? { sampleFormat: 'unorm8', primaries: 'bt709', transfer: 'linear' }
		: decoding === 'canvas-readback'
			? { sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }
			: { sampleFormat: 'unorm8', primaries: interpretation?.primaries, transfer: prepared.transfer };
	const plan = admitPixelFrameV1(field(rawFrame, 'descriptor', 'managed SDR source frame'), { profiles: [profile], limits });
	const source = readPixelFrameV1({ descriptor: plan.descriptor,
		pixels: field(rawFrame, 'pixels', 'managed SDR source frame') }, limits);
	if (source.descriptor.sampleFormat !== 'unorm8') throw new RangeError('Managed SDR frame samples must be UNORM8.');
	const borrowed = new Uint8Array(source.pixels.buffer, source.pixels.byteOffset, source.pixels.byteLength);
	const descriptor = Object.freeze({ ...source.descriptor, sampleFormat: 'unorm8' as const,
		primaries: output === 'srgb' ? 'srgb' as const : 'bt709' as const,
		transfer: output === 'srgb' ? 'srgb' as const : output === 'rec709' ? 'bt709' as const : 'linear' as const });
	const pixels = new Uint8Array(plan.byteLength);
	const buffer = pixels.buffer;
	try {
		for (let start = 0; start < plan.byteLength; start += CHUNK_BYTES) {
			check();
			const length = Math.min(CHUNK_BYTES, plan.byteLength - start);
			const chunk = applyPreparedManagedSdrByteFrameV1(prepared,
				{ width: length / 4, height: 1, pixels: new Uint8Array(borrowed.buffer, borrowed.byteOffset + start, length) }, output);
			try { pixels.set(chunk, start); } finally { wipe(chunk.buffer); }
			if (start + length < plan.byteLength) {
				await new Promise<void>(resolve => { setTimeout(resolve, 0); });
				check();
			}
		}
		check();
		const result = await consume(Object.freeze({ descriptor, pixels }));
		check();
		return result;
	} finally { wipe(buffer); }
}

function wipe(buffer: ArrayBuffer): void {
	if (BUFFER_SIZE && Number(Reflect.apply(BUFFER_SIZE, buffer, [])) > 0) new Uint8Array(buffer).fill(0);
}
