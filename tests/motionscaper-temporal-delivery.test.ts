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
import { motionColor, motionScalar, motionVector } from '../src/common/editor/motion-property.ts';
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

test('M09 nested authored lens quality survives a lower root setting in preview and final export', async () => {
	const loaded = await runtime; const base = createMotionscaperProject({ id: 'nested-focus', title: 'Nested focus', compositionId: 'main', width: 32, height: 32 });
	const card = createMotionLayer({ id: 'card', name: 'Card', durationFrames: 300, content: { kind: 'solid', size: motionVector([8, 8]), color: motionColor([1, 1, 1, 1]) } });
	const camera = createMotionLayer({ id: 'camera', name: 'Camera', durationFrames: 300, content: { kind: 'camera', projection: 'perspective', zoom: motionScalar(32), near: 1, far: 1000, focusDistance: motionScalar(32), aperture: motionScalar(16) } });
	const nested = { ...base.compositions[0]!, id: 'nested', depthOfFieldSamples: 16, layers: [{ ...card, is3D: true, transform: { ...card.transform, position: motionVector([12, 12, 32]) } }, { ...camera, transform: { ...camera.transform, position: motionVector([16, 16, -32]) } }] };
	const precomp = createMotionLayer({ id: 'precomp', name: 'Precomp', durationFrames: 300, content: { kind: 'precomp', compositionId: 'nested' } });
	const project = { ...base, compositions: [{ ...base.compositions[0]!, depthOfFieldSamples: 1, layers: [precomp] }, nested] };
	const preview = createMotionPreviewRenderSession({ backend: 'host-cpu', maximumAssetBytes: 1024, maximumWorkingBytes: 1024 * 1024, loadRuntime: () => runtime });
	try {
		await preview.setProject(project, noAsset, signal());
		const full = await preview.render({ compositionId: 'main', time: r(0), generation: 1 }, signal());
		const reduced = await preview.render({ compositionId: 'main', time: r(0), generation: 2, quality: { depthOfFieldSamples: 1 } }, signal());
		assert.notDeepEqual(full.rgba, reduced.rgba); let exported: Uint8ClampedArray | null = null;
		await renderMotionFrameSequence(createMotionscaperRenderRequest({ project, compositionId: 'main', firstFrame: 0, endFrame: 1,
			acquire: async () => ({ rasterizer: createCanvasKitMotionRasterizer(loaded.kit, { assets: [], fallbackFonts: [], loadAsset: noAsset }), release: () => Promise.resolve() }),
			sink: { write: output => { exported = motionSurfaceToRgba8(output.surface, 'srgb'); return Promise.resolve(); }, finish: () => Promise.resolve('done'), abort: () => Promise.resolve() },
		})); assert.deepEqual(exported, full.rgba);
	} finally { preview.dispose(); }
});
