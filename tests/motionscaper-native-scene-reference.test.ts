/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import CanvasKitInit from 'canvaskit-wasm';
import { createMotionNativeScene, renderMotionNativeSceneReference } from '../desktop/motionscaper-native-scene-reference.ts';
import { compileMotionscaperProject } from '../src/motionscaper/editor-project-evaluation.ts';
import { motionVector } from '../src/common/editor/motion-property.ts';
import { createMotionCamera, projectMotionCameraPoint } from '../src/common/editor/motion-camera.ts';
import { createMotionPreviewRenderSession } from '../src/common/editor/controller/composition/motion-preview-render-session.ts';
import { createMotionscaperRenderRequest } from '../src/motionscaper/editor-render-task.ts';
import { renderMotionFrameSequence } from '../src/common/editor/controller/export/motion-render-pipeline.ts';
import { createCanvasKitMotionRasterizer } from '../src/common/editor/motion-canvaskit-rasterizer.ts';
import { motionSurfaceToRgba8 } from '../src/common/editor/motion-surface.ts';

test('native scene reference visibly exercises camera, light, shadow, shutter and lens quality', async () => {
	const project = createMotionNativeScene(); const image = await renderMotionNativeSceneReference(project, 1);
	for (const omit of ['camera', 'light', 'shadow', 'shutter', 'lens'] as const) {
		const alternate = await renderMotionNativeSceneReference(createMotionNativeScene(omit), 1);
		assert.notDeepEqual(image.pixels, alternate.pixels, `${omit} must change rendered reference pixels`);
	}
	assert.notDeepEqual(image.pixels, (await renderMotionNativeSceneReference(project, 2)).pixels);
	assert.ok(image.pixels.some((value, i) => i % 4 === 3 && value > 0 && value < 1));
	assert.ok(image.pixels.some((value, i) => i % 4 === 3 && value === 0));
});

test('native reference camera animation has independently calculated world and projection values after arbitrary seeks', () => {
	const project = createMotionNativeScene(); const evaluator = compileMotionscaperProject(project);
	for (const frame of [1, 2, 0, 2, 1]) {
		const view = createMotionCamera(evaluator.evaluate({ compositionId: 'main', time: { num: frame * 1001, den: 30000 } }));
		assert.deepEqual(view.world.slice(12, 15), [32 + frame * 2, 24, -64]);
		assert.deepEqual(projectMotionCameraPoint(view, [32, 24, 0])!.point, [32 - frame * 2, 24]);
	}
});

test('native camera motion changes reference pixels with the caster frozen and a frozen camera removes that change', async () => {
	const base = createMotionNativeScene(); const composition = base.compositions[0]!;
	const stillSubjects = { ...base, compositions: [{ ...composition, layers: composition.layers.map(layer => layer.id === 'caster'
		? { ...layer, transform: { ...layer.transform, position: motionVector([12, 12, 0]) } } : layer) }] };
	const live = await renderMotionNativeSceneReference(stillSubjects, 1);
	assert.notDeepEqual(live.pixels, (await renderMotionNativeSceneReference(stillSubjects, 2)).pixels, 'Moving caster cannot satisfy the camera-motion reference.');
	const frozenCamera = { ...stillSubjects, compositions: [{ ...stillSubjects.compositions[0]!, layers: stillSubjects.compositions[0]!.layers.map(layer => layer.kind === 'camera'
		? { ...layer, transform: { ...layer.transform, position: motionVector([34, 24, -64]) } } : layer) }] };
	const frozen = await renderMotionNativeSceneReference(frozenCamera, 1);
	assert.deepEqual(frozen.pixels, (await renderMotionNativeSceneReference(frozenCamera, 2)).pixels);
});

test('animated native camera reference matches full-quality preview and sequential export after arbitrary seeks', async () => {
	const project = createMotionNativeScene(), runtime = CanvasKitInit().then(kit => ({ kit, fallbackFonts: [] }));
	const loaded = await runtime, signal = new AbortController().signal;
	const loadAsset = () => Promise.reject(new Error('The camera fixture has no external assets.'));
	const expected = new Map(await Promise.all([1, 2].map(async frame => [frame, motionSurfaceToRgba8(await renderMotionNativeSceneReference(project, frame), 'srgb')] as const)));
	const preview = createMotionPreviewRenderSession({ backend: 'host-cpu', maximumAssetBytes: 1024, maximumWorkingBytes: 8 * 1024 * 1024, loadRuntime: () => runtime });
	let releases = 0; const delivered: Uint8ClampedArray[] = [];
	try {
		await preview.setProject(project, loadAsset, signal);
		for (const frame of [2, 1, 2, 1]) {
			const output = await preview.render({ compositionId: 'main', time: { num: frame * 1001, den: 30000 }, generation: frame }, signal);
			assert.deepEqual(output.rgba, expected.get(frame));
		}
		await renderMotionFrameSequence(createMotionscaperRenderRequest({ project, compositionId: 'main', firstFrame: 1, endFrame: 3,
			acquire: () => Promise.resolve({ rasterizer: createCanvasKitMotionRasterizer(loaded.kit, { assets: [], fallbackFonts: [], loadAsset }), release: () => { releases++; return Promise.resolve(); } }),
			sink: { write(output) { delivered.push(motionSurfaceToRgba8(output.surface, 'srgb')); return Promise.resolve(); }, finish: () => Promise.resolve('done'), abort: () => { assert.fail('Camera delivery must complete.'); } },
		}));
		assert.deepEqual(delivered, [expected.get(1), expected.get(2)]); assert.equal(releases, 1);
	} finally { preview.dispose(); }
});
