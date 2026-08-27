/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	createLocalAssistanceSelectedVideoPreparation,
	resolveLocalAssistanceSelectedVideoAuthority,
} from '../src/common/editor/controller/local-assistance-selected-video.ts';
import {
	createLocalAssistanceSelectedVideoModelFramePack,
} from '../src/common/editor/controller/local-assistance-selected-video-model-preparation.ts';
import {
	createLocalAssistanceSelectedVideoSourceTimeDescriptorV1,
	findLocalAssistanceSelectedVideoSourceTimeBySourceFrameV1,
	findLocalAssistanceSelectedVideoSourceTimeByTimelineFrameV1,
	reviewLocalAssistanceSelectedVideoSourceTimeDescriptorV1,
} from '../src/common/editor/controller/local-assistance-selected-video-source-time.ts';
import { sequenceFrameBoundarySample } from '../src/common/editor/sequence-frame-navigation.ts';
import {
	registerVideoTimingIndex,
	unregisterVideoTimingIndex,
} from '../src/common/editor/video-source-time.ts';
import {
	createVideoTimingAssetPublication,
	validateVideoTimingAssetBytes,
} from '../src/common/editor/video-timing-asset.ts';

const VIDEO_BYTES = Uint8Array.of(1, 2, 3, 4, 5, 6);
const VIDEO_SHA256 = createHash('sha256').update(VIDEO_BYTES).digest('hex');
const FRAME_PACK = new Blob(['visual-frame-pack'], {
	type: 'application/vnd.soundscaper.frame-pack',
});

test('selected-video Reframe stages share deterministic 2 fps and accepted shot-anchor custody', async () => {
	const project = withAcceptedShotAnchor(baseProject(), 25);
	const requests: VisualRequest[] = [];
	const preparation = fixture(project, requests);
	assert.deepEqual((await preparation.listSelectedMedia()).sources[0]?.operations, [
		'shot-detection', 'image-text-embedding', 'optical-character-recognition',
		'subject-detection', 'saliency-detection',
	]);

	for (const [operation, outputRole, mediaType] of [
		['image-text-embedding', 'embeddings',
			'application/vnd.soundscaper.embedding-matrix-v1'],
		['optical-character-recognition', 'recognized-text',
			'application/vnd.soundscaper.recognized-text+json'],
		['subject-detection', 'subject-tracks'],
		['saliency-detection', 'saliency-map'],
	] as const) {
		const prepared = await preparation.prepareSelectedMedia({
			sourceId: 'video-source', operation,
		});
		assert.equal(prepared.operation, operation);
		assert.deepEqual(prepared.inputs.map(({ role, mediaType, bytes }) => ({
			role, mediaType, bytes,
		})), [{ role: 'frame-pack', mediaType: FRAME_PACK.type, bytes: FRAME_PACK }]);
		assert.deepEqual(prepared.outputs, [{ role: outputRole,
			mediaType: mediaType ?? `application/vnd.soundscaper.${outputRole}+json`,
			maximumByteLength: 64 * 1024 * 1024 }]);
	}

	assert.equal(requests.length, 4);
	for (const request of requests) {
		assert.deepEqual({ sourceWidth: request.sourceWidth, sourceHeight: request.sourceHeight,
			rasterWidth: request.rasterWidth, rasterHeight: request.rasterHeight }, {
			sourceWidth: 1_920, sourceHeight: 1_080, rasterWidth: 320, rasterHeight: 180,
		});
		assert.deepEqual(request.timing.frames.map(({ sourceFrame }) => sourceFrame), [
			20, 25, 32, 44, 56, 68, 80, 92, 104, 116,
		]);
		assert.deepEqual(request.timing.frames.map(({ presentationTick }) => presentationTick), [
			'20', '25', '32', '44', '56', '68', '80', '92', '104', '116',
		]);
	}
});

test('selected-video visual model preparation returns every bounded long-media pack in order', async () => {
	const requests: VisualRequest[] = [];
	const timing = { timescale: 24, frames: Array.from({ length: 1_025 }, (_, sourceFrame) => ({
		sourceFrame, presentationTick: String(sourceFrame + 1), timestampSeconds: sourceFrame / 2,
	})) };
	const prepared = await createLocalAssistanceSelectedVideoModelFramePack({
		createFramePack: (request) => {
			requests.push(request);
			return new Blob([new Uint8Array([requests.length])], { type: FRAME_PACK.type });
		},
	}, { operation: 'saliency-detection', body: videoBlob(), timing,
		sourceWidth: 1_920, sourceHeight: 1_080, signal: new AbortController().signal,
		assertCurrent() {}, maximumInputBytes: 8 * 1024 * 1024 * 1024 });
	assert.equal(requests.length, 2);
	assert.deepEqual(requests.map((request) => request.timing.frames.length), [1_024, 1]);
	assert.deepEqual(prepared.inputs.map(({ bytes }) => bytes.size), [1, 1]);
	assert.notStrictEqual(prepared.inputs[0]?.bytes, prepared.inputs[1]?.bytes);
});

test('selected-video Reframe preserves VFR source ticks under deterministic 2 fps sampling', async () => {
	const ticks = Array.from({ length: 240 }, (_, index) => BigInt(index * 100
		+ (index >= 24 ? 400 : 0)));
	const timing = createVideoTimingAssetPublication(VIDEO_SHA256, {
		timescale: 2_400, presentationTicks: ticks, finalFrameDurationTicks: 100n,
	});
	const project = withSource(baseProject(), {
		timingAsset: timing.reference,
		timingDecision: { mode: 'exact', rate: { num: 24, den: 1 }, backend: 'fixture' },
	});
	const source = project.sources[0]!;
	registerVideoTimingIndex(source, validateVideoTimingAssetBytes(timing.reference, timing.bytes));
	try {
		const requests: VisualRequest[] = [];
		await fixture(project, requests).prepareSelectedMedia({
			sourceId: 'video-source', operation: 'saliency-detection',
		});
		assert.deepEqual(requests[0]?.timing.frames.map(({ sourceFrame, presentationTick }) => ({
			sourceFrame, presentationTick,
		})), [
			{ sourceFrame: 20, presentationTick: '2000' },
			{ sourceFrame: 28, presentationTick: '3200' },
			{ sourceFrame: 40, presentationTick: '4400' },
			{ sourceFrame: 52, presentationTick: '5600' },
			{ sourceFrame: 64, presentationTick: '6800' },
			{ sourceFrame: 76, presentationTick: '8000' },
			{ sourceFrame: 88, presentationTick: '9200' },
			{ sourceFrame: 100, presentationTick: '10400' },
			{ sourceFrame: 112, presentationTick: '11600' },
		]);
	} finally {
		unregisterVideoTimingIndex(source);
	}
});

test('selected-video Reframe admits exact forward retime without rewriting source samples', async () => {
	const project = withClip(baseProject(), {
		sequenceFrameCount: 50,
		retimeMap: {
			feature: 'video-retime', version: 2,
			points: [
				{ outerFrame: 0, sourceFrame: { num: 20, den: 1 } },
				{ outerFrame: 50, sourceFrame: { num: 120, den: 1 } },
			],
			segments: [{ mode: 'constant-forward' }],
		},
	});
	const requests: VisualRequest[] = [];
	const prepared = await fixture(project, requests).prepareSelectedMedia({
		sourceId: 'video-source', operation: 'subject-detection',
	});
	assert.equal(prepared.selectionFence.sourceStartFrame, 20);
	assert.equal(resolveLocalAssistanceSelectedVideoAuthority({
		getProject: () => project, getSelectedClipId: () => 'video-clip',
	}).timingAuthority.mapping, 'forward-retime-v2');
	assert.deepEqual(requests[0]?.timing.frames.map(({ sourceFrame }) => sourceFrame), [
		20, 32, 44, 56, 68, 80, 92, 104, 116,
	]);
});

test('selected-video exposes frozen exact source/timeline boundary authority', () => {
	const project = baseProject();
	const authority = resolveLocalAssistanceSelectedVideoAuthority({
		getProject: () => project, getSelectedClipId: () => 'video-clip',
	});
	const descriptor = createLocalAssistanceSelectedVideoSourceTimeDescriptorV1(authority);
	assert.deepEqual({ kind: descriptor.kind, projectId: descriptor.projectId,
		projectRevision: descriptor.projectRevision, sequenceId: descriptor.sequenceId,
		videoOccurrenceId: descriptor.videoOccurrenceId, sourceId: descriptor.sourceId,
		sourceWidth: descriptor.sourceWidth, sourceHeight: descriptor.sourceHeight,
		sourceStartFrame: descriptor.sourceStartFrame, sourceEndFrame: descriptor.sourceEndFrame,
		sampleRate: descriptor.sampleRate, timescale: descriptor.timescale,
		selectionStartFrame: descriptor.selectionStartFrame,
		selectionEndFrame: descriptor.selectionEndFrame }, {
		kind: 'selected-video-source-time-authority', projectId: 'project-1', projectRevision: 7,
		sequenceId: 'main-sequence', videoOccurrenceId: 'video-clip', sourceId: 'video-source',
		sourceWidth: 1_920, sourceHeight: 1_080, sourceStartFrame: 20, sourceEndFrame: 120,
		sampleRate: 48_000, timescale: 24, selectionStartFrame: 20_000,
		selectionEndFrame: 220_000,
	});
	assert.equal(descriptor.frames.length, 101);
	assert.deepEqual(descriptor.frames[0], {
		sourceFrame: 20, presentationTick: '20', timelineFrame: 20_000,
	});
	assert.deepEqual(descriptor.frames.at(-1), {
		sourceFrame: 120, presentationTick: '120', timelineFrame: 220_000,
	});
	assert.ok(Object.isFrozen(descriptor));
	assert.ok(Object.isFrozen(descriptor.frames));
	assert.ok(Object.isFrozen(descriptor.frames[0]));
});

test('selected-video source/timeline authority canonicalizes forward-retime collisions', () => {
	const project = withClip(baseProject(), {
		sequenceFrameCount: 50,
		retimeMap: {
			feature: 'video-retime', version: 2,
			points: [
				{ outerFrame: 0, sourceFrame: { num: 20, den: 1 } },
				{ outerFrame: 50, sourceFrame: { num: 120, den: 1 } },
			],
			segments: [{ mode: 'constant-forward' }],
		},
	});
	const descriptor = createLocalAssistanceSelectedVideoSourceTimeDescriptorV1(
		resolveLocalAssistanceSelectedVideoAuthority({
			getProject: () => project, getSelectedClipId: () => 'video-clip',
		}),
	);
	const frames = descriptor.frames as readonly Readonly<{
		sourceFrame: number; timelineFrame: number;
	}>[];
	assert.deepEqual(frames.map(({ sourceFrame }) => sourceFrame),
		Array.from({ length: 51 }, (_, index) => 20 + index * 2));
	assert.deepEqual(frames.map(({ timelineFrame }) => timelineFrame),
		Array.from({ length: 51 }, (_, index) => 20_000 + index * 2_000));
});

test('selected-video source-time authority compactly binds more than 100,000 exact boundaries', () => {
	const frameCount = 100_001;
	const project = { ...baseProject(),
		selection: { ...baseProject().selection, endFrame: frameCount * 2_000 },
		sources: [{ ...baseProject().sources[0]!, sourceFrameCount: frameCount,
			sampleFrameCount: frameCount * 2_000 }],
		clips: [{ ...baseProject().clips[0]!, sequenceStartFrame: 0,
			sequenceFrameCount: frameCount, sourceInFrame: 0, sourceFrameCount: frameCount }],
	} as unknown as ReturnType<typeof baseProject>;
	const descriptor = createLocalAssistanceSelectedVideoSourceTimeDescriptorV1(
		resolveLocalAssistanceSelectedVideoAuthority({
			getProject: () => project, getSelectedClipId: () => 'video-clip',
		}),
	);
	assert.ok(descriptor.frames.length > 1 && descriptor.frames.length < 10);
	assert.equal((descriptor.frames[0] as { kind?: string }).kind, 'source-time-rows');
	const reviewed = reviewLocalAssistanceSelectedVideoSourceTimeDescriptorV1(
		JSON.parse(JSON.stringify(descriptor)),
	);
	assert.deepEqual(findLocalAssistanceSelectedVideoSourceTimeBySourceFrameV1(
		reviewed, 100_000), {
		sourceFrame: 100_000, presentationTick: '100000', timelineFrame: 200_000_000,
	});
	assert.deepEqual(findLocalAssistanceSelectedVideoSourceTimeByTimelineFrameV1(
		reviewed, 200_002_000), {
		sourceFrame: 100_001, presentationTick: '100001', timelineFrame: 200_002_000,
	});
	assert.equal(findLocalAssistanceSelectedVideoSourceTimeByTimelineFrameV1(
		reviewed, 200_001_999), null);
});

test('compact long authority round-trips exact VFR ticks through non-linear forward retime', () => {
	const frameCount = 100_000;
	const ticks = Array.from({ length: frameCount }, (_, sourceFrame) =>
		BigInt(sourceFrame * 100 + sourceFrame % 2));
	const timing = createVideoTimingAssetPublication(VIDEO_SHA256, {
		timescale: 2_400, presentationTicks: ticks, finalFrameDurationTicks: 100n,
	});
	const project = { ...baseProject(),
		selection: { ...baseProject().selection, endFrame: frameCount * 2_000 },
		sources: [{ ...baseProject().sources[0]!, sourceFrameCount: frameCount,
			sampleFrameCount: frameCount * 2_000, timingAsset: timing.reference,
			timingDecision: { mode: 'exact', rate: { num: 24, den: 1 }, backend: 'fixture' } }],
		clips: [{ ...baseProject().clips[0]!, sequenceStartFrame: 0,
			sequenceFrameCount: frameCount, sourceInFrame: 0, sourceFrameCount: frameCount,
			retimeMap: { feature: 'video-retime', version: 2,
				points: [
					{ outerFrame: 0, sourceFrame: { num: 0, den: 1 } },
					{ outerFrame: frameCount, sourceFrame: { num: frameCount, den: 1 } },
				], segments: [{ mode: 'ramp-forward',
					startVelocity: { num: 1, den: 2 },
					endVelocity: { num: 3, den: 2 } }] } }],
	} as unknown as ReturnType<typeof baseProject>;
	const source = project.sources[0]!;
	registerVideoTimingIndex(source, validateVideoTimingAssetBytes(timing.reference, timing.bytes));
	try {
		const authority = resolveLocalAssistanceSelectedVideoAuthority({
			getProject: () => project, getSelectedClipId: () => 'video-clip',
		});
		assert.equal(authority.timingAuthority.sourceTiming, 'vfr');
		assert.equal(authority.timingAuthority.mapping, 'forward-retime-v2');
		const descriptor = reviewLocalAssistanceSelectedVideoSourceTimeDescriptorV1(
			JSON.parse(JSON.stringify(createLocalAssistanceSelectedVideoSourceTimeDescriptorV1(
				authority,
			))),
		);
		assert.equal((descriptor.frames[0] as { kind?: string }).kind, 'source-time-rows');
		const midpoint = findLocalAssistanceSelectedVideoSourceTimeBySourceFrameV1(
			descriptor, 48_000,
		);
		assert.deepEqual(midpoint, {
			sourceFrame: 48_000, presentationTick: '4800000', timelineFrame: 120_000_000,
		}, 'an exact interior ramp point must retain its non-linear VFR timing');
		assert.deepEqual(findLocalAssistanceSelectedVideoSourceTimeByTimelineFrameV1(
			descriptor, 120_000_000), midpoint);
		assert.deepEqual(findLocalAssistanceSelectedVideoSourceTimeBySourceFrameV1(
			descriptor, frameCount), {
			sourceFrame: frameCount, presentationTick: '10000001', timelineFrame: 200_000_000,
		});
	} finally { unregisterVideoTimingIndex(source); }
});

test('selected-video Reframe rejects stale shot timing and propagates cancellation before custody', async () => {
	const project = withAcceptedShotAnchor(baseProject(), 25);
	const extension = ((project.timelineAnnotations[0]!.opaqueExtensions as Record<string, unknown>)[
		'org.soundscaper.assistance-shot-boundaries-v1'
	] as Record<string, unknown>);
	const stale = { ...project, timelineAnnotations: [{ ...project.timelineAnnotations[0],
		opaqueExtensions: { 'org.soundscaper.assistance-shot-boundaries-v1': {
			...extension, presentationTick: '26',
		} } }] };
	let visualCalls = 0;
	await assert.rejects(fixture(stale, [], () => { visualCalls += 1; }).prepareSelectedMedia({
		sourceId: 'video-source', operation: 'subject-detection',
	}), /shot|timing|stale/iu);
	assert.equal(visualCalls, 0);

	const controller = new AbortController();
	controller.abort(new DOMException('cancelled', 'AbortError'));
	let storeReads = 0;
	await assert.rejects(fixture(baseProject(), [], undefined, () => { storeReads += 1; })
		.prepareSelectedMedia({ sourceId: 'video-source', operation: 'saliency-detection',
			signal: controller.signal }), { name: 'AbortError' });
	assert.equal(storeReads, 0);
});

interface VisualRequest {
	readonly sourceWidth: number;
	readonly sourceHeight: number;
	readonly rasterWidth: number;
	readonly rasterHeight: number;
	readonly timing: Readonly<{ readonly timescale: number; readonly frames: readonly Readonly<{
		readonly sourceFrame: number; readonly presentationTick: string;
	}>[] }>;
}

function fixture(
	project: ReturnType<typeof baseProject>,
	requests: VisualRequest[],
	onVisual?: () => void,
	onStore?: () => void,
) {
	return createLocalAssistanceSelectedVideoPreparation({
		getProject: () => project, getSelectedClipId: () => 'video-clip',
		captureProject: () => project, assertProject: (token) => assert.strictEqual(token, project),
		store: { async loadMediaAsset() { onStore?.(); return videoBlob(); } },
		createVisualFramePack: async (request) => {
			onVisual?.();
			requests.push(request);
			request.signal.throwIfAborted();
			request.assertCurrent();
			return FRAME_PACK;
		},
	});
}

function baseProject() {
	return {
		id: 'project-1', schemaVersion: 31 as const, revision: 7, sampleRate: 48_000,
		primarySequenceId: 'main-sequence',
		selection: { startFrame: 0, endFrame: 200_000,
			clipIds: ['video-clip'], trackIds: ['video-track'] },
		sources: [{ id: 'video-source', name: 'Camera A', kind: 'video',
			storageKey: 'video-original', mimeType: 'video/mp4', contentSha256: VIDEO_SHA256,
			sampleRate: 48_000, sampleFrameCount: 480_000, sourceFrameCount: 240,
			frameRate: { num: 24, den: 1 }, width: 1_920, height: 1_080, timingAsset: null,
			timingDecision: { mode: 'conform-cfr-at-ingest', rate: { num: 24, den: 1 } },
		}],
		clips: [{ id: 'video-clip', title: 'Camera A', kind: 'video', sourceId: 'video-source',
			sequenceId: 'main-sequence', sequenceStartFrame: 10, sequenceFrameCount: 100,
			sourceInFrame: 20, sourceFrameCount: 100, retimeMap: null,
			reversed: false, speedRatio: 1, avLinkId: null }],
		tracks: [{ id: 'video-track', name: 'Picture', type: 'video', clipIds: ['video-clip'] }],
		sequences: [{ id: 'main-sequence', rate: { num: 24, den: 1 },
			trackIds: ['video-track'] }],
		timelineAnnotations: [] as Record<string, unknown>[],
		subsequences: [] as Record<string, unknown>[],
		multicameraGroups: [] as Record<string, unknown>[],
	};
}

function withAcceptedShotAnchor(project: ReturnType<typeof baseProject>, sourceFrame: number) {
	const selected = resolveLocalAssistanceSelectedVideoAuthority({
		getProject: () => project, getSelectedClipId: () => 'video-clip',
	});
	const digest = 'ab'.repeat(32);
	const mapped = 10 + sourceFrame - 20;
	return { ...project, timelineAnnotations: [{
		id: `assistance-shot:${digest}:${String(sourceFrame)}`,
		batchId: `assistance-shot-batch:${digest}`, sequenceId: 'main-sequence',
		name: 'Shot 1', color: 'orange', kind: 'marker', anchor: 'sample',
		positionFrame: sequenceFrameBoundarySample(mapped, { num: 24, den: 1 }, 48_000),
		opaqueExtensions: { 'org.soundscaper.assistance-shot-boundaries-v1': {
			schemaVersion: 1, operation: 'shot-detection', detector: 'ffmpeg-scdet', timescale: 24,
			sourceFrameCount: 240, sourceId: 'video-source', sourceSha256: VIDEO_SHA256,
			sourceStartFrame: 20, sourceEndFrame: 120,
			timingAuthoritySha256: selected.fence.timingAuthoritySha256,
			sourceFrame, presentationTick: String(sourceFrame), score: 0.9,
		} },
	}] };
}

function withClip(project: ReturnType<typeof baseProject>, change: Record<string, unknown>) {
	return { ...project, clips: [{ ...project.clips[0]!, ...change }] } as ReturnType<typeof baseProject>;
}

function withSource(project: ReturnType<typeof baseProject>, change: Record<string, unknown>) {
	return { ...project, sources: [{ ...project.sources[0]!, ...change }] } as ReturnType<typeof baseProject>;
}

function videoBlob(): Blob {
	return new Blob([VIDEO_BYTES.slice().buffer], { type: 'video/mp4' });
}
