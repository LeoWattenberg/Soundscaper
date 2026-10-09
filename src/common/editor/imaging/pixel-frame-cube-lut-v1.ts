/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { applyPreparedManagedSdrByteFrameV1 } from '../video-color-byte-encoding.ts';
import { defaultVideoSourceColorInterpretationV1, normalizeVideoColorGradeV1,
	prepareManagedSdrGradeStackV1 } from '../video-color-management-v27.ts';
import { withCubeLutResourceV1 } from './cube-lut-resource-v1.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { readPixelFrameV1, type PixelFrameDescriptorV1, type PixelFrameLimitsV1 } from './pixel-frame-contract-v1.ts';

export interface CubeLutPixelFrameV1 {
	readonly descriptor: Readonly<PixelFrameDescriptorV1 & { sampleFormat: 'unorm8' }>;
	readonly pixels: Uint8Array<ArrayBuffer>;
}

export interface CubeLutPixelFrameRequestV1 {
	readonly frame: unknown;
	readonly grade: unknown;
	readonly bytes: unknown;
	readonly signal?: AbortSignal;
}

const CHUNK_BYTES = 256 * 1024;
const NativeBytes = Uint8Array;
const TYPED = Object.getPrototypeOf(NativeBytes.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!;
const OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'byteLength')!.get!;
const BUFFER_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const SET = NativeBytes.prototype.set;
const FILL = NativeBytes.prototype.fill;
const ABORT_CHECK = AbortSignal.prototype.throwIfAborted;
const INTERPRETATION = defaultVideoSourceColorInterpretationV1('still', 'cube-lut-frame');

/**
 * An encoded-sRGB UNORM8 frame is decoded once to V27 linear Rec709, graded,
 * sampled through its verified .cube, then encoded once back to sRGB. Straight
 * alpha and hidden RGB follow V27 unchanged. Source pixels remain borrowed
 * under their no-mutation contract. One bounded output plus <=256KiB kernel
 * scratch is owned; the resource additionally owns <=16MiB raw LUT bytes and
 * the existing parser's immutable numeric/text scratch. Each chunk yields a
 * task, and the output/resource remain borrowed until the consumer settles.
 */
export async function withCubeLutPixelFrameV1<T>(
	requestValue: unknown,
	consume: (frame: Readonly<CubeLutPixelFrameV1>) => T | Promise<T>,
	optionsValue: Readonly<{ limits: PixelFrameLimitsV1 }>,
): Promise<T> {
	const input = record(requestValue, 'cube LUT frame request', ['frame', 'grade', 'bytes', 'signal'], ['frame', 'grade', 'bytes']);
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal', 'cube LUT frame request') : undefined;
	const check = () => { if (signal !== undefined) Reflect.apply(ABORT_CHECK, signal, []); };
	check();
	if (typeof consume !== 'function') throw new TypeError('Cube LUT frame requires a scoped consumer.');
	const options = record(optionsValue, 'cube LUT frame options', ['limits']);
	const rawLimits = record(field(options, 'limits', 'cube LUT frame options'), 'cube LUT frame limits',
		['maximumSidePixels', 'maximumPixels', 'maximumBytes']);
	const limits = Object.freeze(Object.fromEntries(Object.keys(rawLimits)
		.map(key => [key, field(rawLimits, key, 'cube LUT frame limits')])));
	const grade = normalizeVideoColorGradeV1(field(input, 'grade', 'cube LUT frame request'));
	if (grade.lut === null) throw new RangeError('Cube LUT frame requires a grade with a LUT reference.');
	const rawFrame = record(field(input, 'frame', 'cube LUT frame request'), 'cube LUT source frame', ['descriptor', 'pixels']);
	const plan = admitPixelFrameV1(field(rawFrame, 'descriptor', 'cube LUT source frame'), { limits });
	const source = readPixelFrameV1({ descriptor: plan.descriptor,
		pixels: field(rawFrame, 'pixels', 'cube LUT source frame') }, limits);
	if (source.descriptor.sampleFormat !== 'unorm8') throw new RangeError('Cube LUT frame requires encoded sRGB UNORM8 samples.');
	const sourceBuffer = Reflect.apply(BUFFER, source.pixels, []) as ArrayBuffer;
	const sourceOffset = Number(Reflect.apply(OFFSET, source.pixels, []));
	const sourceBackingLength = Number(Reflect.apply(BUFFER_SIZE, sourceBuffer, []));
	const checkSource = () => {
		check();
		if (Reflect.apply(BUFFER_SIZE, sourceBuffer, []) !== sourceBackingLength
			|| Reflect.apply(BUFFER, source.pixels, []) !== sourceBuffer
			|| Reflect.apply(LENGTH, source.pixels, []) !== plan.byteLength
			|| Reflect.apply(OFFSET, source.pixels, []) !== sourceOffset) {
			throw new RangeError('Cube LUT frame source was detached or changed before completion.');
		}
	};
	checkSource();
	const result = await withCubeLutResourceV1({ reference: grade.lut,
		bytes: field(input, 'bytes', 'cube LUT frame request'), signal }, async ({ body }) => {
		const prepared = prepareManagedSdrGradeStackV1({ decoding: 'canvas-readback',
			interpretation: INTERPRETATION, grades: [grade], luts: [body] });
		checkSource();
		const pixels = new Uint8Array(plan.byteLength), buffer = pixels.buffer;
		try {
			for (let start = 0; start < plan.byteLength; start += CHUNK_BYTES) {
				checkSource();
				const length = Math.min(CHUNK_BYTES, plan.byteLength - start);
				// The legacy synchronous kernel receives no caller signal: intrinsic
				// cancellation is checked here around each bounded native chunk.
				const chunk = applyPreparedManagedSdrByteFrameV1(prepared, { width: length / 4, height: 1,
					pixels: new NativeBytes(sourceBuffer, sourceOffset + start, length) }, 'srgb');
				try { Reflect.apply(SET, pixels, [chunk, start]); } finally { wipe(chunk.buffer); }
				if (start + length < plan.byteLength) {
					await new Promise<void>(resolve => { setTimeout(resolve, 0); });
					checkSource();
				}
			}
			checkSource();
			const descriptor = Object.freeze({ ...plan.descriptor, sampleFormat: 'unorm8' as const });
			const result = await consume(Object.freeze({ descriptor, pixels }));
			checkSource();
			return result;
		} finally { wipe(buffer); }
	});
	checkSource();
	return result;
}

function wipe(buffer: ArrayBuffer): void {
	if (Number(Reflect.apply(BUFFER_SIZE, buffer, [])) > 0) Reflect.apply(FILL, new NativeBytes(buffer), [0]);
}
