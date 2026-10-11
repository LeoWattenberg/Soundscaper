/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import CanvasKitInit from 'canvaskit-wasm';
import { createCanvasKitMotionRasterizer } from '../src/common/editor/motion-canvaskit-rasterizer.ts';
import { renderMotionCompositionFrame } from '../src/common/editor/motion-composition-renderer.ts';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { compileMotionscaperProject } from '../src/motionscaper/editor-project-evaluation.ts';
import { motionColor, motionScalar, motionVector } from '../src/common/editor/motion-property.ts';
import type { MotionLayer } from '../src/common/editor/motion-composition.ts';

const kit = await CanvasKitInit();
const rasterizer = createCanvasKitMotionRasterizer(kit, { assets: [], fallbackFonts: [], async loadAsset() { throw new Error('No assets.'); } });
const project = createMotionscaperProject({ id: 'lighting', title: 'Lights', compositionId: 'main', width: 32, height: 32 });
const solid = (id = 'plane', color: readonly [number, number, number, number] = [0.25, 0.25, 0.25, 1]): MotionLayer => {
	const layer = createMotionLayer({ id, name: id, durationFrames: 300, content: { kind: 'solid', size: motionVector([32, 32]), color: motionColor(color) } }); return { ...layer, is3D: true };
};
const light = (lightType: 'ambient' | 'point' | 'spot' = 'point'): MotionLayer => {
	const layer = createMotionLayer({ id: 'light', name: 'Light', durationFrames: 300, content: { kind: 'light', lightType, color: motionColor([1, 1, 1, 1]), intensity: motionScalar(0.5),
		coneAngle: motionScalar(10), coneFeather: motionScalar(0), castsShadows: false } });
	return { ...layer, transform: { ...layer.transform, position: motionVector([16.5, 16.5, -32]) } };
};
const evaluate = (layers: readonly MotionLayer[]) => compileMotionscaperProject({ ...project, compositions: [{ ...project.compositions[0], layers }] }).evaluate({ compositionId: 'main', time: 0 });
const render = (layers: readonly MotionLayer[]) => renderMotionCompositionFrame(evaluate(layers), { rasterizer });
const pixel = (surface: Awaited<ReturnType<typeof render>>, x = 16, y = 16) => [...surface.pixels.subarray((y * surface.width + x) * 4, (y * surface.width + x) * 4 + 4)];
const near = (actual: readonly number[], expected: readonly number[]) => actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]!) < 1e-6, `${actual} differs from ${expected}`));

test('ambient lights color material response in premultiplied linear SDR and unlit layers retain their pixels', async () => {
	const ambient = light('ambient'); if (ambient.kind !== 'light') throw new Error('Unexpected light.');
	const blue = { ...ambient, color: motionColor([0, 0, 1, 1]) }; const plane = solid();
	near(pixel(await render([plane, blue])), [0, 0, 0.125, 1]);
	near(pixel(await render([{ ...plane, material: { ...plane.material, acceptsLights: false } }, blue])), [0.25, 0.25, 0.25, 1]);
	near(pixel(await render([{ ...plane, is3D: false }, blue])), [0.25, 0.25, 0.25, 1]);
	near(pixel(await render([plane])), [0.25, 0.25, 0.25, 1]);
});

test('point and oriented spot lights consume 3D normal, cone, feather and specular material intent', async () => {
	const plane = solid(); near(pixel(await render([plane, light()])), [0.125, 0.125, 0.125, 1]);
	const spot = light('spot'); near(pixel(await render([plane, spot])), [0.125, 0.125, 0.125, 1]); near(pixel(await render([plane, spot]), 3), [0, 0, 0, 1]);
	if (spot.kind !== 'light') throw new Error('Unexpected spot.');
	const cosine = 32 / Math.hypot(4, 32); const outer = Math.cos(10 * Math.PI / 180); const t = (cosine - outer) / (1 - outer);
	const response = 0.125 * cosine * t * t * (3 - 2 * t);
	near(pixel(await render([plane, { ...spot, coneAngle: motionScalar(20), coneFeather: motionScalar(1) }]), 20), [response, response, response, 1]);
	const black = solid('black', [0, 0, 0, 1]); near(pixel(await render([{ ...black, material: { ...black.material, specular: motionScalar(1), shininess: motionScalar(0) } }, light()])), [0.5, 0.5, 0.5, 1]);
	near(pixel(await render([plane, { ...spot, transform: { ...spot.transform, rotation: motionVector([0, 180, 0]) } }])), [0, 0, 0, 1]);
});

test('shadow rays use transparent caster coverage and cast/receive material switches', async () => {
	const receiverBase = solid('receiver', [1, 1, 1, 1]); const receiver = { ...receiverBase, transform: { ...receiverBase.transform, position: motionVector([0, 0, 32]) } };
	const casterBase = solid('caster', [0, 0, 0, 0.5]); if (casterBase.kind !== 'solid') throw new Error('Unexpected solid.');
	const caster = { ...casterBase, size: motionVector([8, 32]), transform: { ...casterBase.transform, position: motionVector([8, 0, 0]) }, material: { ...casterBase.material, castsShadows: true } };
	const source = light(); if (source.kind !== 'light') throw new Error('Unexpected light.');
	const point = { ...source, intensity: motionScalar(1), castsShadows: true, transform: { ...source.transform, position: motionVector([0, 16.5, -32]) } };
	const baseline = await render([caster, receiver, { ...point, castsShadows: false }]); const shadow = await render([caster, receiver, point]);
	assert.ok(pixel(baseline, 20)[0]! > 0.8); near(pixel(shadow, 20), [pixel(baseline, 20)[0]! / 2, pixel(baseline, 20)[1]! / 2, pixel(baseline, 20)[2]! / 2, 1]);
	near(pixel(await render([{ ...caster, material: { ...caster.material, castsShadows: false } }, receiver, point]), 20), pixel(baseline, 20));
	near(pixel(await render([caster, { ...receiver, material: { ...receiver.material, receivesShadows: false } }, point]), 20), pixel(baseline, 20));
});

test('parented lights, mirrored planes and active-light order are deterministic across seeks', async () => {
	const rig = createMotionLayer({ id: 'rig', name: 'Rig', durationFrames: 300, content: { kind: 'null' } }); const source = light();
	const layers = [solid(), { ...source, parentId: 'rig', transform: { ...source.transform, position: motionVector([16.5, 16.5, 0]) } },
		{ ...rig, is3D: true, transform: { ...rig.transform, position: motionVector([0, 0, -32]) } }];
	near(pixel(await render(layers)), [0.125, 0.125, 0.125, 1]);
	const mirror = solid(); near(pixel(await render([{ ...mirror, transform: { ...mirror.transform, position: motionVector([32, 0, 0]), scale: motionVector([-1, 1, 1]) } }, light()])), [0.125, 0.125, 0.125, 1]);
});

test('invalid lights/materials and excessive shadow work refuse before allocating the composition target', async () => {
	let allocations = 0; const compositor = { supportsReplacement: true, retainedSurfaceCount: 1 as const, begin() { allocations++; throw new Error('Must not allocate.'); } };
	const source = light(); if (source.kind !== 'light') throw new Error('Unexpected light.');
	await assert.rejects(renderMotionCompositionFrame(evaluate([solid(), { ...source, intensity: motionScalar(-1) }]), { rasterizer, compositor }), /intensity/u);
	const plane = solid(); await assert.rejects(renderMotionCompositionFrame(evaluate([{ ...plane, material: { ...plane.material, shininess: motionScalar(-1) } }, source]), { rasterizer, compositor }), /shininess/u);
	const budget = { ...evaluate([solid(), { ...source, castsShadows: true }]), width: 4096, height: 4096 };
	const first = budget.layers[0]!; const heavy = { ...budget, layers: [first, { ...first, state: { ...first.state, id: 'other', material: { ...first.state.material, castsShadows: true } } }, budget.layers[1]!] };
	await assert.rejects(renderMotionCompositionFrame(heavy, { rasterizer, compositor }), /ray.*budget/u); assert.equal(allocations, 0);
});
