/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import CanvasKitInit from 'canvaskit-wasm';
import { motionWavFixture } from './helpers/motion-media-fixture.ts';
import { prepareMotionMedia } from '../src/common/editor/motion-media-import.ts';
import { createMotionMediaProvider } from '../src/common/editor/motion-media-provider.ts';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperRevision } from '../src/common/editor/motion-project-revision.ts';
import { motionColor, motionScalar, motionVector } from '../src/common/editor/motion-property.ts';
import { createMotionPreviewRenderSession } from '../src/common/editor/controller/composition/motion-preview-render-session.ts';
import { createMotionExpressionAudioPreparation } from '../src/common/editor/motion-expression-audio-preparation.ts';
import { createMotionscaperRenderRequest } from '../src/motionscaper/editor-render-task.ts';
import { renderMotionFrameSequence } from '../src/common/editor/controller/export/motion-render-pipeline.ts';
import { createCanvasKitMotionRasterizer } from '../src/common/editor/motion-canvaskit-rasterizer.ts';
import { motionSurfaceToRgba8 } from '../src/common/editor/motion-surface.ts';
const runtime = CanvasKitInit().then((kit) => ({ kit, fallbackFonts: [] }));
const signal = () => new AbortController().signal;
async function fixture() {
	const bytes = motionWavFixture(); const imported = await prepareMotionMedia(new Blob([bytes]), { id: 'sound', name: 'Sound.wav' });
	const base = createMotionscaperProject({ id: 'p', title: 'Audio driven', compositionId: 'main', width: 8, height: 8, frameRate: { num: 25, den: 1 } });
	const layer = createMotionLayer({ id: 'solid', name: 'Solid', durationFrames: 300, content: { kind: 'solid', size: motionVector([8, 8]), color: motionColor([1, 0, 0, 1]) } });
	const revision = createMotionscaperRevision({ ...base, assets: [imported.asset], compositions: [{ ...base.compositions[0], layers: [{ ...layer, transform: { ...layer.transform, opacity: { ...motionScalar(1), expression: { source: 'audioAmplitude("sound", time, 0.02)', enabled: true, references: [] } } } }] }] });
	return { bytes, revision };
}

test('M08 host preview and backpressured export render identical PCM-driven pixels from one pinned source', async () => {
	const { bytes, revision } = await fixture(); const loaded = await runtime; const provider = createMotionMediaProvider({ loadAsset: () => Promise.resolve(bytes) });
	const preview = createMotionPreviewRenderSession({ backend: 'host-cpu', maximumAssetBytes: 1024 * 1024, maximumWorkingBytes: 1024 * 1024, loadRuntime: () => runtime });
	let exported: Uint8ClampedArray | null = null, released = 0;
	try {
		await preview.setProject(revision.project, () => Promise.resolve(bytes), signal());
		const frame = await preview.render({ compositionId: 'main', time: { num: 1, den: 25 }, generation: 1 }, signal());
		const expressionAudio = createMotionExpressionAudioPreparation({ project: revision.project, provider });
		const request = createMotionscaperRenderRequest({ project: revision.project, compositionId: 'main', firstFrame: 1, endFrame: 2,
			acquire: async () => ({ expressionAudio, rasterizer: createCanvasKitMotionRasterizer(loaded.kit, { assets: revision.project.assets, fallbackFonts: [], loadAsset: () => Promise.resolve(bytes) }),
				async release() { released++; expressionAudio.dispose(); } }),
			sink: { async write(output) { exported = motionSurfaceToRgba8(output.surface, 'srgb'); }, async finish() { return 'complete'; }, async abort() { assert.fail('No successful render abort'); } },
		});
		const result = await renderMotionFrameSequence(request); assert.equal(result.output, 'complete'); assert.equal(released, 1);
		assert.deepEqual(frame.rgba, exported); assert.ok(frame.rgba[3]! > 1 && frame.rgba[3]! < 254);
	} finally { preview.dispose(); provider.dispose(); }
});

test('M08 render lease refuses mismatched prepared analysis before writing or publishing any frame', async () => {
	const { bytes, revision } = await fixture(); const provider = createMotionMediaProvider({ loadAsset: () => Promise.resolve(bytes) });
	const expressionAudio = createMotionExpressionAudioPreparation({ project: { ...revision.project, revision: revision.revision + 1 }, provider }); let writes = 0, releases = 0, aborts = 0;
	const request = createMotionscaperRenderRequest({ project: revision.project, compositionId: 'main', firstFrame: 1, endFrame: 2,
		acquire: async () => ({ expressionAudio, rasterizer: { async rasterize() { throw new Error('No raster allocation expected'); } }, async release() { releases++; expressionAudio.dispose(); } }),
		sink: { async write() { writes++; }, async finish() { assert.fail('No publication'); }, async abort() { aborts++; } },
	});
	try { await assert.rejects(renderMotionFrameSequence(request), /revision|stale/iu); assert.deepEqual([writes, releases, aborts], [0, 1, 1]); }
	finally { provider.dispose(); expressionAudio.dispose(); }
});
