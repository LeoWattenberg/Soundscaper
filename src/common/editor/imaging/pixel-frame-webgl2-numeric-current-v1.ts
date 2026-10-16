/* SPDX-License-Identifier: AGPL-3.0-only */

import { RepairTaskBudgetV1 } from './pixel-frame-repair-lifetime-v1.ts';
import { readPixelFrameWebGl2PassCurrentV1, writePixelFrameWebGl2PassChannelsCurrentV1, pixelFrameWebGl2PassSupportedCurrentV1,
	type PreparedPixelFrameWebGl2PassCurrentV1 } from './pixel-frame-webgl2-pass-current-v1.ts';
import type { PixelFrameWebGl2LutResourcesCurrentV1 } from './pixel-frame-webgl2-lut-current-v1.ts';

const MINIMUM_NORMAL = 2 ** -126;
const EXACT_SMALL = 2 ** -60;
export const PIXEL_FRAME_WEBGL2_COLOR_MAXIMUM_ULPS_CURRENT_V1 = 8;
type Pass = PreparedPixelFrameWebGl2PassCurrentV1;

function capture(passes: readonly unknown[]): readonly Pass[] {
	if (!Array.isArray(passes) || passes.length > 257) throw new RangeError('Native GPU requires at most257 owning passes.');
	return passes.map(readPixelFrameWebGl2PassCurrentV1);
}
function nonlinear(pass: Pass): boolean {
	if (pass.kind === 8 || 'sourceDescriptor' in pass) return false;
	const p = pass.params0, q = pass.params1;
	return pass.kind === 2 && (p[1] !== 1 || p[2] !== 0 || p[3] !== 0 || q[0] !== 0 || q[1] !== 0);
}
function globalOutputEligible(current: number, value: number, pass: Pass, arithmetic: boolean): boolean {
	if (pass.kind === 8 || 'sourceDescriptor' in pass) throw new TypeError('LUTs, geometry and optics require their normative native oracle.');
	const next = Math.fround(value);
	if (!Number.isFinite(next)) throw new RangeError('Native GPU recipe exceeds finite Float32 range.');
	if (nonlinear(pass)) {
		const p = pass.params0, q = pass.params1;
		const scale = Math.abs(current * p[0] * p[1]) + Math.abs(.18 * (1 - p[1]))
			+ Math.abs(p[2]) + Math.abs(p[3]) + Math.abs(q[0]) + Math.abs(q[1]);
		if (scale > 0 && Math.abs(next) <= 32 * 2 ** -23 * scale) return false;
	}
	return arithmetic || next === 0 || Math.abs(next) >= MINIMUM_NORMAL;
}

/** Preserve the original global guards. Extended families additionally use the
 * streamed normative result check after real GPU execution, before delivery.
 * No native source or expected-result plane is allocated by either phase. */
export async function pixelFrameWebGl2NumericEligibleCurrentV1(pixels: Float32Array<ArrayBuffer>, values: readonly unknown[],
	copy: boolean, arithmetic: boolean, check: () => void, resources?: Readonly<PixelFrameWebGl2LutResourcesCurrentV1>): Promise<boolean> {
	check(); const passes = capture(values), budget = new RepairTaskBudgetV1(check);
	if (passes.some(pass => !pixelFrameWebGl2PassSupportedCurrentV1(pass, resources))) return false;
	const minimum = [Infinity, Infinity, Infinity];
	for (let offset = 0; offset < pixels.length; offset++) {
		if (budget.visit()) await budget.yield();
		const magnitude = Math.abs(pixels[offset]!); if (!magnitude) continue;
		if (magnitude < MINIMUM_NORMAL && (!copy || (offset % 4 !== 3 && passes.length && !arithmetic))) return false;
		if (offset % 4 !== 3) minimum[offset % 4] = Math.min(minimum[offset % 4]!, magnitude);
	}
	if (passes.some(pass => pass.kind > 2)) return true;
	for (const pass of passes) {
		if (pass.kind === 8 || 'sourceDescriptor' in pass) return true;
		const p = pass.params0, q = pass.params1;
		if (nonlinear(pass) && (minimum.some(value => value < EXACT_SMALL)
			|| [...p, ...q].some(value => value !== 0 && Math.abs(value) < EXACT_SMALL))) return false;
		for (let channel = 0; channel < 3; channel++) {
			const gain = pass.kind === 1 ? p[channel]! : p[0] * p[1];
			minimum[channel] = Math.fround(minimum[channel]! * gain);
			if (!arithmetic && minimum[channel]! > 0 && minimum[channel]! < MINIMUM_NORMAL) return false;
		}
	}
	const target = { red: 0, green: 0, blue: 0 };
	try {
		if (passes.some(nonlinear)) for (let offset = 0; offset < pixels.length; offset += 4) {
			let red = pixels[offset]!, green = pixels[offset + 1]!, blue = pixels[offset + 2]!;
			for (const pass of passes) {
				if (budget.visit()) await budget.yield();
				writePixelFrameWebGl2PassChannelsCurrentV1(pass, red, green, blue, target, resources);
				if (!globalOutputEligible(red, target.red, pass, arithmetic) || !globalOutputEligible(green, target.green, pass, arithmetic)
					|| !globalOutputEligible(blue, target.blue, pass, arithmetic)) return false;
				red = Math.fround(target.red); green = Math.fround(target.green); blue = Math.fround(target.blue);
			}
		}
		check(); return true;
	} finally { target.red = 0; target.green = 0; target.blue = 0; }
}

/** A finite Float32 value has an exact integer rank. Computing it from its
 * binary exponent avoids allocating another pixel-bearing scratch buffer. */
function ordered(value: number): number {
	const magnitude = Math.abs(value), exponent = Math.floor(Math.log2(magnitude));
	const rank = magnitude < MINIMUM_NORMAL ? magnitude / 2 ** -149
		: (exponent + 127) * 2 ** 23 + (magnitude / 2 ** exponent - 1) * 2 ** 23;
	return value < 0 ? 0x80000000 - rank : 0x80000000 + rank;
}

/** Shared final-component contract. A spatial reference may supply the mapped
 * ancestral Original component; absent provenance grants no unchanged guard. */
export function pixelFrameWebGl2ComponentEquivalentCurrentV1(expected: number, actual: number, original?: number): boolean {
	if (!Number.isFinite(expected)) throw new RangeError('Native GPU recipe exceeds finite Float32 range.');
	if (!Number.isFinite(actual)) return false;
	if (Object.is(expected, actual)) return true;
	if ((original !== undefined && Object.is(expected, original)) || expected === 0 || actual === 0 || Math.abs(expected) < EXACT_SMALL) return false;
	return Math.abs(ordered(expected) - ordered(actual)) <= PIXEL_FRAME_WEBGL2_COLOR_MAXIMUM_ULPS_CURRENT_V1;
}

/** The existing native CPU scalar is the numerical authority. Round once per
 * authored effect; keep exact alpha, zero, tiny and unchanged native samples.
 * Other finite normal results permit at most8 ULPs, never an absolute epsilon.
 * A refusal occurs before the consumer and retires GL before whole CPU fallback.
 * This correctness check currently also costs CPU work; it is not a speed claim. */
export async function validatePixelFrameWebGl2ColorReadbackCurrentV1(source: Float32Array<ArrayBuffer>, result: Float32Array<ArrayBuffer>,
	values: readonly unknown[], check: () => void, resources?: Readonly<PixelFrameWebGl2LutResourcesCurrentV1>): Promise<boolean> {
	check(); const passes = capture(values);
	if (passes.some(pass => 'sourceDescriptor' in pass)) throw new TypeError('Native GPU geometry and optics require a whole-plane normative reference.');
	if (!(source instanceof Float32Array) || !(result instanceof Float32Array) || !source.length
		|| source.length !== result.length || source.length % 4 !== 0) throw new RangeError('Native GPU comparison requires equal RGBA Float32 planes.');
	const target = { red: 0, green: 0, blue: 0 }, budget = new RepairTaskBudgetV1(check);
	const equivalent = pixelFrameWebGl2ComponentEquivalentCurrentV1;
	try {
		for (let at = 0; at < source.length; at += 4) {
			if (budget.visit()) await budget.yield();
			let red = source[at]!, green = source[at + 1]!, blue = source[at + 2]!;
			for (const pass of passes) {
				if (budget.visit()) await budget.yield();
				writePixelFrameWebGl2PassChannelsCurrentV1(pass, red, green, blue, target, resources);
				red = Math.fround(target.red); green = Math.fround(target.green); blue = Math.fround(target.blue);
				if (!Number.isFinite(red) || !Number.isFinite(green) || !Number.isFinite(blue)) throw new RangeError('Native GPU recipe exceeds finite Float32 range.');
			}
			if (!Object.is(source[at + 3], result[at + 3]) || !equivalent(red, result[at]!, source[at]!)
				|| !equivalent(green, result[at + 1]!, source[at + 1]!)
				|| !equivalent(blue, result[at + 2]!, source[at + 2]!)) return false;
		}
		check(); return true;
	} finally { target.red = 0; target.green = 0; target.blue = 0; }
}
