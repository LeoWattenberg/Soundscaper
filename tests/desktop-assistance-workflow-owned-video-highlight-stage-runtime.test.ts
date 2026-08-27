/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, relative } from 'node:path';
import test from 'node:test';

import {
	ASSISTANCE_WORKFLOW_OWNED_VIDEO_HIGHLIGHT_STAGE_IDS,
	createAssistanceWorkflowOwnedVideoHighlightStageRuntime,
} from '../desktop/assistance-workflow-owned-video-highlight-stage-runtime.ts';
import { createAssistanceHeldFramePlanStoreV1 } from
	'../desktop/assistance-held-frame-plan-store.ts';
import { openAssistanceOnnxVisualFrameSourceV1 } from
	'../desktop/assistance-onnx-visual-frame-source.ts';
import {
	createAssistanceEmbeddingMatrixV1,
	createAssistanceFramePackV1,
} from '../src/common/editor/assistance/binary-formats-v1.ts';
import { reviewAssistanceVisualFramePackInventory } from
	'../src/common/editor/assistance/visual-frame-pack-set-v1.ts';
import type { AssistanceOwnedFramePackPlanV1 } from
	'../src/common/editor/assistance/owned-video-highlight-transform-types-v1.ts';
import { defaultAssistanceWorkflowSettingsV1 } from
	'../src/common/editor/assistance/workflow-settings-v1.ts';
import {
	reviewFramescaperAssistanceHighlightsV1,
} from '../src/framescaper/editor-local-assistance-highlight-review.ts';
import {
	digest,
	highlightAudioSignals,
	highlightVideoSignals,
	saliencyMap,
	selectedVideoAuthority,
	shotBoundaries,
	subjectDetections,
	withDirectory,
	workflowHarness,
} from './fixtures/desktop-assistance-workflow-owned-video-highlight-stage-runtime.ts';

const MATRIX_MEDIA = 'application/vnd.soundscaper.embedding-matrix-v1';

test('the main bridge executes all seven closed transforms through authenticated custody', async () => {
	assert.deepEqual(ASSISTANCE_WORKFLOW_OWNED_VIDEO_HIGHLIGHT_STAGE_IDS, [
		'sample-shot-frames', 'publish-video-index', 'track-subjects', 'plan-crops',
		'gather-signals', 'rank-highlights', 'assemble-highlights',
	]);
	await withDirectory(async (directory) => {
		const indexSettings = defaultAssistanceWorkflowSettingsV1('index-video');
		if (indexSettings.workflowId !== 'index-video') assert.fail('Index settings changed identity.');
		const index = await workflowHarness(directory, 'index-video', {
			settings: { ...indexSettings, includeOcr: false },
			bodies: {
				'sample-shot-frames:video': Uint8Array.of(0, 0, 0, 20, 102, 116, 121, 112),
				'sample-shot-frames:video-authority': selectedVideoAuthority(
					digest(Uint8Array.of(0, 0, 0, 20, 102, 116, 121, 112))),
				'sample-shot-frames:shot-boundaries': shotBoundaries(),
				'publish-video-index:visual-embeddings': createAssistanceEmbeddingMatrixV1({
					dimensions: 2, vectors: [[1, 0]],
				}),
			},
		});
		const originalVideoPath = index.inputPath('sample-shot-frames', 'video');
		let decodedVideoPath = '';
		const materializer = {
			materializeFramePack: async ({ plan, source }: Readonly<{ plan: AssistanceOwnedFramePackPlanV1;
				source: { path: string } }>) => {
				decodedVideoPath = source.path;
				assert.notEqual(source.path, originalVideoPath);
				assert.doesNotMatch(relative(dirname(originalVideoPath), source.path), /^\.\.(?:[/\\]|$)/u,
					'the disposable snapshot must remain inside staged job custody');
				await writeFile(originalVideoPath, Uint8Array.of(9, 9, 9, 9, 9, 9, 9, 9));
				assert.deepEqual([...await readFile(source.path)], [0, 0, 0, 20, 102, 116, 121, 112]);
				return [createAssistanceFramePackV1({ width: plan.width, height: plan.height,
					timescale: plan.timescale, frames: plan.frames.map((frame) => ({
						sourceFrame: frame.sourceFrame, presentationTick: frame.presentationTick,
						rgba: Uint8Array.of(1, 2, 3, 255),
					})) })];
			},
			resolveVisualTags: ({ plan }: Readonly<{ plan: AssistanceOwnedFramePackPlanV1 }>) =>
				({ matrix: createAssistanceEmbeddingMatrixV1({ dimensions: 2, vectors: [[1, 0]] }),
					tags: plan.frames.map(({ resultId }) => ({ resultId, tags: [] })) }),
		};
		const indexHandlers = createAssistanceWorkflowOwnedVideoHighlightStageRuntime({
			custody: index.custody, materializer,
		});
		assert.deepEqual(await indexHandlers['sample-shot-frames'](
			index.execution('sample-shot-frames'),
		), { outcome: 'completed' });
		await assert.rejects(stat(decodedVideoPath));
		const frameBytes = await readFile(index.outputPath('sample-shot-frames', 'frame-pack'));
		const reviewedFrames = reviewAssistanceVisualFramePackInventory(frameBytes);
		assert.equal(reviewedFrames.length, 1);
		assert.equal(reviewedFrames[0]!.frameCount, 1);
		assert.equal(new TextDecoder().decode(frameBytes).includes('frame-pack-plan'), false);
		assert.deepEqual(await indexHandlers['publish-video-index'](
			index.execution('publish-video-index'),
		), { outcome: 'completed' });
		const videoIndex = await index.jsonOutput('publish-video-index', 'video-index') as {
			kind: string; embedding: { rowCount: number };
		};
		assert.equal(videoIndex.kind, 'video-index');
		assert.equal(videoIndex.embedding.rowCount, 1);

		const reframe = await workflowHarness(directory, 'reframe', { bodies: {
			'track-subjects:subject-tracks': subjectDetections(),
			'plan-crops:saliency-map': saliencyMap(),
		} });
		const reframeHandlers = createAssistanceWorkflowOwnedVideoHighlightStageRuntime({
			custody: reframe.custody,
		});
		assert.deepEqual(await reframeHandlers['track-subjects'](
			reframe.execution('track-subjects'),
		), { outcome: 'completed' });
		assert.deepEqual(await reframeHandlers['plan-crops'](
			reframe.execution('plan-crops'),
		), { outcome: 'completed' });
		assert.equal((await reframe.jsonOutput('plan-crops', 'reframe-path') as { kind: string }).kind,
			'reframe-path');

		const highlights = await workflowHarness(directory, 'make-highlights', { bodies: {
			'gather-signals:video': highlightVideoSignals(),
			'gather-signals:audio': highlightAudioSignals(),
			'gather-signals:shot-boundaries': { ...shotBoundaries(), timescale: 1 },
		} });
		const highlightHandlers = createAssistanceWorkflowOwnedVideoHighlightStageRuntime({
			custody: highlights.custody,
		});
		for (const stageId of ['gather-signals', 'rank-highlights', 'assemble-highlights'] as const) {
			assert.deepEqual(await highlightHandlers[stageId](highlights.execution(stageId)),
				{ outcome: 'completed' });
		}
		const publication = reviewFramescaperAssistanceHighlightsV1(
			await highlights.jsonOutput('assemble-highlights', 'highlight-proposals'),
		);
		assert.deepEqual(publication.fence, highlights.request.fence);
		assert.deepEqual(publication.proposals.map(({ selected }) => selected), [false]);
		assert.deepEqual(index.progress, [
			[1, 4], [2, 4], [3, 4], [4, 4], [1, 4], [2, 4], [3, 4], [4, 4],
		]);
	});
});

test('shot sampling is typed unavailable without real RGBA materialization', async () => {
	await withDirectory(async (directory) => {
		const harness = await workflowHarness(directory, 'index-video', { bodies: {
			'sample-shot-frames:video': Uint8Array.of(1, 2, 3),
			'sample-shot-frames:video-authority': selectedVideoAuthority(
				digest(Uint8Array.of(1, 2, 3))),
			'sample-shot-frames:shot-boundaries': shotBoundaries(),
		} });
		const handlers = createAssistanceWorkflowOwnedVideoHighlightStageRuntime({
			custody: harness.custody,
			materializer: {},
		});
		assert.deepEqual(await handlers['sample-shot-frames'](
			harness.execution('sample-shot-frames'),
		), { outcome: 'unavailable', reason: 'stage-unavailable' });
		assert.equal(harness.openCount, 0);
		assert.deepEqual(harness.authenticated, []);
		await assert.rejects(stat(harness.outputPath('sample-shot-frames', 'frame-pack')));
	});
});

test('held frame-plan custody is one-shot, abort-safe, and evicts stale capacity', () => {
	const store = createAssistanceHeldFramePlanStoreV1<object>(2);
	const firstSignal = new AbortController();
	assert.equal(store.reserve('job-a', 'identity-a')!.commit({ plan: 'a' }, firstSignal.signal), true);
	assert.equal(store.size, 1);
	firstSignal.abort();
	assert.equal(store.size, 0);

	const second = { plan: 'b' };
	assert.equal(store.reserve('job-b', 'identity-b')!.commit(second,
		new AbortController().signal), true);
	assert.equal(store.take('job-b', 'wrong-identity'), null);
	assert.equal(store.take('job-b', 'identity-b'), second);
	assert.equal(store.take('job-b', 'identity-b'), null);

	for (const suffix of ['c', 'd']) {
		assert.equal(store.reserve(`job-${suffix}`, `identity-${suffix}`)!.commit({ plan: suffix },
			new AbortController().signal), true);
	}
	const replacement = store.reserve('job-e', 'identity-e');
	assert.ok(replacement, 'one stale held plan must be evicted instead of leaking the capacity cap');
	replacement.release();
	assert.equal(store.take('job-c', 'identity-c'), null);
	assert.deepEqual(store.take('job-d', 'identity-d'), { plan: 'd' });
});

test('failed video-index publication consumes its exact held frame plan', async () => {
	await withDirectory(async (directory) => {
		const video = Uint8Array.of(0, 0, 0, 20, 102, 116, 121, 112);
		const settings = defaultAssistanceWorkflowSettingsV1('index-video');
		if (settings.workflowId !== 'index-video') assert.fail('Index settings changed identity.');
		const harness = await workflowHarness(directory, 'index-video', { settings: {
			...settings, includeOcr: false,
		}, bodies: {
			'sample-shot-frames:video': video,
			'sample-shot-frames:video-authority': selectedVideoAuthority(digest(video)),
			'sample-shot-frames:shot-boundaries': shotBoundaries(),
			'publish-video-index:visual-embeddings': createAssistanceEmbeddingMatrixV1({
				dimensions: 2, vectors: [[1, 0]],
			}),
		} });
		const handlers = createAssistanceWorkflowOwnedVideoHighlightStageRuntime({
			custody: harness.custody,
			materializer: {
				materializeFramePack: ({ plan }) => [createAssistanceFramePackV1({ width: plan.width,
					height: plan.height, timescale: plan.timescale,
					frames: plan.frames.map(({ sourceFrame, presentationTick }) => ({ sourceFrame,
						presentationTick, rgba: Uint8Array.of(0, 0, 0, 255) })) })],
				resolveVisualTags() { throw new Error('fixture tag failure'); },
			},
		});
		assert.deepEqual(await handlers['sample-shot-frames'](
			harness.execution('sample-shot-frames')), { outcome: 'completed' });
		await assert.rejects(async () => await handlers['publish-video-index'](
			harness.execution('publish-video-index')), /fixture tag failure/u);
		assert.deepEqual(await handlers['publish-video-index'](
			harness.execution('publish-video-index')),
		{ outcome: 'unavailable', reason: 'stage-unavailable' });
	});
});

test('guided dense-shot sampling crosses one producer as ordered strict frame packs', async () => {
	await withDirectory(async (directory) => {
		const shotCount = 342;
		const shotFrames = 13;
		const sourceEndFrame = shotCount * shotFrames;
		const video = Uint8Array.of(1, 3, 3, 7);
		const authority = { ...selectedVideoAuthority(digest(video)), sourceEndFrame, timescale: 1,
			selectionEndFrame: sourceEndFrame * 48_000,
			frames: Array.from({ length: sourceEndFrame + 1 }, (_, sourceFrame) => ({
				sourceFrame, presentationTick: String(sourceFrame), timelineFrame: sourceFrame * 48_000,
			})) };
		const boundaries = Array.from({ length: shotCount - 1 }, (_, index) => {
			const sourceFrame = (index + 1) * shotFrames;
			return { sourceFrame, presentationTick: String(sourceFrame), score: 1 };
		});
		const harness = await workflowHarness(directory, 'index-video', {
			videoSourceEndFrame: sourceEndFrame,
			bodies: {
				'sample-shot-frames:video': video,
				'sample-shot-frames:video-authority': authority,
				'sample-shot-frames:shot-boundaries': {
					schemaVersion: 1, detector: 'ffmpeg-scdet', timescale: 1,
					sourceFrameCount: sourceEndFrame, boundaries,
				},
			},
		});
		const handlers = createAssistanceWorkflowOwnedVideoHighlightStageRuntime({
			custody: harness.custody,
			materializer: { materializeFramePack: ({ plan }) => Object.freeze([
				plan.frames.slice(0, 1_024), plan.frames.slice(1_024),
			].filter((frames) => frames.length > 0).map((frames) => createAssistanceFramePackV1({
				width: plan.width, height: plan.height, timescale: plan.timescale,
				frames: frames.map(({ sourceFrame, presentationTick }) => ({
					sourceFrame, presentationTick, rgba: Uint8Array.of(0, 0, 0, 255),
				})),
			}))) },
		});
		assert.deepEqual(await handlers['sample-shot-frames'](
			harness.execution('sample-shot-frames')),
		{ outcome: 'completed' });
		const path = harness.outputPath('sample-shot-frames', 'frame-pack');
		const body = await readFile(path);
		const file = await stat(path);
		const packs = reviewAssistanceVisualFramePackInventory(body);
		assert.deepEqual(packs.map(({ frameCount }) => frameCount), [1_024, 2]);
		const source = await openAssistanceOnnxVisualFrameSourceV1([{
			claimId: '11'.repeat(20),
			role: 'frame-pack', mediaType: 'application/vnd.soundscaper.frame-pack',
			byteLength: file.size, sha256: digest(body), path,
			identity: { dev: Number(file.dev), ino: Number(file.ino) },
		}]);
		try {
			assert.equal(source.frameCount, 1_026);
			assert.ok((await source.readFrame(1_024)).sourceFrame
				> (await source.readFrame(1_023)).sourceFrame);
		} finally { source.release(); }
	});
});

test('the bridge rechecks media, bounds, digests, and output reservations before publication', async () => {
	await withDirectory(async (directory) => {
		const corrupt = await workflowHarness(directory, 'reframe', { bodies: {
			'track-subjects:subject-tracks': subjectDetections(),
		} });
		await writeFile(corrupt.inputPath('track-subjects', 'subject-tracks'), '{}');
		const handlers = createAssistanceWorkflowOwnedVideoHighlightStageRuntime({
			custody: corrupt.custody,
		});
		await assert.rejects(async () => await handlers['track-subjects'](
			corrupt.execution('track-subjects')),
			/digest|length|changed|stale/iu);
		assert.equal(corrupt.openCount, 0);

		const tooSmall = await workflowHarness(directory, 'reframe', {
			bodies: { 'track-subjects:subject-tracks': subjectDetections() },
			maximumOutputBytes: 8,
		});
		const bounded = createAssistanceWorkflowOwnedVideoHighlightStageRuntime({
			custody: tooSmall.custody,
		});
		await assert.rejects(async () => await bounded['track-subjects'](
			tooSmall.execution('track-subjects')),
			/reservation|exceeds/iu);
		assert.equal(tooSmall.openCount, 0);
		assert.deepEqual(tooSmall.authenticated, []);

		const wrongMedia = await workflowHarness(directory, 'reframe', { bodies: {
			'track-subjects:subject-tracks': subjectDetections(),
		} });
		wrongMedia.mediaOverride = MATRIX_MEDIA;
		const mediaHandlers = createAssistanceWorkflowOwnedVideoHighlightStageRuntime({
			custody: wrongMedia.custody,
		});
		await assert.rejects(async () => await mediaHandlers['track-subjects'](
			wrongMedia.execution('track-subjects')),
		/media|custody/iu);
	});
});

test('materialized semantics remain inside the exact aggregate source fence', async () => {
	await withDirectory(async (directory) => {
		const harness = await workflowHarness(directory, 'index-video', { bodies: {
			'sample-shot-frames:video': Uint8Array.of(1, 2, 3),
			'sample-shot-frames:video-authority': {
				...selectedVideoAuthority(digest(Uint8Array.of(1, 2, 3))),
				sourceId: 'outside-fence',
			},
			'sample-shot-frames:shot-boundaries': shotBoundaries(),
		} });
		const handlers = createAssistanceWorkflowOwnedVideoHighlightStageRuntime({
			custody: harness.custody,
			materializer: {
				materializeFramePack: ({ plan }) => [createAssistanceFramePackV1({
					width: plan.width, height: plan.height, timescale: plan.timescale,
					frames: plan.frames.map((frame) => ({ sourceFrame: frame.sourceFrame,
						presentationTick: frame.presentationTick, rgba: Uint8Array.of(0, 0, 0, 255) })),
				})],
			},
		});
		await assert.rejects(async () => await handlers['sample-shot-frames'](
			harness.execution('sample-shot-frames')),
		/source|fence|authority/iu);
		assert.equal(harness.openCount, 0);
		assert.deepEqual(harness.authenticated, []);
	});
});

test('cancellation and stale stage identity cannot publish', async () => {
	await withDirectory(async (directory) => {
		const cancelled = await workflowHarness(directory, 'reframe', { bodies: {
			'track-subjects:subject-tracks': subjectDetections(),
		} });
		const controller = new AbortController();
		controller.abort(new DOMException('cancelled', 'AbortError'));
		const handlers = createAssistanceWorkflowOwnedVideoHighlightStageRuntime({
			custody: cancelled.custody,
		});
		await assert.rejects(async () => await handlers['track-subjects'](
			cancelled.execution('track-subjects', controller.signal)), /cancelled/iu);
		assert.equal(cancelled.openCount, 0);

		const stale = cancelled.execution('track-subjects');
		const staleExecution = { ...stale, stageIndex: stale.stageIndex + 1 };
		await assert.rejects(async () => await handlers['track-subjects'](staleExecution),
			/stale|uncorrelated/iu);
		const staleCustody = { ...stale, custody: { ...stale.custody, outputClaimIds: [] } };
		await assert.rejects(async () => await handlers['track-subjects'](staleCustody),
			/stale|uncorrelated|custody/iu);
		assert.equal(cancelled.openCount, 0);
	});
});
