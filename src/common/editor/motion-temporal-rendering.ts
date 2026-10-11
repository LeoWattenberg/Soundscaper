/* SPDX-License-Identifier: AGPL-3.0-only */
import { assertMotionFrameConsumed, type MotionCompositionFrame } from './motion-composition-evaluation.ts';
import type { MotionRenderResult } from './motion-composition-renderer.ts';
import { assertMotionWorkingBudget, MOTION_DEFAULT_WORKING_BYTES } from './motion-render-budget.ts';
import { createMotionSurface, motionSurfaceLength, validateMotionSurface } from './motion-surface.ts';
import { assertMotionTemporalSamplePlan } from './motion-temporal-sampling.ts';
import { visitMotionTemporalSamples } from './motion-temporal-evaluation.ts';

export interface MotionTemporalRasterOptions { readonly maximumWorkingBytes: number; readonly depthOfFieldSamples?: number }
/** One Float64 shutter accumulator, one transient renderer result, and a separately admitted final Float32 store. */
export async function renderMotionTemporalSamples(options: Omit<Parameters<typeof visitMotionTemporalSamples>[0], 'visit'> & Readonly<{
	maximumWorkingBytes?: number;
	render: (frame: MotionCompositionFrame, options: MotionTemporalRasterOptions) => Promise<MotionRenderResult>;
}>): Promise<MotionRenderResult> {
	options.signal?.throwIfAborted(); const { plan } = options; assertMotionTemporalSamplePlan(plan);
	const length = motionSurfaceLength(plan.width, plan.height); const bytes = length * Float32Array.BYTES_PER_ELEMENT;
	const maximum = options.maximumWorkingBytes ?? MOTION_DEFAULT_WORKING_BYTES;
	const multiple = plan.samples.length > 1; const accumulationBytes = multiple ? bytes * 2 : 0;
	assertMotionWorkingBudget(accumulationBytes + bytes, maximum);
	const sum = multiple ? new Float64Array(length) : null;
	let single: MotionRenderResult | null = null; const consumed: string[] = []; let ledgerBytes = 0;
	await visitMotionTemporalSamples({ ...options, visit: async (sample, frame) => {
		const rendered = await options.render(frame, { maximumWorkingBytes: maximum - accumulationBytes, ...(plan.depthOfFieldSampleLimit === undefined ? {} : { depthOfFieldSamples: plan.depthOfFieldSampleLimit }) });
		options.signal?.throwIfAborted(); validateMotionSurface(rendered);
		if (rendered.width !== plan.width || rendered.height !== plan.height) throw new Error('Temporal renderer returned a different surface geometry.');
		assertMotionFrameConsumed(frame, rendered.consumedOperationIds);
		if (!sum) { single = rendered; return; }
		for (const id of rendered.consumedOperationIds) {
			const qualified = `sample:${sample.index}/${id}`; ledgerBytes += 48 + qualified.length * 2;
			if (ledgerBytes > 16 * 1024 * 1024 || consumed.length >= 131072) throw new RangeError('Temporal operation ledger exceeds its retained memory budget.');
			consumed.push(qualified);
		}
		const weight = sample.weight.num / sample.weight.den;
		for (let index = 0; index < length; index++) { if (index % 65536 === 0) options.signal?.throwIfAborted(); sum[index] = sum[index]! + rendered.pixels[index]! * weight; }
	} });
	if (!sum) { if (!single) throw new Error('Temporal renderer omitted its sample.'); return single; }
	const surface = createMotionSurface(plan.width, plan.height);
	for (let index = 0; index < length; index += 4) {
		if (index % 65536 === 0) options.signal?.throwIfAborted();
		// Equal positive weights mathematically keep SDR channels in [0,alpha]; remove only floating-point boundary noise.
		const alpha = Math.min(1, Math.max(0, sum[index + 3]!)); surface.pixels[index + 3] = alpha;
		for (let channel = 0; channel < 3; channel++) surface.pixels[index + channel] = Math.min(alpha, Math.max(0, sum[index + channel]!));
	}
	validateMotionSurface(surface); return Object.freeze({ ...surface, consumedOperationIds: Object.freeze(consumed) });
}
