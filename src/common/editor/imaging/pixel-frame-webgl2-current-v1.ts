/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainArray as array, readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { readPixelFrameV1 } from './pixel-frame-contract-v1.ts';
import { captureLinearKernelDescriptorV1, LINEAR_KERNEL_LIMITS_V1 } from './linear-kernel-descriptor-v1.ts';
import type { LinearWorkingPixelFrameV1 } from './image-develop-linear-frame-v1.ts';
import { LinearDevelopOwnerV1 } from './image-develop-linear-owner-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from './pixel-frame-repair-lifetime-v1.ts';
import { PIXEL_FRAME_WEBGL2_COLOR_SCRATCH_BYTES_CURRENT_V1 } from './pixel-frame-webgl2-color-current-v1.ts';
import { readPixelFrameWebGl2PassCurrentV1 } from './pixel-frame-webgl2-pass-current-v1.ts';
import { planPixelFrameWebGl2LutsCurrentV1, withPixelFrameWebGl2LutsCurrentV1, isPixelFrameWebGl2LutCurrentV1,
	type PixelFrameWebGl2LutResourcesCurrentV1 } from './pixel-frame-webgl2-lut-current-v1.ts';
import { captureCubeLutSourceV1 } from './cube-lut-source-scope-v1.ts';

const MAXIMUM = 768 * 1024 * 1024;
const BUFFER = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Float32Array.prototype), 'buffer')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
export type PixelFrameWebGl2ViewCurrentV1 = Readonly<{ backend: 'webgl2'; frame: Readonly<LinearWorkingPixelFrameV1> }>
	| Readonly<{ backend: 'cpu'; reason: string; source: Readonly<LinearWorkingPixelFrameV1> }>;

/** Complete scalar admission precedes pixels, canvas creation and allocation.
 * GPU and CPU fallback are separate phases; the probe has a fixed 1 KiB reserve. */
export function planPixelFrameWebGl2CurrentV1(value: unknown) {
	const input = record(value, 'Native GPU request', ['frame', 'passes', 'signal', 'lutSource'], ['frame', 'passes']);
	const raw = field(input, 'frame', 'Native GPU request');
	if (typeof raw !== 'object' || raw === null) throw new TypeError('Native GPU requires a pixel frame.');
	const sourcePlan = admitPixelFrameV1(field(raw as Readonly<Record<string, unknown>>, 'descriptor', 'Native GPU frame'), {
		profiles: ['float32', 'unorm16'].flatMap(sampleFormat => ['srgb', 'bt709'].map(primaries => ({ sampleFormat, primaries, transfer: 'linear' }))), limits: LINEAR_KERNEL_LIMITS_V1,
	});
	const descriptor = captureLinearKernelDescriptorV1({ ...sourcePlan.descriptor, sampleFormat: 'float32' });
	const passes = Object.freeze(array(field(input, 'passes', 'Native GPU request'), 'Native GPU passes', 0, 256).map(readPixelFrameWebGl2PassCurrentV1));
	const lutPasses = Object.freeze(passes.filter(isPixelFrameWebGl2LutCurrentV1)), luts = planPixelFrameWebGl2LutsCurrentV1(lutPasses);
	const lutSource = luts.references.length ? captureCubeLutSourceV1(field(input, 'lutSource', 'Native GPU LUT source')) : undefined;
	const floatBytes = descriptor.width * descriptor.height * 16;
	const uniformBytes = passes.some(pass => pass.kind > 2) ? PIXEL_FRAME_WEBGL2_COLOR_SCRATCH_BYTES_CURRENT_V1 : 0;
	const resourceBytes = luts.oracleBytes + luts.uploadBytes + luts.textureBytes;
	const gpuWorkingBytes = sourcePlan.byteLength + floatBytes * 4 + uniformBytes + resourceBytes;
	const peakWorkingBytes = Math.max(gpuWorkingBytes, sourcePlan.byteLength + floatBytes + luts.capturePeakBytes,
		sourcePlan.byteLength + floatBytes + luts.oracleBytes + luts.textureBytes + 1024);
	return Object.freeze({ raw, sourcePlan, descriptor, passes, lutPasses, luts, lutSource, floatBytes, uniformBytes, resourceBytes,
		gpuWorkingBytes, peakWorkingBytes, eligible: luts.eligible && peakWorkingBytes <= MAXIMUM });
}

/** A single scoped outcome. Unsupported execution lends the exact captured
 * source only after GL retirement, allowing the caller to evaluate its entire
 * CPU recipe without reopening mutable inputs. Delivery is never replayed. */
export async function withPixelFrameWebGl2CurrentV1<Result>(value: unknown,
	consume: (view: PixelFrameWebGl2ViewCurrentV1) => Result | Promise<Result>): Promise<Result> {
	const ownSignal = typeof value === 'object' && value !== null ? Object.getOwnPropertyDescriptor(value, 'signal') : undefined;
	if (ownSignal && !Object.hasOwn(ownSignal, 'value')) throw new TypeError('Native GPU signal requires own data.');
	const signal = captureRepairSignalV1(ownSignal?.value), check = () => { checkRepairSignalV1(signal); }; check();
	if (typeof consume !== 'function') throw new TypeError('Native GPU requires a scoped consumer.');
	const plan = planPixelFrameWebGl2CurrentV1(value);
	const raw = record(plan.raw, 'Native GPU frame', ['descriptor', 'pixels']);
	const source = readPixelFrameV1({ descriptor: plan.sourcePlan.descriptor, pixels: field(raw, 'pixels', 'Native GPU frame') }, LINEAR_KERNEL_LIMITS_V1); check();
	const borrowedBytes = Number(Reflect.apply(SIZE, Reflect.apply(BUFFER, source.pixels, []), []));
	if (borrowedBytes + plan.floatBytes > MAXIMUM) throw new RangeError('Native GPU source capture exceeds its physical working bound.');
	const eligible = plan.eligible && borrowedBytes + plan.peakWorkingBytes - plan.sourcePlan.byteLength <= MAXIMUM;
	const owner = new LinearDevelopOwnerV1(borrowedBytes, MAXIMUM - (eligible ? plan.floatBytes * 2 + plan.uniformBytes + plan.resourceBytes : 0));
	return owner.run(async () => {
		const pixels = owner.floats(plan.floatBytes / 4);
		if (source.pixels instanceof Float32Array) Float32Array.prototype.set.call(pixels, source.pixels);
		else if (source.pixels instanceof Uint16Array) for (let index = 0; index < pixels.length; index++) pixels[index] = source.pixels[index]! / 65535;
		else throw new TypeError('Native GPU requires native words or floats.');
		const captured: Readonly<LinearWorkingPixelFrameV1> = Object.freeze({ descriptor: plan.descriptor, pixels });
		let readback: Float32Array<ArrayBuffer> | undefined;
		let context: Awaited<ReturnType<typeof import('./pixel-frame-webgl2-context-current-v1.ts')['openPixelFrameWebGl2ContextCurrentV1']>> | undefined;
		let reason: string | undefined = eligible ? undefined : 'working-set';
		const open = async (resources?: Readonly<PixelFrameWebGl2LutResourcesCurrentV1>) => {
			// The exact host source is already captured. Default CPU composition
			// need not load any executable WebGL context owner.
			const native = await import('./pixel-frame-webgl2-context-current-v1.ts'); check();
			try { context = await native.openPixelFrameWebGl2ContextCurrentV1(captured, plan.passes, () => readback = owner.floats(pixels.length), signal, resources); }
			catch (error) { const unavailable = native.pixelFrameWebGl2UnavailableReasonCurrentV1(error); if (unavailable === null) throw error; reason = unavailable; }
		};
		if (eligible) try {
			if (plan.lutSource) await withPixelFrameWebGl2LutsCurrentV1(plan.lutPasses, plan.lutSource, open, signal);
			else await open();
		} catch (error) {
			// Resource retirement can fail after successful context creation.
			// That context must retire too, without any consumer or CPU replay.
			let retirement: { error: unknown } | undefined;
			try { context?.dispose(); } catch (cleanup) { retirement = { error: cleanup }; }
			if (retirement && !Object.is(error, retirement.error))
				throw new AggregateError([error, retirement.error], 'Native GPU LUT and GL retirement failed.', { cause: error });
			throw error;
		}
		if (!context) {
			if (readback) owner.retire(readback.buffer);
			check(); const result = await consume(Object.freeze({ backend: 'cpu', reason: reason!, source: captured })); check(); return result;
		}
		let outcome: { value: Result } | { error: unknown };
		try { check(); const result = await consume(Object.freeze({ backend: 'webgl2', frame: Object.freeze({ descriptor: plan.descriptor, pixels: context.pixels }) }));
			check(); context.assertCurrent(); outcome = { value: result };
		} catch (error) { outcome = { error }; }
		let retirement: { error: unknown } | undefined;
		try { context.dispose(); } catch (cleanup) { retirement = { error: cleanup }; }
		if (retirement) {
			if ('error' in outcome && !Object.is(outcome.error, retirement.error)) throw new AggregateError([outcome.error, retirement.error], 'Native GPU consumer and GL retirement failed.', { cause: outcome.error });
			throw retirement.error;
		}
		if ('error' in outcome) throw outcome.error; return outcome.value;
	});
}
