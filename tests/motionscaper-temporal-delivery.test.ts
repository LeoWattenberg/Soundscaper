/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import CanvasKitInit from 'canvaskit-wasm';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { createMotionPreviewRenderSession } from '../src/common/editor/controller/composition/motion-preview-render-session.ts';
import { createMotionscaperRenderRequest } from '../src/motionscaper/editor-render-task.ts';
import { renderMotionFrameSequence } from '../src/common/editor/controller/export/motion-render-pipeline.ts';
import { createCanvasKitMotionRasterizer } from '../src/common/editor/motion-canvaskit-rasterizer.ts';
import { motionSurfaceToRgba8 } from '../src/common/editor/motion-surface.ts';
import { motionColor, motionVector } from '../src/common/editor/motion-property.ts';
const r = (num: number, den = 1) => ({ num, den });
const signal = () => new AbortController().signal;
const runtime = CanvasKitInit().then(kit => ({ kit, fallbackFonts: [] }));
const noAsset = () => Promise.reject(new Error('No retained source expected'));
function fixture() {
	const project = createMotionscaperProject({ id: 'p', title: 'Shutter', compositionId: 'main', width: 16, height: 8 });
	const source = createMotionLayer({ id: 'source', name: 'Source', durationFrames: 300, content: { kind: 'solid', size: motionVector([4, 8]), color: motionColor([1, 0, 0, 1]) } });
	const layer = { ...source, transform: { ...source.transform, position: { ...motionVector([0, 0, 0]), expression: { source: '[frame * 4, 0, 0]', enabled: true, references: [] } } } };
	return { ...project, compositions: [{ ...project.compositions[0]!, temporal: { shutterOpenFrames: r(-1, 2), shutterCloseFrames: r(1, 2), samples: 4 }, layers: [layer] }] };
}
test('M09 host preview and export average the same authored shutter while explicit preview reduction is distinguishable', async () => {
	const project = fixture(); const loaded = await runtime;
	const preview = createMotionPreviewRenderSession({ backend: 'host-cpu', maximumAssetBytes: 1024, maximumWorkingBytes: 1024 * 1024, loadRuntime: () => runtime });
	let pixels: Uint8ClampedArray | null = null; let ledger: readonly string[] = [];
	try {
		await preview.setProject(project, noAsset, signal());
		const blurred = await preview.render({ compositionId: 'main', time: r(1, 30), generation: 1 }, signal());
		const reduced = await preview.render({ compositionId: 'main', time: r(1, 30), generation: 2, quality: { temporalSamples: 1 } }, signal());
		assert.notDeepEqual(blurred.rgba, reduced.rgba); assert.ok([...blurred.rgba].some((value, index) => index % 4 === 3 && value > 0 && value < 255));
		const request = createMotionscaperRenderRequest({ project, compositionId: 'main', firstFrame: 1, endFrame: 2,
			acquire: async () => ({ rasterizer: createCanvasKitMotionRasterizer(loaded.kit, { assets: [], fallbackFonts: [], loadAsset: noAsset }), release: () => Promise.resolve() }),
			sink: { write: output => { pixels = motionSurfaceToRgba8(output.surface, 'srgb'); ledger = output.surface.consumedOperationIds; return Promise.resolve(); }, finish: () => Promise.resolve('done'), abort: () => Promise.resolve() },
		});
		await renderMotionFrameSequence(request); assert.deepEqual(pixels, blurred.rgba); assert.ok(ledger.some(id => id.startsWith('sample:3/')));
	} finally { preview.dispose(); }
});
test('M09 excessive temporal pixel work refuses preview and export before runtime or source acquisition', async () => {
	const source = fixture(); const project = { ...source, compositions: [{ ...source.compositions[0]!, width: 4096, height: 4096, temporal: { ...source.compositions[0]!.temporal, samples: 64 } }] };
	let acquired = 0; const preview = createMotionPreviewRenderSession({ backend: 'host-cpu', maximumAssetBytes: 1024, maximumWorkingBytes: 1024, loadRuntime: () => { acquired++; return runtime; } });
	try {
		await preview.setProject(project, noAsset, signal());
		await assert.rejects(preview.render({ compositionId: 'main', time: r(0), generation: 1 }, signal()), /temporal.*budget|pixel.*budget/iu);
		assert.throws(() => createMotionscaperRenderRequest({ project, compositionId: 'main', firstFrame: 0, endFrame: 1,
			acquire: async () => { acquired++; throw new Error('No acquire expected'); }, sink: { write: () => Promise.resolve(), finish: () => Promise.resolve('done'), abort: () => Promise.resolve() },
		}), /temporal.*budget|pixel.*budget/iu); assert.equal(acquired, 0);
	} finally { preview.dispose(); }
});
