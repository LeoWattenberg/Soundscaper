/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { normalizeImageDevelopStateCurrentV1 } from './image-develop-state-current-v1.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { PIXEL_FRAME_HARD_LIMITS_V1, planPixelFrameV1, readPixelFrameV1, type PixelFrameDescriptorV1, type PixelFrameLimitsV1 } from './pixel-frame-contract-v1.ts';
import type { ImageDevelopFrameProfile } from './image-develop-frame-core.ts';
import { prepareLinearGlobalEffectsV1, linearGlobalDevelopChannelV1 } from './pixel-frame-linear-global-v1.ts';

export interface LinearWorkingPixelFrameV1 {
	readonly descriptor: Readonly<PixelFrameDescriptorV1 & { sampleFormat: 'float32'; transfer: 'linear'; primaries: 'srgb' | 'bt709' }>;
	readonly pixels: Float32Array<ArrayBuffer>;
}

const NativeBytes = Uint8Array, NativeFloats = Float32Array;
const TYPED = Object.getPrototypeOf(NativeBytes.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!, OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const SET = NativeBytes.prototype.set, FILL = NativeBytes.prototype.fill, ROUND = Math.fround;
const CHECK = AbortSignal.prototype.throwIfAborted;
const CHUNK_SAMPLES = 65_536;
const PROFILES = Object.freeze([
	Object.freeze({ sampleFormat: 'unorm16', primaries: 'srgb', transfer: 'linear' }),
	Object.freeze({ sampleFormat: 'unorm16', primaries: 'bt709', transfer: 'linear' }),
	Object.freeze({ sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' }),
	Object.freeze({ sampleFormat: 'float32', primaries: 'bt709', transfer: 'linear' }),
]);

/** Source-native linear CPU foundation. Existing byte routes and process
 * schemas keep their exact semantics. This explicit route admits only the
 * implemented separable globals; it never converts an unsupported stack to
 * byte pixels or infers a deep Original/Frame-pack producer.
 *
 * One owned Float32 plane is the complete captured source, in-place working
 * state and borrowed output. Its allocation plus the declared borrowed source
 * cannot exceed 512 MiB. Capture finishes synchronously before the first task.
 * Each operation rounds once into actual Float32 storage, with no RGB clipping;
 * alpha is copied once and never altered by an adjustment. */
export async function withImageDevelopLinearFrameV1<Result>(value: unknown,
	consume: (frame: Readonly<LinearWorkingPixelFrameV1>) => Result | Promise<Result>, profile: ImageDevelopFrameProfile): Promise<Result> {
	// Pin a native caller signal before whole-record reflection can run traps.
	const signalField = typeof value === 'object' && value !== null ? Object.getOwnPropertyDescriptor(value, 'signal') : undefined;
	if (signalField && !Object.hasOwn(signalField, 'value')) throw new TypeError('Linear Develop signal must be an own data property.');
	const signal = captureSignal(signalField?.value);
	const check = () => { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }; check();
	const prepared = (() => {
		try {
			if (typeof consume !== 'function') throw new TypeError('Linear Develop requires a scoped consumer.');
			const input = record(value, 'linear Develop request', ['frame', 'develop', 'signal'], ['frame', 'develop']);
			const develop = normalizeImageDevelopStateCurrentV1(field(input, 'develop', 'linear Develop request'));
			const geometry = develop.geometry;
			if (geometry.crop !== null || geometry.rotationDegrees !== 0 || geometry.flipHorizontal || geometry.flipVertical) throw new RangeError('Linear Develop geometry is not admitted by this route.');
			if (develop.masks.length || develop.maskBindings.length) throw new RangeError('Linear Develop masks are not admitted by this route.');
			if (develop.processVersion === 3 && develop.repairs.spots.length) throw new RangeError('Linear Develop repairs are not admitted by this route.');
			const effects = prepareLinearGlobalEffectsV1(develop.effects);
			const limits = record(profile, 'linear Develop profile', ['source', 'render']);
			const sourceLimits = captureLimits(field(limits, 'source', 'linear Develop profile')), renderLimits = captureLimits(field(limits, 'render', 'linear Develop profile'));
			const raw = field(input, 'frame', 'linear Develop request');
			if (typeof raw !== 'object' || raw === null) throw new TypeError('Linear Develop source must be an own frame.');
			const sourcePlan = admitPixelFrameV1(field(raw as Readonly<Record<string, unknown>>, 'descriptor', 'linear Develop source'), { profiles: PROFILES, limits: sourceLimits });
			const descriptor = sourcePlan.descriptor;
			if (descriptor.primaries !== 'srgb' && descriptor.primaries !== 'bt709') throw new RangeError('Linear Develop primaries are not admitted.');
			const outputDescriptor: LinearWorkingPixelFrameV1['descriptor'] = Object.freeze({ ...descriptor, sampleFormat: 'float32', primaries: descriptor.primaries, transfer: 'linear' });
			const outputPlan = planPixelFrameV1(outputDescriptor, renderLimits);
			if (BigInt(sourcePlan.byteLength) + BigInt(outputPlan.byteLength) > 512n * 1024n * 1024n) throw new RangeError('Linear Develop exceeds its 512 MiB working byte budget.');
			check();
			// Full closed frame/buffer admission follows the complete scalar plan.
			const sourceRecord = record(raw, 'linear Develop source', ['descriptor', 'pixels']);
			const source = readPixelFrameV1({ descriptor, pixels: field(sourceRecord, 'pixels', 'linear Develop source') }, sourceLimits);
			if (!(source.pixels instanceof Uint16Array || source.pixels instanceof NativeFloats)) throw new TypeError('Linear Develop requires native word or float samples.');
			check(); return { source, sourcePlan, outputPlan, outputDescriptor, effects };
		} catch (error) { check(); throw error; }
	})();
	const pixels = new NativeFloats(prepared.outputPlan.sampleCount), backing = Reflect.apply(BUFFER, pixels, []) as ArrayBuffer;
	const allocationLength = Number(Reflect.apply(SIZE, backing, []));
	let outcome: { value: Result } | { error: unknown };
	try {
		const source = prepared.source.pixels;
		if (source instanceof NativeFloats) {
			const inputBacking = Reflect.apply(BUFFER, source, []) as ArrayBuffer, offset = Number(Reflect.apply(OFFSET, source, []));
			Reflect.apply(SET, new NativeBytes(backing), [new NativeBytes(inputBacking, offset, prepared.sourcePlan.byteLength)]);
		} else {
			for (let index = 0; index < pixels.length; index++) pixels[index] = source[index]! / 65_535;
		}
		check();
		for (const effect of prepared.effects) {
			for (let start = 0; start < pixels.length; start += CHUNK_SAMPLES) {
				check(); const end = Math.min(pixels.length, start + CHUNK_SAMPLES);
				for (let offset = start; offset < end; offset += 4) for (const channel of [0, 1, 2] as const) {
					const value = ROUND(linearGlobalDevelopChannelV1(effect, pixels[offset + channel]!, channel));
					if (!Number.isFinite(value)) throw new RangeError('Linear Develop result exceeds the finite Float32 range.');
					pixels[offset + channel] = value;
				}
				if (end < pixels.length) { await new Promise<void>(resolve => { setTimeout(resolve, 0); }); check(); }
			}
		}
		check(); const result = await consume(Object.freeze({ descriptor: prepared.outputDescriptor, pixels })); check(); outcome = { value: result };
	} catch (error) { outcome = { error }; }
	const failures: unknown[] = 'error' in outcome ? [outcome.error] : [];
	try {
		if (Number(Reflect.apply(SIZE, backing, [])) !== allocationLength) throw new TypeError('Linear Develop output was detached or changed before physical retirement.');
		Reflect.apply(FILL, new NativeBytes(backing), [0]);
	} catch (error) { if (!failures.some(primary => Object.is(primary, error))) failures.push(error); }
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) throw new AggregateError(failures, 'Linear Develop operation and physical retirement failed.', { cause: failures[0] });
	if ('value' in outcome) return outcome.value;
	throw new Error('Linear Develop has no operation outcome.');
}

function captureSignal(value: unknown): AbortSignal | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== 'object' || value === null) throw new TypeError('Linear Develop requires a native cancellation signal.');
	Reflect.apply(CHECK, value, []);
	if (Object.getPrototypeOf(value) !== AbortSignal.prototype || ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener'].some(key => Object.hasOwn(value, key))) throw new TypeError('Linear Develop cancellation must retain native behavior.');
	return value as AbortSignal;
}
function captureLimits(value: unknown): Readonly<PixelFrameLimitsV1> {
	const keys = ['maximumSidePixels', 'maximumPixels', 'maximumBytes'] as const, input = record(value, 'linear Develop limits', keys);
	const limits = { ...PIXEL_FRAME_HARD_LIMITS_V1 };
	for (const key of keys) { const candidate = field(input, key, 'linear Develop limits');
		if (typeof candidate !== 'number' || !Number.isSafeInteger(candidate) || candidate < 1 || candidate > PIXEL_FRAME_HARD_LIMITS_V1[key]) throw new RangeError('Linear Develop limit exceeds the pixel interchange bounds.');
		limits[key] = candidate;
	}
	return Object.freeze(limits);
}
