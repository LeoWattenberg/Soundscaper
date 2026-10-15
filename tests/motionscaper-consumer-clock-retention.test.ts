/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import CanvasKitInit from 'canvaskit-wasm';
import { compileMotionscaperProject } from '../src/motionscaper/editor-project-evaluation.ts';
import { createMotionscaperRevision } from '../src/motionscaper/editor-project-revision.ts';
import { createMotionscaperRenderRequest } from '../src/motionscaper/editor-render-task.ts';
import { createMotionPreviewClient } from '../src/common/editor/controller/composition/motion-preview-client.ts';
import { createMotionPreviewRenderSession } from '../src/common/editor/controller/composition/motion-preview-render-session.ts';
import { renderMotionFrameSequence } from '../src/common/editor/controller/export/motion-render-pipeline.ts';
import { createCanvasKitMotionRasterizer } from '../src/common/editor/motion-canvaskit-rasterizer.ts';
import { createMotionCompositionOffer } from '../src/common/editor/motion-link-protocol.ts';
import { compileMotionCompositionLink, renderMotionCompositionLink } from '../src/common/editor/motion-link-rendering.ts';
import { motionSurfaceToRgba8 } from '../src/common/editor/motion-surface.ts';
import { createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import { createFramescaperCompositionSource } from '../src/framescaper/editor-composition-link-source.ts';
import { createFramescaperSuccessorRuntime } from '../src/framescaper/editor-project-successor-runtime.ts';
import { createFramescaperSuccessorProjectBinThumbnail } from '../src/framescaper/editor-composition-link-thumbnails.ts';
import type { MotionPreviewFrame } from '../src/common/editor/controller/composition/motion-preview-types.ts';
import { consumerClockProject, consumerClockCases, expectedConsumerPixels } from './helpers/motionscaper-consumer-clock-fixture.ts';

const noAsset = () => Promise.reject(new Error('This retained scene has no external media.'));

test('M03 nested mixed-rate remapping agrees with authored clocks and pixels across playback, shuffled seeks, export, links and thumbnails', async () => {
	const project = consumerClockProject(); const kit = await CanvasKitInit();
	const rasterizer = createCanvasKitMotionRasterizer(kit, { assets: [], fallbackFonts: [], loadAsset: noAsset });
	const acquire = async () => ({ rasterizer, async release() {} });
	const evaluator = compileMotionscaperProject(project);
	const order = [5, 0, 3, 1, 4, 2, 5, 0];
	for (const index of order) {
		const expected = consumerClockCases[index]!; const frame = evaluator.evaluate({ compositionId: 'main', time: expected.time });
		assert.deepEqual(frame.frame, { num: index, den: 1 }); assert.deepEqual(frame.samplePosition, expected.rootSample);
		const nested = frame.layers.find(layer => layer.state.id === 'nested')!;
		assert.deepEqual(nested.sourceTime, expected.sourceTime); assert.equal(nested.worldMatrix[12], 1);
		assert.deepEqual(nested.precomposition!.frame, expected.childFrame);
		assert.deepEqual(nested.precomposition!.samplePosition, { num: expected.childSample, den: 1 });
		const card = nested.precomposition!.layers.find(layer => layer.state.id === 'card')!;
		assert.equal(card.worldMatrix[12], 1); assert.equal(card.state.kind, 'solid');
		if (card.state.kind !== 'solid') throw new Error('Expected authored card.');
		assert.deepEqual(card.state.color, [...expected.rgb.map(value => value / 255), 1]);
	}
	let now = 0; const callbacks: (() => void)[] = []; const presented: MotionPreviewFrame[] = [];
	let notify: (() => void) | undefined;
	const client = await createMotionPreviewClient({
		backendFactory: () => Promise.resolve(createMotionPreviewRenderSession({ backend: 'host-cpu', maximumAssetBytes: 1024,
			maximumWorkingBytes: 1024 * 1024, loadRuntime: () => Promise.resolve({ kit, fallbackFonts: [] }) })),
		onFrame(frame) { presented.push(frame); notify?.(); }, onState() {},
		clock: { now: () => now, schedule(callback) { callbacks.push(callback); return callback; },
			cancel(token) { const index = callbacks.indexOf(token as () => void); if (index >= 0) callbacks.splice(index, 1); } },
	});
	try {
		await client.setProject(project, noAsset);
		for (const expected of consumerClockCases) {
			const received = new Promise<void>(resolve => { notify = resolve; });
			if (expected.frame === 0) client.play({ compositionId: 'main', startTime: 0, endTime: { num: 1001, den: 5000 } });
			else {
				// Move just inside the intended presentation interval; the client supplies the exact frame time.
				now = expected.frame * 1001 / 30 + 0.001; const tick = callbacks.shift(); assert.ok(tick); tick();
			}
			await received; notify = undefined;
			const frame = presented.at(-1)!; assert.deepEqual(frame.time, expected.time);
			assert.deepEqual(frame.rgba, expectedConsumerPixels(expected.frame));
			await new Promise<void>(resolve => setImmediate(resolve));
		}
		client.pause();
		for (const index of order) {
			await client.seek({ compositionId: 'main', time: consumerClockCases[index]!.time });
			assert.deepEqual(presented.at(-1)!.rgba, expectedConsumerPixels(index));
		}
	} finally { client.dispose(); }
	const exported: number[] = [];
	const result = await renderMotionFrameSequence(createMotionscaperRenderRequest({ project, compositionId: 'main', acquire,
		sink: { async write(frame) {
			assert.deepEqual(frame.time, consumerClockCases[frame.index]!.time);
			assert.deepEqual(motionSurfaceToRgba8(frame.surface, 'srgb'), expectedConsumerPixels(frame.index)); exported.push(frame.index);
		}, async finish() { return 'complete'; }, async abort() { assert.fail('The authored render must not abort.'); } },
	}));
	assert.equal(result.output, 'complete'); assert.deepEqual(exported, [0, 1, 2, 3, 4, 5]);
	const offer = createMotionCompositionOffer('main', createMotionscaperRevision(project)); const link = compileMotionCompositionLink(offer);
	const linked = createFramescaperCompositionSource({ sourceId: 'linked', offer, sampleRate: 48000 });
	const clip = { kind: 'video', id: 'clip', sourceId: 'linked', title: 'Nested', sequenceId: 'seq', sequenceStartFrame: 0,
		sequenceFrameCount: 6, sourceInFrame: 0, sourceFrameCount: 6, retimeMap: null, videoComposition: DEFAULT_VIDEO_CLIP_COMPOSITION };
	const receiver = { ...createFramescaperSuccessorRuntime({ line: 'successor' }).createProject({ sources: [linked.source], clips: [clip],
		projectBin: { clips: consumerClockCases.map(({ frame }) => ({ ...clip, id: `bin-${frame}`, sourceInFrame: frame,
			sourceFrameCount: 6 - frame, sequenceFrameCount: 6 - frame })) }, tracks: [createVideoTrack({ id: 'track', clipIds: ['clip'] })],
		sequences: [{ id: 'seq', rate: offer.output.frameRate, trackIds: ['track'] }], primarySequenceId: 'seq' }), compositionLinks: [linked.link] };
	const store = { loadMediaAsset: noAsset, loadSource: noAsset } as never;
	for (const index of order) {
		const expected = consumerClockCases[index]!;
		const rendered = await renderMotionCompositionLink(link, expected.time, { purpose: 'final', acquire });
		assert.deepEqual(rendered.time, expected.time); assert.equal(rendered.identity.revisionDigest, offer.revision.digest);
		assert.deepEqual(motionSurfaceToRgba8(rendered.surface, 'srgb'), expectedConsumerPixels(index));
		const thumbnail = await createFramescaperSuccessorProjectBinThumbnail({ project: receiver, store, acquire,
			clipId: `bin-${index}`, width: 6, height: 2 });
		assert.ok(thumbnail); assert.deepEqual([...thumbnail.pixels], [...expectedConsumerPixels(index)]);
	}
});
