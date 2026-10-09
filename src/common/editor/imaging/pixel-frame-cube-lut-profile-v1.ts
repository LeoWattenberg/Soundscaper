/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { prepareCubeLutProfileResourcePlanV1, cubeLutProfileResourceRequirementV1 } from '../video-cube-lut-profile-v1.ts';
import { normalizeVideoColorGradeV1 } from '../video-color-management-v27.ts';
import type { VideoCubeLutReferenceV1 } from '../video-color-cube-lut-v27.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { readPixelFrameV1, type PixelFrameLimitsV1, type PixelFrameV1 } from './pixel-frame-contract-v1.ts';
import { withCubeLutPixelFrameV1 } from './pixel-frame-cube-lut-v1.ts';
import type { CubeLutSourcePortV1 } from './cube-lut-source-port-v1.ts';

export type CubeLutProfilePixelFrameV1 = Extract<PixelFrameV1, { readonly descriptor: { readonly sampleFormat: 'unorm8' } }>;
const CHECK_ABORT = AbortSignal.prototype.throwIfAborted;
const TYPED = Object.getPrototypeOf(Uint8Array.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!;
const LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'byteLength')!.get!;
const OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const BUFFER_LENGTH = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;

/** One explicit V27 resource stage. Source pixels are borrowed under the
 * caller's no-mutation contract; Frame/Photo pipeline owners snapshot before
 * resource awaits. Disabled/null passes borrow those identical bytes without
 * decoding, allocating an output or inspecting the source capability. */
export async function withCubeLutProfilePixelFrameV1<Result>(value: unknown,
	consume: (frame: Readonly<CubeLutProfilePixelFrameV1>) => Result | Promise<Result>,
	optionsValue: Readonly<{ limits: PixelFrameLimitsV1; source?: CubeLutSourcePortV1 }>): Promise<Result> {
	const input = record(value, 'cube LUT profile frame request', ['frame', 'effect', 'signal'], ['frame', 'effect']);
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal', 'cube LUT profile frame request') : undefined;
	const check = () => { if (signal !== undefined) Reflect.apply(CHECK_ABORT, signal, []); };
	check();
	if (typeof consume !== 'function') throw new TypeError('Cube LUT profile frame requires a scoped consumer.');
	const plan = prepareCubeLutProfileResourcePlanV1(field(input, 'effect', 'cube LUT profile frame request'));
	const reference = cubeLutProfileResourceRequirementV1(plan);
	const options = record(optionsValue, 'cube LUT profile frame options', ['limits', 'source'], ['limits']);
	const sourcePort = reference === null ? null : captureSource(field(options, 'source', 'cube LUT profile resource source'));
	const rawFrame = record(field(input, 'frame', 'cube LUT profile frame request'), 'cube LUT profile source frame', ['descriptor', 'pixels']);
	const limits = field(options, 'limits', 'cube LUT profile frame options') as PixelFrameLimitsV1;
	const admission = admitPixelFrameV1(field(rawFrame, 'descriptor', 'cube LUT profile source frame'), { limits });
	const frame = readPixelFrameV1({ descriptor: admission.descriptor, pixels: field(rawFrame, 'pixels', 'cube LUT profile source frame') }, limits);
	if (frame.descriptor.sampleFormat !== 'unorm8') throw new RangeError('Cube LUT profile requires encoded sRGB UNORM8 pixels.');
	const sourceFrame = frame as CubeLutProfilePixelFrameV1;
	const backing = Reflect.apply(BUFFER, frame.pixels, []) as ArrayBuffer;
	const backingLength = Reflect.apply(BUFFER_LENGTH, backing, []) as number;
	const offset = Reflect.apply(OFFSET, frame.pixels, []) as number;
	const checkSource = () => {
		check();
		if (Reflect.apply(BUFFER_LENGTH, backing, []) !== backingLength || Reflect.apply(BUFFER, frame.pixels, []) !== backing
			|| Reflect.apply(LENGTH, frame.pixels, []) !== admission.byteLength || Reflect.apply(OFFSET, frame.pixels, []) !== offset) {
			throw new RangeError('Cube LUT profile source was detached or changed before completion.');
		}
	};
	checkSource();
	if (reference === null) { const result = await consume(sourceFrame); checkSource(); return result; }
	const grade = normalizeVideoColorGradeV1({ ...normalizeVideoColorGradeV1(), lut: reference });
	const work: { promise?: Promise<Result> } = {};
	let live = true, called = false, sourceFailure: Readonly<{ value: unknown }> | null = null;
	try {
		await sourcePort!(reference, bytes => {
			if (!live || called) throw new Error('Cube LUT source consumer is retired or already admitted.');
			called = true;
			work.promise = withCubeLutPixelFrameV1({ frame: sourceFrame, grade, bytes, signal }, consume, { limits });
			void work.promise.catch(() => undefined);
			return work.promise;
		}, signal === undefined ? {} : { signal: signal as AbortSignal });
	} catch (error) { sourceFailure = { value: error }; }
	finally { live = false; }
	if (!work.promise) {
		if (sourceFailure) throw sourceFailure.value;
		throw new Error('Cube LUT source returned without joining its consumer.');
	}
	let result: Result;
	try { result = await work.promise; }
	catch (error) {
		if (sourceFailure && !Object.is(sourceFailure.value, error)) throw new AggregateError([error, sourceFailure.value], 'Cube LUT stage and source cleanup both failed.', { cause: error });
		throw error;
	}
	if (sourceFailure) throw sourceFailure.value;
	checkSource();
	return result;
}

function captureSource(value: unknown): CubeLutSourcePortV1['withBytes'] {
	if (!value || typeof value !== 'object') throw new TypeError('An active cube LUT profile requires a resource source.');
	const method = Object.getOwnPropertyDescriptor(value, 'withBytes');
	if (!method || !Object.hasOwn(method, 'value') || typeof method.value !== 'function') throw new TypeError('Cube LUT source requires an own withBytes method.');
	const withBytes = method.value as CubeLutSourcePortV1['withBytes'];
	return <Result>(reference: Readonly<VideoCubeLutReferenceV1>,
		consume: (bytes: Uint8Array<ArrayBuffer>) => Result | Promise<Result>, options?: Readonly<{ signal?: AbortSignal }>) =>
		Reflect.apply(withBytes, value, [reference, consume, options]) as Promise<Result>;
}
