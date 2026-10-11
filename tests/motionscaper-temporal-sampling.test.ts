/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperHistory } from '../src/motionscaper/editor-project-commands.ts';
import { createMotionscaperRenderQualityCommands } from '../src/motionscaper/editor-render-quality-commands.ts';
import { normalizeMotionscaperProject } from '../src/common/editor/motion-project-validation.ts';
import { compileMotionscaperProject } from '../src/motionscaper/editor-project-evaluation.ts';
import { planMotionTemporalSamples, admitMotionTemporalWork } from '../src/common/editor/motion-temporal-sampling.ts';
import { visitMotionTemporalSamples } from '../src/common/editor/motion-temporal-evaluation.ts';
import { createMotionSceneWorkBudget } from '../src/common/editor/motion-scene-work-budget.ts';
import { motionColor, motionScalar, motionVector } from '../src/common/editor/motion-property.ts';
import { multiplyRationals } from '../src/common/editor/timeline-time.ts';
const r = (num: number, den = 1) => ({ num, den });
const project = createMotionscaperProject({ id: 'p', title: 'Temporal', compositionId: 'main', width: 16, height: 16, frameRate: r(30000, 1001) });
const temporal = { shutterOpenFrames: r(-1, 4), shutterCloseFrames: r(1, 4), samples: 4 };

test('M09 exact shutter midpoint planning and independent lens quality preserve omitted legacy authority', () => {
	const composition = project.compositions[0]!; const time = r(1001, 3000);
	assert.deepEqual(planMotionTemporalSamples(composition, time).samples, [{ index: 0, time, weight: r(1) }]);
	assert.equal(Object.hasOwn(normalizeMotionscaperProject(project).compositions[0]!, 'temporal'), false);
	assert.equal(Object.hasOwn(compileMotionscaperProject(project).evaluate({ compositionId: 'main', time }), 'depthOfFieldSamples'), false);
	const h = createMotionscaperHistory(project); const changed = h.commit(createMotionscaperRenderQualityCommands({ project, compositionId: 'main', temporal, depthOfFieldSamples: 8 }));
	const authored = changed.compositions[0]!; const plan = planMotionTemporalSamples(authored, time);
	assert.deepEqual(plan.samples.map(sample => multiplyRationals(sample.time, composition.frameRate)), [r(157, 16), r(159, 16), r(161, 16), r(163, 16)]);
	assert.ok(plan.samples.every(sample => sample.weight.num === 1 && sample.weight.den === 4)); assert.equal(plan.depthOfFieldSamples, 8); assert.equal(Object.hasOwn(plan, 'depthOfFieldSampleLimit'), false);
	assert.deepEqual(planMotionTemporalSamples(authored, time, { temporalSamples: 1 }).samples[0]!.time, time);
	assert.equal(planMotionTemporalSamples(authored, time, { depthOfFieldSamples: 2 }).depthOfFieldSamples, 2);
	assert.equal(planMotionTemporalSamples(authored, time, { depthOfFieldSamples: 2 }).depthOfFieldSampleLimit, 2);
	assert.equal(compileMotionscaperProject(changed).evaluate({ compositionId: 'main', time }).depthOfFieldSamples, 8);
	assert.deepEqual(normalizeMotionscaperProject(JSON.parse(JSON.stringify(changed))).compositions, changed.compositions);
	assert.equal(h.undo(), true); assert.deepEqual(h.snapshot().project.compositions, project.compositions);
});

test('M09 temporal contracts reject malformed quality, extra capabilities, and implicit preview quality increases', () => {
	const composition = { ...project.compositions[0]!, temporal };
	for (const invalid of [{ ...temporal, samples: 65 }, { ...temporal, samples: 0 }, { ...temporal, shutterOpenFrames: r(-2) }, { ...temporal, shutterCloseFrames: r(-1) }, { ...temporal, seed: 1 }]) {
		assert.throws(() => normalizeMotionscaperProject({ ...project, compositions: [{ ...composition, temporal: invalid }] }), /shutter|temporal|sample|field|unknown/iu);
	}
	assert.throws(() => planMotionTemporalSamples(composition, r(0), { temporalSamples: 5 }), /quality|sample/iu);
	assert.throws(() => planMotionTemporalSamples({ ...composition, depthOfFieldSamples: 4 }, r(0), { depthOfFieldSamples: 5 }), /quality|sample/iu);
	assert.throws(() => normalizeMotionscaperProject({ ...project, compositions: [{ ...composition, depthOfFieldSamples: 0 }] }), /sample/iu);
});

function animatedProject() {
	const layer = createMotionLayer({ id: 'animated', name: 'Animated', durationFrames: 300, content: { kind: 'null' } });
	const animated = { ...layer, transform: { ...layer.transform, position: { ...motionVector([0, 0, 0]), expression: { source: '[time, frame, random(7)]', enabled: true, references: [] } } } };
	const nested = { ...project.compositions[0]!, id: 'nested', frameRate: r(24), layers: [animated], temporal: { ...temporal, samples: 64 } };
	const precomp = createMotionLayer({ id: 'precomp', name: 'Precomp', durationFrames: 300, content: { kind: 'precomp', compositionId: 'nested' } });
	return normalizeMotionscaperProject({ ...project, compositions: [{ ...project.compositions[0]!, temporal, layers: [{ ...precomp, timeScale: r(-2), sourceStart: r(2) }] }, nested] });
}
test('M09 temporal visits are sequential, exact under nested reverse timing and independent of visit history', async () => {
	const value = animatedProject(); const evaluator = compileMotionscaperProject(value); const plan = planMotionTemporalSamples(value.compositions[0]!, r(1, 2));
	const first: unknown[] = []; let pending = false;
	await visitMotionTemporalSamples({ evaluator, plan, visit: async (sample, frame) => {
		assert.equal(pending, false); pending = true; await Promise.resolve();
		assert.deepEqual(frame, evaluator.evaluate({ compositionId: 'main', time: sample.time })); first.push(frame.layers[0]!.precomposition!.layers[0]!.state.transform.position); pending = false;
	} });
	evaluator.evaluate({ compositionId: 'main', time: r(5) }); const again: unknown[] = [];
	await visitMotionTemporalSamples({ evaluator, plan, visit: (sample, frame) => { assert.equal(sample.index, again.length); again.push(frame.layers[0]!.precomposition!.layers[0]!.state.transform.position); return Promise.resolve(); } });
	assert.deepEqual(again, first); assert.equal(first.length, 4);
});
test('M09 shutter work, expression work, cancellation, and pixel-lens admission remain bounded before allocation', async () => {
	const value = animatedProject(); const evaluator = compileMotionscaperProject(value); const plan = planMotionTemporalSamples(value.compositions[0]!, r(1, 2));
	const budget = createMotionSceneWorkBudget(1); assert.throws(() => evaluator.evaluate({ compositionId: 'main', time: r(1, 2) }, { sceneWork: budget }), /work|budget/iu);
	await assert.rejects(visitMotionTemporalSamples({ evaluator, plan, maximumSceneWork: 1, visit: () => Promise.resolve() }), /work|budget/iu);
	await assert.rejects(visitMotionTemporalSamples({ evaluator, plan, maximumExpressionOperations: 1, visit: () => Promise.resolve() }), /work|budget/iu);
	const controller = new AbortController(); let visits = 0;
	await assert.rejects(visitMotionTemporalSamples({ evaluator, plan, signal: controller.signal, visit: () => { visits++; controller.abort(); return Promise.resolve(); } }), { name: 'AbortError' }); assert.equal(visits, 1);
	assert.throws(() => admitMotionTemporalWork(value, 'main', {}, { maximumPixelSamples: 1 }), /pixel|work|budget/iu);
	assert.equal(admitMotionTemporalWork(value, 'main').temporalSamples, 4);
});

test('M09 fractional samples outside composition bounds stay transparent and lens work multiplies the root shutter only', async () => {
	const value = animatedProject(); const composition = value.compositions[0]!; const plan = planMotionTemporalSamples(composition, 0);
	const layers: number[] = [];
	await visitMotionTemporalSamples({ evaluator: compileMotionscaperProject(value), plan, visit: (_sample, frame) => { layers.push(frame.layers.length); return Promise.resolve(); } });
	assert.deepEqual(layers, [0, 0, 1, 1]);
	const camera = createMotionLayer({ id: 'camera', name: 'Camera', durationFrames: 300, content: { kind: 'camera', projection: 'perspective', zoom: motionScalar(1), near: 0.1, far: 1000, focusDistance: motionScalar(10), aperture: motionScalar(1) } });
	const high = { ...value, compositions: [{ ...composition, depthOfFieldSamples: 64, layers: [camera, ...composition.layers] }, value.compositions[1]!] };
	const full = admitMotionTemporalWork(high, 'main'); const reduced = admitMotionTemporalWork(high, 'main', { depthOfFieldSamples: 1 });
	assert.ok(full.pixelSamples > reduced.pixelSamples); assert.equal(full.temporalSamples, 4);
	assert.throws(() => admitMotionTemporalWork(high, 'main', {}, { maximumPixelSamples: reduced.pixelSamples }), /work|budget/iu);
	const history = createMotionscaperHistory(high); const reset = history.commit(createMotionscaperRenderQualityCommands({ project: high, compositionId: 'main', temporal: null, depthOfFieldSamples: null }));
	assert.equal(Object.hasOwn(reset.compositions[0]!, 'temporal'), false); assert.equal(Object.hasOwn(reset.compositions[0]!, 'depthOfFieldSamples'), false);
});

test('M09 source-independent work admission includes per-lens lighting and each shadow caster', () => {
	const plane = createMotionLayer({ id: 'plane', name: 'Plane', durationFrames: 300, content: { kind: 'solid', color: motionColor([1, 1, 1, 1]), size: motionVector([8, 8]) } });
	const caster = { ...plane, is3D: true, material: { ...plane.material, castsShadows: true } };
	const light = createMotionLayer({ id: 'light', name: 'Light', durationFrames: 300, content: { kind: 'light', lightType: 'point', color: motionColor([1, 1, 1, 1]), intensity: motionScalar(1), coneAngle: motionScalar(45), coneFeather: motionScalar(0), castsShadows: true } });
	const lit = { ...project, compositions: [{ ...project.compositions[0]!, temporal, layers: [caster, light] }] };
	const unlit = { ...project, compositions: [{ ...project.compositions[0]!, temporal, layers: [caster] }] };
	const before = admitMotionTemporalWork(unlit, 'main'); const after = admitMotionTemporalWork(lit, 'main');
	assert.ok(after.pixelSamples > before.pixelSamples * 2);
	assert.throws(() => admitMotionTemporalWork(lit, 'main', {}, { maximumPixelSamples: before.pixelSamples * 2 }), /pixel.*budget/iu);
});
