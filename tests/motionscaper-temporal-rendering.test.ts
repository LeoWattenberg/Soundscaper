/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { compileMotionscaperProject } from '../src/motionscaper/editor-project-evaluation.ts';
import { planMotionTemporalSamples } from '../src/common/editor/motion-temporal-sampling.ts';
import { renderMotionTemporalSamples } from '../src/common/editor/motion-temporal-rendering.ts';
import { createMotionSurface, validateMotionSurface } from '../src/common/editor/motion-surface.ts';
const r = (num: number, den = 1) => ({ num, den });
const project = createMotionscaperProject({ id: 'p', title: 'Shutter', compositionId: 'main', width: 1, height: 1 });
const composition = { ...project.compositions[0]!, temporal: { shutterOpenFrames: r(-1, 2), shutterCloseFrames: r(1, 2), samples: 4 } };
const evaluator = compileMotionscaperProject({ ...project, compositions: [composition] });

test('M09 temporal rasterization averages premultiplied linear samples and verifies every subframe ledger', async () => {
	const plan = planMotionTemporalSamples(composition, r(1)); const times: unknown[] = []; const budgets: number[] = [];
	const result = await renderMotionTemporalSamples({ evaluator, plan, maximumWorkingBytes: 1024, render: async (frame, options) => {
		times.push(frame.time); budgets.push(options.maximumWorkingBytes); assert.equal(Object.hasOwn(options, 'depthOfFieldSamples'), false);
		return { ...createMotionSurface(1, 1, times.length <= 2 ? [1, 0, 0, 1] : [0, 0, 1, 0.5]), consumedOperationIds: frame.requiredOperationIds };
	} });
	assert.deepEqual(times, plan.samples.map(sample => sample.time)); assert.deepEqual(budgets, [992, 992, 992, 992]);
	assert.deepEqual([...result.pixels], [0.5, 0, 0.25, 0.75]); validateMotionSurface(result);
	assert.deepEqual(result.consumedOperationIds, [0, 1, 2, 3].map(index => `sample:${index}/main/background`));
	await assert.rejects(renderMotionTemporalSamples({ evaluator, plan, render: async () => ({ ...createMotionSurface(1, 1), consumedOperationIds: [] }) }), /omitted/iu);
});
test('M09 63 opaque shutter samples stay physically valid without repeated Float32 accumulation', async () => {
	const value = { ...composition, temporal: { ...composition.temporal, samples: 63 } }; const plan = planMotionTemporalSamples(value, r(1));
	const result = await renderMotionTemporalSamples({ evaluator, plan, render: frame => Promise.resolve({ ...createMotionSurface(1, 1, [1, 1, 1, 1]), consumedOperationIds: frame.requiredOperationIds }) });
	assert.deepEqual([...result.pixels], [1, 1, 1, 1]); validateMotionSurface(result);
});
test('M09 temporal accumulation memory and cancellation fail before another source frame is requested', async () => {
	const plan = planMotionTemporalSamples(composition, r(1)); let renders = 0;
	const render = (frame: ReturnType<typeof evaluator.evaluate>) => { renders++; return Promise.resolve({ ...createMotionSurface(1, 1), consumedOperationIds: frame.requiredOperationIds }); };
	await assert.rejects(renderMotionTemporalSamples({ evaluator, plan, maximumWorkingBytes: 47, render }), /working|budget/iu); assert.equal(renders, 0);
	const controller = new AbortController();
	await assert.rejects(renderMotionTemporalSamples({ evaluator, plan, signal: controller.signal, render: async (frame) => { const result = await render(frame); controller.abort(); return result; } }), { name: 'AbortError' }); assert.equal(renders, 1);
});
