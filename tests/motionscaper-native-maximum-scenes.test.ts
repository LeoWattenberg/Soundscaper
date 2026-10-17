/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import CanvasKitInit from 'canvaskit-wasm';
import { createMotionMaximumScene } from '../desktop/motionscaper-native-maximum-scenes.ts';
import { motionMaximumScenePixel } from '../desktop/motionscaper-native-maximum-scene-oracle.ts';
import { compileMotionscaperProject } from '../src/motionscaper/editor-project-evaluation.ts';
import { createCanvasKitMotionRasterizer } from '../src/common/editor/motion-canvaskit-rasterizer.ts';
import { renderMotionCompositionFrame } from '../src/common/editor/motion-composition-renderer.ts';
import { renderMotionTemporalSamples } from '../src/common/editor/motion-temporal-rendering.ts';
import { admitMotionTemporalWork, planMotionTemporalSamples } from '../src/common/editor/motion-temporal-sampling.ts';
import { planMotionDepth } from '../src/common/editor/motion-depth-plan.ts';
import { planMotionLighting } from '../src/common/editor/motion-lighting-plan.ts';
import { motionVector } from '../src/common/editor/motion-property.ts';

const near = (actual: ArrayLike<number>, expected: readonly number[]) => expected.forEach((value, index) => assert.ok(Math.abs(actual[index]! - value) < 2e-7, `${Array.from(actual)} differs from ${expected}`));
const kit = await CanvasKitInit();
const rasterizer = createCanvasKitMotionRasterizer(kit, { assets: [], fallbackFonts: [], loadAsset: () => Promise.reject(new Error('Maximum scenes own no assets.')) });

test('M09 maximum quality authors 64 positive-aperture lenses and 64 shutter strata without reducing either', () => {
	const project = createMotionMaximumScene('quality'), composition = project.compositions[0]!;
	const plan = planMotionTemporalSamples(composition, { num: 1, den: 30 });
	assert.equal(plan.samples.length, 64); assert.equal(plan.depthOfFieldSamples, 64);
	assert.deepEqual(plan.samples[0]!.time, { num: 13, den: 768 });
	const frame = compileMotionscaperProject(project).evaluate({ compositionId: 'main', time: { num: 1, den: 30 } });
	const depth = planMotionDepth(frame);
	assert.equal(depth.lenses.length, 64); assert.equal(depth.camera.aperture, 16); assert.equal(depth.planes.length, 2);
	assert.equal(planMotionLighting(frame, depth).lights.length, 1);
	assert.ok(planMotionLighting(frame, depth).lights[0]!.castsShadows);
	assert.ok(depth.planes.every(plane => plane.layer.state.material.castsShadows));
	assert.equal(admitMotionTemporalWork(project, 'main').pixelSamples, 135_266_304);
	assert.throws(() => planMotionTemporalSamples({ ...composition, depthOfFieldSamples: 65 }, 0), /samples/u);
	assert.throws(() => planMotionTemporalSamples({ ...composition, temporal: { ...composition.temporal!, samples: 65 } }, 0), /samples/u);
});

test('M09 quality oracle independently exposes shutter, lens and picture changes at fixed edge probes', () => {
	const probes = [[16, 24], [22, 24], [26, 24], [20, 19], [20, 20], [36, 30], [8, 10], [44, 40]] as const;
	for (const control of [{ shutterSamples: 1 }, { lensSamples: 1 }, { shadows: false }]) {
		assert.ok(probes.some(([x, y]) => motionMaximumScenePixel('quality', 1, x, y).some((value, index) => Math.abs(value - motionMaximumScenePixel('quality', 1, x, y, control)[index]!) > 1e-4)), `${JSON.stringify(control)} must change an independently predicted edge.`);
	}
	assert.ok(probes.some(([x, y]) => JSON.stringify(motionMaximumScenePixel('quality', 1, x, y)) !== JSON.stringify(motionMaximumScenePixel('quality', 2, x, y))));
});

test('M09 quality ray/rectangle oracle matches the production renderer using reduced sampling only in this fast mathematical control', async () => {
	const base = createMotionMaximumScene('quality'), composition = { ...base.compositions[0]!, depthOfFieldSamples: 4,
		temporal: { ...base.compositions[0]!.temporal!, samples: 2 } };
	const evaluator = compileMotionscaperProject({ ...base, compositions: [composition] });
	const output = await renderMotionTemporalSamples({ evaluator, plan: planMotionTemporalSamples(composition, { num: 1, den: 30 }),
		render: (frame, options) => renderMotionCompositionFrame(frame, { rasterizer, ...options }) });
	for (const [x, y] of [[0, 0], [16, 24], [22, 24], [26, 24], [20, 19], [20, 20], [36, 30], [8, 10], [44, 40], [63, 63]]) {
		const offset = (y! * 64 + x!) * 4;
		near(output.pixels.subarray(offset, offset + 4), motionMaximumScenePixel('quality', 1, x!, y!, { shutterSamples: 2, lensSamples: 4 }));
	}
	const noShadow = { ...base, compositions: [{ ...composition, layers: composition.layers.map(layer => layer.kind === 'light' ? { ...layer, castsShadows: false } : layer) }] };
	const alternate = await renderMotionTemporalSamples({ evaluator: compileMotionscaperProject(noShadow), plan: planMotionTemporalSamples(noShadow.compositions[0]!, { num: 1, den: 30 }),
		render: (frame, options) => renderMotionCompositionFrame(frame, { rasterizer, ...options }) });
	const offset = (30 * 64 + 36) * 4;
	near(alternate.pixels.subarray(offset, offset + 4), motionMaximumScenePixel('quality', 1, 36, 30, { shutterSamples: 2, lensSamples: 4, shadows: false }));
	assert.notDeepEqual(alternate.pixels.subarray(offset, offset + 4), output.pixels.subarray(offset, offset + 4));
});

test('M09 64-plane fixture reaches exactly the admitted depth-ray maximum and every plane contributes', async () => {
	const project = createMotionMaximumScene('planes'), composition = project.compositions[0]!;
	const frame = compileMotionscaperProject(project).evaluate({ compositionId: 'main', time: 0 }), depth = planMotionDepth(frame);
	assert.equal(depth.planes.length, 64); assert.equal(frame.width * frame.height * depth.planes.length * depth.lenses.length, 67_108_864);
	assert.equal(admitMotionTemporalWork(project, 'main').pixelSamples, 136_314_880);
	const expected = motionMaximumScenePixel('planes', 0, 512, 512);
	for (let omittedPlane = 0; omittedPlane < 64; omittedPlane++) assert.notDeepEqual(expected, motionMaximumScenePixel('planes', 0, 512, 512, { omittedPlane }));
	assert.deepEqual(motionMaximumScenePixel('planes', 0, 0, 0), [.25, .5, .125, 1]);
	assert.deepEqual(motionMaximumScenePixel('planes', 0, 1023, 1023), [0, 0, 0, 0]);
	// Same 64 depth/color contributors in a tiny control; the 1024-square workload is reserved for the installed driver.
	const small = { ...project, compositions: [{ ...composition, width: 16, height: 16, layers: composition.layers.map(layer => layer.kind === 'camera'
		? { ...layer, zoom: { ...layer.zoom, value: 16 }, transform: { ...layer.transform, position: motionVector([8, 8, -64]) } }
		: layer.is3D ? { ...layer, transform: { ...layer.transform, position: motionVector([2, 2, layer.transform.position.value[2]]), scale: motionVector([2, 2, 1]) } } : layer) }] };
	const output = await renderMotionCompositionFrame(compileMotionscaperProject(small).evaluate({ compositionId: 'main', time: 0 }), { rasterizer });
	near(output.pixels.subarray((8 * 16 + 8) * 4, (8 * 16 + 8) * 4 + 4), expected);
});

test('M09 all 32 point lights illuminate real receiver pixels and independently calculated translucent shadows', async () => {
	const project = createMotionMaximumScene('lights'), evaluator = compileMotionscaperProject(project);
	const frame = evaluator.evaluate({ compositionId: 'main', time: 0 }), depth = planMotionDepth(frame), lighting = planMotionLighting(frame, depth);
	assert.equal(lighting.lights.length, 32); assert.ok(lighting.lights.every(light => light.castsShadows && light.rgb[0] > 0));
	const output = await renderMotionCompositionFrame(frame, { rasterizer });
	for (const [x, y] of [[0, 0], [6, 16], [16, 16], [22, 16], [31, 31]]) {
		const offset = (y! * 32 + x!) * 4; near(output.pixels.subarray(offset, offset + 4), motionMaximumScenePixel('lights', 0, x!, y!));
	}
	const expected = motionMaximumScenePixel('lights', 0, 22, 16);
	assert.notDeepEqual(expected, motionMaximumScenePixel('lights', 0, 22, 16, { shadows: false }));
	for (let omittedLight = 0; omittedLight < 32; omittedLight++) assert.notDeepEqual(expected, motionMaximumScenePixel('lights', 0, 22, 16, { omittedLight }));
	const composition = project.compositions[0]!;
	const without = { ...project, compositions: [{ ...composition, layers: composition.layers.filter(layer => layer.id !== 'light-31') }] };
	const changed = await renderMotionCompositionFrame(compileMotionscaperProject(without).evaluate({ compositionId: 'main', time: 0 }), { rasterizer });
	near(changed.pixels.subarray((16 * 32 + 22) * 4, (16 * 32 + 22) * 4 + 4), motionMaximumScenePixel('lights', 0, 22, 16, { omittedLight: 31 }));
});

test('M09 65 planes, 33 lights and combined maxima refuse before any raster source or target is acquired', async () => {
	let acquired = 0;
	const forbidden = { ...rasterizer, rasterize: () => { acquired++; throw new Error('No source may be acquired.'); }, rasterizeLocal: () => { acquired++; throw new Error('No local source may be acquired.'); } };
	for (const kind of ['planes-over', 'lights-over'] as const) {
		const project = createMotionMaximumScene(kind), frame = compileMotionscaperProject(project).evaluate({ compositionId: 'main', time: 0 });
		await assert.rejects(renderMotionCompositionFrame(frame, { rasterizer: forbidden }), kind === 'planes-over' ? /plane\/ray budget/u : /32-light budget/u);
	}
	assert.equal(acquired, 0);
	const combined = createMotionMaximumScene('combined-over');
	assert.throws(() => admitMotionTemporalWork(combined, 'main'), /pixel\/lens work budget/u);
});
