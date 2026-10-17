/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { planPixelFrameV1, readPixelFrameV1, type PixelFramePlanV1, type PixelFrameV1 } from './pixel-frame-contract-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1, withRepairPixelFrameLifetimeV1 } from './pixel-frame-repair-lifetime-v1.ts';
import { fitPixelSizeV1 } from './pixel-frame-resize-v1.ts';

export interface NativeDevelopProxySourcePlanCurrentV1 {
	readonly sourcePlan: Readonly<PixelFramePlanV1>;
	readonly proxyPlan: Readonly<PixelFramePlanV1>;
}

export const NATIVE_DEVELOP_PROXY_WORKING_BYTES_CURRENT_V1 = 768 * 1024 * 1024;
const SOURCE_LIMITS = Object.freeze({ maximumSidePixels: 8192, maximumPixels: 16_777_216, maximumBytes: 268_435_456 });
const PROXY_LIMITS = Object.freeze({ maximumSidePixels: 2048, maximumPixels: 4_194_304, maximumBytes: 67_108_864 });
const PROFILES = Object.freeze([
	{ sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' },
	{ sampleFormat: 'unorm16', primaries: 'srgb', transfer: 'linear' },
	{ sampleFormat: 'unorm16', primaries: 'bt709', transfer: 'linear' },
	{ sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' },
	{ sampleFormat: 'float32', primaries: 'bt709', transfer: 'linear' },
] as const);
const TYPED = Object.getPrototypeOf(Uint8Array.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const captured = new WeakMap<NativeDevelopProxySourcePlanCurrentV1, Readonly<{ raw: object; signal: AbortSignal | undefined }>>();

/** Admit only metadata: downstream recipe/resource preflight still precedes pixels.
 * Spatial evaluation uses this fitted native lattice with the saved recipe intact. */
export function prepareNativeDevelopProxySourceCurrentV1(
	frameValue: unknown,
	signalValue?: AbortSignal,
): Readonly<NativeDevelopProxySourcePlanCurrentV1> {
	const signal = captureRepairSignalV1(signalValue);
	try {
		if (typeof frameValue !== 'object' || frameValue === null) throw new TypeError('Native Develop proxy requires a frame.');
		const sourcePlan = admitPixelFrameV1(field(frameValue as Readonly<Record<string, unknown>>, 'descriptor', 'native Develop proxy frame'),
			{ profiles: PROFILES, limits: SOURCE_LIMITS });
		const size = fitPixelSizeV1(sourcePlan.descriptor.width, sourcePlan.descriptor.height, 2048, 2048);
		const proxyPlan = planPixelFrameV1({ ...sourcePlan.descriptor, ...size }, PROXY_LIMITS);
		checkRepairSignalV1(signal);
		const plan = Object.freeze({ sourcePlan, proxyPlan });
		captured.set(plan, Object.freeze({ raw: frameValue, signal }));
		return plan;
	} catch (error) { checkRepairSignalV1(signal); throw error; }
}

/** Capture only selected native samples before yielding. The downstream peak
 * already includes this proxy input; the untouched full backing is additional.
 * Delivery joins its consumer before private physical wipe retirement. */
export async function withNativeDevelopProxySourceCurrentV1<Result>(
	plan: Readonly<NativeDevelopProxySourcePlanCurrentV1>,
	downstreamPeakBytes: number,
	consume: (frame: PixelFrameV1) => Result | Promise<Result>,
): Promise<Result> {
	return withNativeProxySource(plan, downstreamPeakBytes, downstreamPeakBytes, consume, true);
}

/** Prefer a complete execution phase only when it fits beside the actual
 * Original backing. Both choices share one source admission and proxy copy. */
export async function withPreferredNativeDevelopProxySourceCurrentV1<Result>(
	plan: Readonly<NativeDevelopProxySourcePlanCurrentV1>,
	preferredPeakBytes: number,
	fallbackPeakBytes: number,
	consume: (frame: PixelFrameV1, preferred: boolean) => Result | Promise<Result>,
): Promise<Result> {
	return withNativeProxySource(plan, preferredPeakBytes, fallbackPeakBytes, consume, false);
}

async function withNativeProxySource<Result>(plan: Readonly<NativeDevelopProxySourcePlanCurrentV1>, preferredPeakBytes: number,
	fallbackPeakBytes: number, consume: (frame: PixelFrameV1, preferred: boolean) => Result | Promise<Result>, strictPeak: boolean): Promise<Result> {
	const input = captured.get(plan);
	if (!input) throw new TypeError('Native Develop proxy requires its original admitted plan.');
	const check = () => { checkRepairSignalV1(input.signal); };
	const admitted = (() => { try {
		check();
		if (typeof consume !== 'function') throw new TypeError('Native Develop proxy requires a consumer.');
		if ([preferredPeakBytes, fallbackPeakBytes].some(peak => !Number.isSafeInteger(peak) || peak < plan.proxyPlan.byteLength
			|| strictPeak && peak > NATIVE_DEVELOP_PROXY_WORKING_BYTES_CURRENT_V1)) {
			throw new RangeError('Native Develop proxy requires a bounded downstream peak including its input.');
		}
		const choose = (backingBytes: number, physical: boolean) => {
			if (backingBytes + preferredPeakBytes <= NATIVE_DEVELOP_PROXY_WORKING_BYTES_CURRENT_V1) return true;
			if (backingBytes + fallbackPeakBytes <= NATIVE_DEVELOP_PROXY_WORKING_BYTES_CURRENT_V1) return false;
			throw new RangeError(physical ? 'Native Develop proxy exceeds its aggregate physical working byte bound.'
				: 'Native Develop proxy exceeds its declared aggregate working byte bound.');
		};
		choose(plan.sourcePlan.byteLength, false);
		const raw = record(input.raw, 'native Develop proxy frame', ['descriptor', 'pixels']);
		const pixels = field(raw, 'pixels', 'native Develop proxy frame');
		const source = readPixelFrameV1({ descriptor: plan.sourcePlan.descriptor, pixels }, SOURCE_LIMITS);
		const backing = Reflect.apply(BUFFER, source.pixels, []) as ArrayBuffer;
		const backingBytes = Number(Reflect.apply(SIZE, backing, []));
		const preferred = choose(backingBytes, true);
		check(); return { frame: source, preferred };
	} catch (error) { check(); throw error; } })();
	return withRepairPixelFrameLifetimeV1(async owner => {
		const { frame, preferred } = admitted;
		const bytes = owner.bytes(plan.proxyPlan.byteLength);
		const pixels = plan.proxyPlan.descriptor.sampleFormat === 'float32' ? new Float32Array(bytes.buffer)
			: plan.proxyPlan.descriptor.sampleFormat === 'unorm16' ? new Uint16Array(bytes.buffer) : bytes;
		const { width, height } = plan.proxyPlan.descriptor, sourceWidth = frame.descriptor.width, sourceHeight = frame.descriptor.height;
		for (let y = 0; y < height; y++) {
			const sourceRow = Math.floor(y * sourceHeight / height) * sourceWidth;
			for (let x = 0; x < width; x++) {
				const from = (sourceRow + Math.floor(x * sourceWidth / width)) * 4, to = (y * width + x) * 4;
				for (let channel = 0; channel < 4; channel++) pixels[to + channel] = frame.pixels[from + channel]!;
			}
		}
		const proxy = readPixelFrameV1({ descriptor: plan.proxyPlan.descriptor, pixels }, PROXY_LIMITS);
		check(); await new Promise<void>(resolve => { setTimeout(resolve, 0); }); check();
		const result = await consume(proxy, preferred); check(); return result;
	});
}
