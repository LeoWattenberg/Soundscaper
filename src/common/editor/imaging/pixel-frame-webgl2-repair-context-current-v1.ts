/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainRecord as record, readClosedDomainField as field } from '../closed-domain-value.ts';
import { readPixelFrameV1 } from './pixel-frame-contract-v1.ts';
import { LINEAR_KERNEL_LIMITS_V1 } from './linear-kernel-descriptor-v1.ts';
import type { LinearWorkingPixelFrameV1 } from './image-develop-linear-frame-v1.ts';
import { LinearDevelopOwnerV1 } from './image-develop-linear-owner-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1, RepairTaskBudgetV1 } from './pixel-frame-repair-lifetime-v1.ts';
import { readPixelFrameWebGl2RepairCurrentV1, planPixelFrameWebGl2RepairWorkingCurrentV1 } from './pixel-frame-webgl2-repair-current-v1.ts';
import { PixelFrameWebGl2UnavailableCurrentV1 } from './pixel-frame-webgl2-context-current-v1.ts';
import { withMaskNativeCurrentV1 } from './pixel-frame-webgl2-mask-context-native-current-v1.ts';
import { executePixelFrameWebGl2RepairPrefixCurrentV1, type PixelFrameWebGl2RepairDrawsCurrentV1 } from './pixel-frame-webgl2-repair-prefix-current-v1.ts';
export type { PixelFrameWebGl2RepairDrawsCurrentV1 } from './pixel-frame-webgl2-repair-prefix-current-v1.ts';
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const BUFFER = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Float32Array.prototype), 'buffer')!.get!;
const MAXIMUM = 768 * 1024 * 1024;
const unavailable = (reason: string): never => { throw new PixelFrameWebGl2UnavailableCurrentV1(reason); };

/** The standalone diagnostic captures one private Float32 Original before its
 * first await. Main-host integration must execute the same texture-level prefix
 * on its existing capture/O/A/B rather than calling this reuploading frontdoor.
 * No CPU-computed donor, membership, delta, RHS or solution is ever uploaded. */
export async function withPixelFrameWebGl2RepairCurrentV1<Result>(gl: WebGL2RenderingContext, value: unknown,
	sourceValue: Readonly<LinearWorkingPixelFrameV1>, consume: (frame: Readonly<LinearWorkingPixelFrameV1>, draws: Readonly<PixelFrameWebGl2RepairDrawsCurrentV1>) => Result | Promise<Result>,
	signalValue?: AbortSignal, checkValue: () => void = () => {}): Promise<Result> {
	const signal = captureRepairSignalV1(signalValue); checkRepairSignalV1(signal);
	if (typeof consume !== 'function' || typeof checkValue !== 'function') throw new TypeError('Repair candidate needs scoped consumer/currentness callbacks.');
	const plan = readPixelFrameWebGl2RepairCurrentV1(value);
	if (!planPixelFrameWebGl2RepairWorkingCurrentV1(plan).eligible) throw new RangeError('GPU repair exceeds its fixed working profile.');
	const raw = record(sourceValue, 'GPU repair source', ['descriptor', 'pixels']);
	const frame = readPixelFrameV1({ descriptor: field(raw, 'descriptor', 'GPU repair source'), pixels: field(raw, 'pixels', 'GPU repair source') }, LINEAR_KERNEL_LIMITS_V1);
	if (frame.descriptor.width !== plan.descriptor.width || frame.descriptor.height !== plan.descriptor.height || frame.descriptor.primaries !== plan.descriptor.primaries
		|| frame.descriptor.sampleFormat !== 'float32' || frame.descriptor.transfer !== 'linear' || !(frame.pixels instanceof Float32Array)) throw new RangeError('GPU repair source differs from its private prefix.');
	const originalBacking = Reflect.apply(BUFFER, frame.pixels, []) as ArrayBuffer, physical = Number(Reflect.apply(SIZE, originalBacking, []));
	const peak = planPixelFrameWebGl2RepairWorkingCurrentV1(plan, physical);
	if (!peak.eligible) throw new RangeError('GPU repair physical backing exceeds its fixed working profile.');
	const check = () => { checkRepairSignalV1(signal); Reflect.apply(checkValue, undefined, []);
		if (Reflect.apply(SIZE, originalBacking, []) !== physical) throw new TypeError('GPU repair source detached before retirement.'); };
	check(); const owner = new LinearDevelopOwnerV1(peak.peakBytes - 2 * plan.frameBytes, MAXIMUM);
	return owner.run(async () => {
		const source = owner.floats(plan.frameBytes / 4); Float32Array.prototype.set.call(source, frame.pixels);
		const budget = new RepairTaskBudgetV1(check);
		for (let at = 0; at < source.length; at++) { const n = source[at]!;
			if (!Number.isFinite(n) || at % 4 === 3 && (n < 0 || n > 1)) throw new RangeError('GPU repair needs finite native RGB/unit alpha.');
			if (budget.visit()) await budget.yield();
		}
		check(); if (!plan.supported) unavailable('numeric-range');
		if (!gl.getExtension('EXT_color_buffer_float') || Number(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)) < 4) unavailable('repair-capability-unavailable');
		const maximum = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)), viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
		if (maximum < plan.descriptor.width || maximum < plan.descriptor.height || viewport[0]! < plan.descriptor.width || viewport[1]! < plan.descriptor.height) unavailable('texture-capacity');
		return withMaskNativeCurrentV1(gl, check, unavailable, async native => {
			const original = native.texture('float', plan.descriptor.width, plan.descriptor.height, source);
			const banks = [native.texture('float', plan.descriptor.width, plan.descriptor.height), native.texture('float', plan.descriptor.width, plan.descriptor.height)] as const;
			const image = (bank: typeof original) => Object.freeze({ texture: bank.texture, width: bank.width, height: bank.height });
			const prefix = await executePixelFrameWebGl2RepairPrefixCurrentV1(gl, plan, [image(original), image(banks[0]), image(banks[1])], check, unavailable, signal);
			const current = [original, ...banks][prefix.index]!, draws = prefix.draws;
			check(); await native.wait(); native.attach(current);
			const readback = owner.floats(plan.frameBytes / 4);
			gl.readPixels(0, 0, plan.descriptor.width, plan.descriptor.height, gl.RGBA, gl.FLOAT, readback); native.check();
			for (let at = 0; at < readback.length; at++) { const n = readback[at]!;
				if (!Number.isFinite(n) || at % 4 === 3 && (n < 0 || n > 1)) unavailable('numeric-range');
				if (budget.visit()) await budget.yield();
			}
			const result = await consume(Object.freeze({ descriptor: plan.descriptor, pixels: readback }), Object.freeze({ ...draws }));
			check(); native.check(); return result;
		});
	});
}
