/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { FfmpegOutputSink } from '../src/common/editor/ffmpeg-output-stream.ts';
import { createEditorVideoExportAction } from '../src/common/editor/controller/video-export-service.ts';
import type {
	VideoKeyframeOfflineVideoExportRequest,
} from '../src/common/editor/ui/video-keyframe-offline-video-export.ts';
import type { VideoKeyframeExportPlanV7 } from '../src/common/editor/video-keyframe-export-plan-v7.ts';
import { createVideoSourceV10, createVideoTrackV10 } from '../src/common/editor/project-v10.ts';
import { createVideoExportPlan } from '../src/common/editor/video-export.js';
import {
	reconcileFramescaperProjectFeatureRequirementsV20,
} from '../src/framescaper/editor-project-feature-requirements-v20.ts';
import { FRAMESCAPER_V20_PROJECT_MODEL_PROFILE } from '../src/framescaper/editor-project-v20-profile.ts';
import { createFramescaperProjectV20 } from '../src/framescaper/editor-project-v20.ts';
import { createFramescaperPlaybackProjectServiceV20 } from '../src/framescaper/editor-project-playback-v20.ts';
import {
	createFramescaperVideoExportStrategyV20,
} from '../src/framescaper/video-export-strategy-v20.ts';
import { framescaperV20Options, opacityKeyframes } from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V20_PROJECT_MODEL_PROFILE;

test('V20 product strategy returns null only for an authenticated static range', () => {
	const staticProject = createFramescaperProjectV20(PROFILE, framescaperV20Options());
	const strategy = createFramescaperVideoExportStrategyV20(PROFILE);
	const staticExportProject = strategy.createExportProject({
		canonicalProject: staticProject,
		delivery: fallbackFreeDelivery(staticProject),
	});
	assert.equal(strategy.createPlan({
		canonicalProject: staticProject,
		exportProject: staticExportProject,
		format: 'mp4',
		range: 'project',
		includeAudio: true,
		canvas: undefined,
	}), null);

	const keyed = keyedProject();
	const keyedExportProject = strategy.createExportProject({
		canonicalProject: keyed,
		delivery: fallbackFreeDelivery(keyed),
	});
	const plan = strategy.createPlan({
		canonicalProject: keyed,
		exportProject: keyedExportProject,
		format: 'webm',
		range: { startFrame: 48_000, endFrame: 96_000 },
		includeAudio: true,
		canvas: { maximumWidth: 640, maximumHeight: 360 },
	});
	assert.equal(plan?.version, 7);
	assert.equal(plan?.format, 'webm');
	assert.deepEqual(plan?.activeSourceIds, ['late-source']);
	assert.deepEqual(plan?.range, { startFrame: 48_000, endFrame: 96_000, durationFrames: 48_000 });

	const invalid = structuredClone(keyed) as Record<string, unknown>;
	invalid.schemaVersion = 19;
	assert.throws(() => strategy.createExportProject({
		canonicalProject: invalid,
		delivery: fallbackFreeDelivery(keyed),
	}), /schema version|exact.*V20/iu);
});

test('V20 product strategy maps the detached plan exactly into Blob and sink encoders', async () => {
	const project = keyedProject();
	const encodedBytes = Uint8Array.of(1, 2, 3, 4);
	const captured: unknown[] = [];
	const strategy = createFramescaperVideoExportStrategyV20(PROFILE, {
		async encodeOffline(request: VideoKeyframeOfflineVideoExportRequest) {
			captured.push(request);
			return Object.freeze({
				bytes: encodedBytes,
				byteLength: encodedBytes.byteLength,
				videoEncoder: 'ffmpeg' as const,
				format: 'mp4' as const,
				extension: '.mp4' as const,
				mimeType: 'video/mp4' as const,
				frameCount: 30,
				rgbaChunkCount: 1,
				audioByteLength: 44,
				audioChunkCount: 1,
				outputChunkCount: 1,
			});
		},
		async encodeOfflineToSink(
			request: VideoKeyframeOfflineVideoExportRequest,
			sink: FfmpegOutputSink<unknown>,
		) {
			captured.push(request);
			return Object.freeze({
				output: sink,
				byteLength: encodedBytes.byteLength,
				videoEncoder: 'ffmpeg' as const,
				format: 'mp4' as const,
				extension: '.mp4' as const,
				mimeType: 'video/mp4' as const,
				frameCount: 30,
				rgbaChunkCount: 1,
				audioByteLength: 44,
				audioChunkCount: 1,
				outputChunkCount: 2,
			});
		},
	});
	const exportProject = strategy.createExportProject({
		canonicalProject: project,
		delivery: fallbackFreeDelivery(project),
	});
	const plan = strategy.createPlan({
		canonicalProject: project,
		exportProject,
		format: 'mp4',
		range: { startFrame: 48_000, endFrame: 96_000 },
		includeAudio: true,
		canvas: { maximumWidth: 640, maximumHeight: 360 },
	});
	assert.ok(plan);
	const keyedPlan = plan as VideoKeyframeExportPlanV7;
	const videoBlob = new Blob([Uint8Array.of(9)], { type: 'video/mp4' });
	const audioMix = new Blob([Uint8Array.of(8)], { type: 'audio/wav' });
	const signal = new AbortController().signal;
	const editorFfmpeg = Object.freeze({ runVideoKeyframeEncoderOperation() { throw new Error('unused'); } });
	const request = {
		canonicalProject: project,
		exportProject,
		plan,
		timingBySourceId: new Map(),
		videoBlobs: new Map([['late-source', videoBlob]]),
		audioMix,
		editorFfmpeg,
		webCodecs: null,
		signal,
		assertCurrent() {},
		maximumOutputBytes: 1_024,
	};
	const blobResult = await strategy.encode(request);
	assert.strictEqual(blobResult.bytes, encodedBytes);
	assert.equal(blobResult.mimeType, 'video/mp4');

	const sink = sinkFixture();
	const sinkResult = await strategy.encodeToSink(request, sink);
	assert.strictEqual(sinkResult.output, sink);
	assert.equal(sinkResult.chunkCount, 2);
	assert.equal(sinkResult.byteLength, 4);
	assert.equal(captured.length, 2);
	for (const candidate of captured) {
		const encoded = candidate as Readonly<Record<string, unknown>>;
		assert.equal(encoded.startFrame, plan.range.startFrame);
		assert.equal(encoded.endFrame, plan.range.endFrame);
		assert.deepEqual(encoded.canvas, {
			width: keyedPlan.canvas.width,
			height: keyedPlan.canvas.height,
			frameRate: keyedPlan.canvas.frameRate,
			fit: keyedPlan.canvas.fit,
		});
		assert.deepEqual(encoded.sources, [{ sourceId: 'late-source', blob: videoBlob }]);
		assert.strictEqual(encoded.audioMix, audioMix);
		assert.strictEqual(encoded.editorFfmpeg, editorFfmpeg);
		assert.strictEqual(encoded.signal, signal);
		// No decision was made against this delivery, so none is claimed.
		assert.equal(Object.hasOwn(encoded, 'webCodecs'), false);
	}
});

test('V20 product strategy hands the encoder decision to the offline encode', async () => {
	const project = keyedProject();
	const captured: unknown[] = [];
	const strategy = createFramescaperVideoExportStrategyV20(PROFILE, {
		async encodeOffline(request: VideoKeyframeOfflineVideoExportRequest) {
			captured.push(request);
			return Object.freeze({
				bytes: Uint8Array.of(1),
				byteLength: 1,
				videoEncoder: 'webcodecs' as const,
				codec: 'avc1.4d0028',
				format: 'mp4' as const,
				extension: '.mp4' as const,
				mimeType: 'video/mp4' as const,
				frameCount: 30,
				rgbaChunkCount: 1,
				outputChunkCount: 1,
			});
		},
		async encodeOfflineToSink() { throw new Error('must not stream'); },
	});
	const exportProject = strategy.createExportProject({
		canonicalProject: project,
		delivery: fallbackFreeDelivery(project),
	});
	const plan = strategy.createPlan({
		canonicalProject: project,
		exportProject,
		format: 'mp4',
		range: { startFrame: 48_000, endFrame: 96_000 },
		includeAudio: false,
		canvas: { maximumWidth: 640, maximumHeight: 360 },
	})!;
	const encoded = await strategy.encode({
		canonicalProject: project,
		exportProject,
		plan,
		timingBySourceId: new Map(),
		videoBlobs: new Map([['late-source', new Blob([Uint8Array.of(1)])]]),
		audioMix: null,
		editorFfmpeg: Object.freeze({ runVideoKeyframeEncoderOperation() { throw new Error('unused'); } }),
		webCodecs: { codec: 'avc1.4d0028', bitrate: 6_214_585 },
		signal: new AbortController().signal,
		assertCurrent() {},
		maximumOutputBytes: undefined,
	});
	const request = captured[0] as Readonly<Record<string, unknown>>;
	assert.deepEqual(request.webCodecs, { codec: 'avc1.4d0028', bitrate: 6_214_585 });
	// What actually ran is reported back out, not what was asked for.
	assert.equal(encoded.videoEncoder, 'webcodecs');
	assert.equal(encoded.codec, 'avc1.4d0028');
});

test('V20 product strategy refuses a missing, extra, or mis-keyed active source Blob', async () => {
	const project = keyedProject();
	const strategy = createFramescaperVideoExportStrategyV20(PROFILE, {
		encodeOffline: async () => { throw new Error('must not encode'); },
		encodeOfflineToSink: async () => { throw new Error('must not encode'); },
	});
	const exportProject = strategy.createExportProject({
		canonicalProject: project,
		delivery: fallbackFreeDelivery(project),
	});
	const plan = strategy.createPlan({
		canonicalProject: project,
		exportProject,
		format: 'mp4',
		range: { startFrame: 48_000, endFrame: 96_000 },
		includeAudio: false,
		canvas: { maximumWidth: 640, maximumHeight: 360 },
	});
	assert.ok(plan);
	const base = {
		canonicalProject: project,
		exportProject,
		plan,
		timingBySourceId: new Map(),
		audioMix: null,
		editorFfmpeg: Object.freeze({ runVideoKeyframeEncoderOperation() { throw new Error('unused'); } }),
		webCodecs: null,
		signal: new AbortController().signal,
		assertCurrent() {},
		maximumOutputBytes: undefined,
	};
	for (const videoBlobs of [
		new Map<string, Blob>(),
		new Map([['late-source', new Blob([Uint8Array.of(1)])], ['extra', new Blob([Uint8Array.of(2)])]]),
		new Map([['wrong', new Blob([Uint8Array.of(1)])]]),
	]) {
		await assert.rejects(strategy.encode({ ...base, videoBlobs }), /active.*source|video Blob|exact/iu);
	}
});

test('V20 product strategy rederives schema-17 export projection and rejects forged fallbacks', () => {
	const project = keyedProject();
	const strategy = createFramescaperVideoExportStrategyV20(PROFILE);
	const delivery = fallbackFreeDelivery(project);
	assert.equal(project.schemaVersion, 20);
	assert.equal((delivery.project as Readonly<Record<string, unknown>>).schemaVersion, 17);
	const exportProject = strategy.createExportProject({ canonicalProject: project, delivery });
	assert.equal(exportProject.schemaVersion, 17);
	assert.notStrictEqual(exportProject, delivery.project);
	assert.deepEqual(exportProject, delivery.project);

	assert.throws(() => strategy.createExportProject({
		canonicalProject: project,
		delivery: {
			...delivery,
			videoRenderedFallback: Object.freeze({ sourceId: 'forged-fallback' }),
			requiredVideoSourceIds: Object.freeze(['forged-fallback']),
		},
	}), /rendered-fallback/iu);

	let calls = 0;
	const hostileProject = Object.freeze({
		toJSON() { calls += 1; throw new Error('toJSON must not run'); },
	});
	const fromHostile = strategy.createExportProject({
		canonicalProject: project,
		delivery: { ...delivery, project: hostileProject },
	});
	assert.equal(fromHostile.schemaVersion, 17);
	assert.equal(calls, 0);

	const hostileDelivery = Object.defineProperties({}, {
		audioRenderedFallback: { enumerable: true, value: null },
		videoRenderedFallback: { enumerable: true, value: null },
		requiredAudioSourceIds: { enumerable: true, value: [] },
		requiredVideoSourceIds: { enumerable: true, value: [] },
		project: { enumerable: true, get() { calls += 1; throw new Error('project accessor'); } },
	});
	assert.throws(() => strategy.createExportProject({
		canonicalProject: project,
		delivery: hostileDelivery as never,
	}), /own data property/iu);
	assert.equal(calls, 0);
});

test('V20 export projection applies hidden folders before keyed and static range dispatch', () => {
	for (const keyed of [false, true]) {
		const project = folderProject(keyed);
		const strategy = createFramescaperVideoExportStrategyV20(PROFILE);
		const exportProject = strategy.createExportProject({
			canonicalProject: project,
			delivery: fallbackFreeDelivery(project),
		});
		const tracks = exportProject.tracks as readonly Readonly<Record<string, unknown>>[];
		assert.equal(tracks.find(({ id }) => id === 'video-track')?.hidden, true);
		assert.equal(tracks.find(({ id }) => id === 'late-track')?.hidden, false);
		const plan = strategy.createPlan({
			canonicalProject: project,
			exportProject,
			format: 'mp4',
			range: { startFrame: 48_000, endFrame: 96_000 },
			includeAudio: true,
			canvas: { maximumWidth: 640, maximumHeight: 360 },
		});
		if (keyed) assert.deepEqual(plan?.activeSourceIds, ['late-source']);
		else assert.equal(plan, null);
	}
});

test('V20 export projection is deeply immutable and stale canonical carriers fail before encoding', async () => {
	let encodes = 0;
	const project = keyedProject();
	const strategy = createFramescaperVideoExportStrategyV20(PROFILE, {
		async encodeOffline() { encodes += 1; throw new Error('must not encode'); },
		async encodeOfflineToSink() { encodes += 1; throw new Error('must not encode'); },
	});
	const exportProject = strategy.createExportProject({
		canonicalProject: project,
		delivery: fallbackFreeDelivery(project),
	});
	const tracks = exportProject.tracks as readonly Record<string, unknown>[];
	assert.equal(Object.isFrozen(exportProject), true);
	assert.equal(Object.isFrozen(tracks), true);
	assert.equal(Object.isFrozen(tracks[0]), true);
	assert.throws(() => { tracks[0]!.hidden = true; }, /read only|assign|extensible/iu);
	assert.equal(encodes, 0);

	const clip = project.clips.find(({ id }) => id === 'late-keyed-clip');
	assert.ok(clip);
	(clip as unknown as Record<string, unknown>).videoKeyframes = opacityKeyframes(9);
	(project as unknown as Record<string, unknown>).featureRequirements =
		reconcileFramescaperProjectFeatureRequirementsV20(PROFILE, project);
	assert.throws(() => strategy.createPlan({
		canonicalProject: project,
		exportProject,
		format: 'mp4',
		range: { startFrame: 48_000, endFrame: 96_000 },
		includeAudio: true,
		canvas: { maximumWidth: 640, maximumHeight: 360 },
	}), /diverges.*canonical/iu);
	assert.equal(encodes, 0);
});

test('common lifecycle bypasses the invalid schema-17 exact-project clone for keyed and static V20', async () => {
	for (const keyed of [false, true]) {
		const project = keyed ? keyedProject() : createFramescaperProjectV20(PROFILE, framescaperV20Options());
		const playbackProjects = createFramescaperPlaybackProjectServiceV20(PROFILE);
		let cloneCalls = 0;
		let legacyPlanCalls = 0;
		const errors: unknown[] = [];
		let activeController: AbortController | null = null;
		const state = {
			exportGeneration: 0,
			exportAbort: null as null | Readonly<{ signal: AbortSignal; abort(): void }>,
			outputUrl: null,
			outputCleanup: null,
			exportOutput: null,
			disposed: false,
		};
		const exportVideo = createEditorVideoExportAction({
			abortError: () => Object.assign(new Error('aborted'), { name: 'AbortError' }),
			audioBufferChannels: () => Object.freeze([]),
			cloneProject() { cloneCalls += 1; throw new Error('schema-17 clone must be bypassed'); },
			copy: {
				localSourcesMissing: 'Local sources missing', rendering: 'Rendering',
				encoding: 'Encoding', done: 'Done',
			},
			createVideoExportPlan(projectValue: unknown, request: unknown) {
				legacyPlanCalls += 1;
				return createVideoExportPlan(
					projectValue as Readonly<Record<string, unknown>>,
					request as Readonly<Record<string, unknown>>,
				);
			},
			encodeWav: () => new Uint8Array(),
			ffmpeg: {},
			fileService: {
				isDesktop: false,
				prepareSave() { return Object.freeze({ mode: 'cancelled', cancelled: true }); },
			},
			findClip: (value: typeof project, id: string) => value.clips.find((clip) => clip.id === id),
			findSource: (value: typeof project, id: string) => value.sources.find((source) => source.id === id),
			getProject: () => project,
			handleError(error: unknown) { errors.push(error); },
			hasMissingTimelineSources: () => false,
			lifetime: {
				startTask() {
					activeController = new AbortController();
					return Object.freeze({ signal: activeController.signal, assertCurrent() {}, finish() {} });
				},
				cancelTask() { activeController?.abort(); },
			},
			options: { productVideoExportStrategy: createFramescaperVideoExportStrategyV20(PROFILE) },
			playbackProjects,
			preflightStorage() { throw new Error('cancelled target must precede preflight'); },
			projectGeneration: { capture: () => project.id, assertCurrent() {} },
			projectSampleRate: () => project.sampleRate,
			publishDocumentSnapshot() {},
			setStatus() {},
			sourceBuffers: new Map(),
			state,
			store: { loadMediaAsset() { throw new Error('CFR cancellation must not load media'); } },
			throwIfAborted(signal?: AbortSignal) { if (signal?.aborted) throw signal.reason; },
			toggleExport() {},
		}, async () => { throw new Error('cancelled target must not render audio'); });
		const result = await exportVideo({
			format: 'video-mp4',
			...(keyed ? { range: { startFrame: 48_000, endFrame: 96_000 } } : {}),
		});
		assert.equal(result?.cancelled, true);
		assert.equal(cloneCalls, 0);
		assert.equal(legacyPlanCalls, keyed ? 0 : 1);
		assert.deepEqual(errors, []);
	}
});

function keyedProject() {
	const options = framescaperV20Options();
	const sources = options.sources as Record<string, unknown>[];
	sources.push(createVideoSourceV10({
		id: 'late-source', name: 'Late', storageKey: 'late-source', mimeType: 'video/mp4',
		contentSha256: '34'.repeat(32), sampleFrameCount: 48_000, sourceFrameCount: 30,
		frameRate: { num: 30_000, den: 1_001 }, width: 1_920, height: 1_080,
	}));
	const clips = options.clips as Record<string, unknown>[];
	clips.push({
		kind: 'video', id: 'late-keyed-clip', sourceId: 'late-source', title: 'Late',
		sequenceId: 'main-sequence', sequenceStartFrame: 10, sequenceFrameCount: 10,
		sourceInFrame: 0, sourceFrameCount: 30, retimeMap: null,
	});
	const tracks = options.tracks as Record<string, unknown>[];
	(tracks[0]!.clipIds as string[]).push('late-keyed-clip');
	const project = createFramescaperProjectV20(PROFILE, options);
	const clip = project.clips.find(({ id }) => id === 'late-keyed-clip');
	assert.ok(clip);
	(clip as unknown as Record<string, unknown>).videoKeyframes = opacityKeyframes(10);
	(project as unknown as Record<string, unknown>).featureRequirements =
		reconcileFramescaperProjectFeatureRequirementsV20(PROFILE, project);
	return project;
}

function folderProject(keyed: boolean) {
	const options = framescaperV20Options();
	const sources = options.sources as Record<string, unknown>[];
	sources.push(createVideoSourceV10({
		id: 'late-source', name: 'Late', storageKey: 'late-source', mimeType: 'video/mp4',
		contentSha256: '34'.repeat(32), sampleFrameCount: 48_000, sourceFrameCount: 30,
		frameRate: { num: 30_000, den: 1_001 }, width: 1_920, height: 1_080,
	}));
	const clips = options.clips as Record<string, unknown>[];
	clips.push({
		kind: 'video', id: 'late-clip', sourceId: 'late-source', title: 'Late',
		sequenceId: 'main-sequence', sequenceStartFrame: 10, sequenceFrameCount: 10,
		sourceInFrame: 0, sourceFrameCount: 30, retimeMap: null,
	});
	const tracks = options.tracks as Record<string, unknown>[];
	tracks.push(createVideoTrackV10({
		id: 'late-track', name: 'Late', clipIds: ['late-clip'], locked: false,
	}));
	options.trackFolders = [{
		id: 'hidden-folder', name: 'Hidden', collapsed: false, height: 40,
		hidden: true, mute: false, solo: false,
	}];
	const sequences = options.sequences as Record<string, unknown>[];
	sequences[0]!.trackNodes = [
		{ kind: 'folder', id: 'hidden-folder', parentFolderId: null },
		{ kind: 'track', id: 'video-track', parentFolderId: 'hidden-folder' },
		{ kind: 'track', id: 'audio-track', parentFolderId: null },
		{ kind: 'track', id: 'late-track', parentFolderId: null },
	];
	sequences[0]!.trackIds = ['video-track', 'audio-track', 'late-track'];
	const project = createFramescaperProjectV20(PROFILE, options);
	if (keyed) {
		const clip = project.clips.find(({ id }) => id === 'late-clip');
		assert.ok(clip);
		(clip as unknown as Record<string, unknown>).videoKeyframes = opacityKeyframes(10);
		(project as unknown as Record<string, unknown>).featureRequirements =
			reconcileFramescaperProjectFeatureRequirementsV20(PROFILE, project);
	}
	return project;
}

function fallbackFreeDelivery(project: ReturnType<typeof createFramescaperProjectV20>) {
	return createFramescaperPlaybackProjectServiceV20(PROFILE)
		.projectForVideoRenderedFallbackDelivery(project);
}

function sinkFixture(): FfmpegOutputSink<FfmpegOutputSink<unknown>> {
	const sink: FfmpegOutputSink<FfmpegOutputSink<unknown>> = Object.freeze({
		async open() {},
		async write() {},
		async close() { return sink; },
		async abort() {},
	});
	return sink;
}
