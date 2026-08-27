/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createCurrentAudioEditorProject,
	type AudioEditorProjectCurrent,
} from '../src/common/editor/project-current.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

import { createPlaybackProjectService } from '../src/common/editor/controller/playback-project-service.ts';
import { createEditorVideoExportAction } from '../src/common/editor/controller/video-export-service.ts';
import type { EngineChunkSource } from '../src/common/editor/engine/types.ts';
import { PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS } from '../src/common/editor/project-feature-audio-rendered-fallback.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import type {
	ProjectAudioFallbackIntegritySelector,
	ProjectVideoFallbackIntegritySelector,
} from '../src/common/editor/project-fallback-integrity.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
	createVideoClip,
	createVideoSource,
	createVideoTrack,
} from '../src/common/editor/project-media-factory.ts';
import { createVideoExportPlan } from '../src/common/editor/video-export.js';
import { CANONICAL_VIDEO_EXPORT_PLAN_VERSION } from '../src/common/editor/video-export-plan-version.ts';
import { availableDesktopVideoExportCapabilities } from './helpers/desktop-video-export-capabilities.js';

const SAMPLE_RATE = 48_000;
const TARGET_START = 24_000;
const TARGET_DURATION = 48_000;
const TRANSITION_START = 60_800;
const TARGET_END = TARGET_START + TARGET_DURATION;
const PROJECT_END = 96_000;
const TARGET_CLIP_ID = 'effect-target';
const CANONICAL_TARGET_SOURCE_ID = 'canonical-target-video';
const FALLBACK_SOURCE_ID = 'rendered-target-video';
const UNAFFECTED_SOURCE_ID = 'unaffected-video';
const AUDIO_SOURCE_ID = 'linked-audio';
const FALLBACK_AUDIO_SOURCE_ID = 'rendered-audio-mix';
const FALLBACK_DIGEST = 'de'.repeat(32);
const FALLBACK_AUDIO_DIGEST = 'ac'.repeat(32);

interface VideoPlanInput {
	readonly kind: string;
	readonly inputIndex: number;
	readonly sourceId?: string;
	readonly storageKey?: string;
}

interface VideoPlanClip {
	readonly role: string;
	readonly clipId: string;
	readonly sourceId: string;
	readonly inputIndex: number;
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
	readonly sourceDurationFrames: number;
	readonly playbackRate: number;
	readonly opacityStart: number;
	readonly opacityEnd: number;
	readonly videoEffects: readonly unknown[];
}

interface VideoPlanLayer {
	readonly trackId: string;
	readonly trackIndex: number;
	readonly clips: readonly VideoPlanClip[];
}

interface VideoPlanInterval {
	readonly kind: string;
	readonly timelineStartFrame: number;
	readonly timelineEndFrame: number;
	readonly durationFrames: number;
	readonly layers: readonly VideoPlanLayer[];
}

interface VideoPlan {
	readonly version: number;
	readonly inputs: readonly VideoPlanInput[];
	readonly intervals: readonly VideoPlanInterval[];
	readonly range: Readonly<{
		startFrame: number;
		endFrame: number;
		durationFrames: number;
	}>;
	readonly filterPlan: Readonly<{
		audio: Readonly<{
			strategy: string;
			inputIndex: number;
			startFrame: number;
			durationFrames: number;
			sampleRate: number;
			codec: string;
		}>;
	}>;
}

interface RenderRange {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly outputFrames: number;
	readonly includeTail: boolean;
	readonly preRollFrames: number;
}

test('desktop mixed video export composes admitted audio and clip-local video fallbacks in the actual plan', async () => {
	const canonical = clipFallbackProject();
	const before = structuredClone(canonical);
	const playbackProjects = createPlaybackProjectService({ audioEffects: false, videoEffects: false });
	const fallbackBlob = new Blob([Uint8Array.of(7, 8, 9)], { type: 'video/mp4' });
	const unaffectedBlob = new Blob([Uint8Array.of(1, 2, 3)], { type: 'video/mp4' });
	const encodedBytes = Uint8Array.of(4, 5, 6, 7);
	const stagedWavBytes = Uint8Array.of(0x52, 0x49, 0x46, 0x46);
	const sourceBuffers = new Map<string, unknown>([[AUDIO_SOURCE_ID, Object.freeze({ owner: 'canonical-audio' })]]);
	const loadedStorageKeys: string[] = [];
	const errors: unknown[] = [];
	let plannedProject: AudioEditorProjectCurrent | null = null;
	let renderedProject: AudioEditorProjectCurrent | null = null;
	let renderedRange: RenderRange | null = null;
	let renderedSourceMap: ReadonlyMap<string, unknown> | null = null;
	let renderedChunkSources: ReadonlyMap<string, EngineChunkSource> | null = null;
	let preparedTimePitchCaches: boolean | null = null;
	let encodedVideoBlobs: ReadonlyMap<string, Blob> | null = null;
	let encodedAudioMix: Blob | null = null;
	let encodedPlan: VideoPlan | null = null;
	let publishedBlob: Blob | null = null;
	let activeController: AbortController | null = null;
	const state = {
		exportGeneration: 0,
		exportAbort: null,
		mobile: false,
		outputUrl: null,
		outputCleanup: null,
		exportOutput: null,
		disposed: false,
	};
	const store = {
		async loadMediaAsset(storageKey: string): Promise<Blob> {
			loadedStorageKeys.push(storageKey);
			if (storageKey !== 'unaffected-video-storage') {
				throw new Error(`Unexpected ordinary video load: ${storageKey}.`);
			}
			return unaffectedBlob;
		},
	};
	const expectedSelector: ProjectVideoFallbackIntegritySelector = Object.freeze({
		requirementId: 'publisher-target-render',
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoEffects,
		role: 'video-clip-render-v1',
		kind: 'video',
		sourceId: FALLBACK_SOURCE_ID,
		sha256: FALLBACK_DIGEST,
		targetClipId: TARGET_CLIP_ID,
	});
	const expectedAudioSelector: ProjectAudioFallbackIntegritySelector = Object.freeze({
		requirementId: 'publisher-audio-render',
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
		role: 'project-audio-mix-v1',
		kind: 'audio',
		sourceId: FALLBACK_AUDIO_SOURCE_ID,
		sha256: FALLBACK_AUDIO_DIGEST,
		targetTrackId: null,
	});
	const fallbackAudioSource = recordById(canonical.sources, FALLBACK_AUDIO_SOURCE_ID);
	const fallbackAudioProvider: EngineChunkSource = Object.freeze({
		channelCount: Number(fallbackAudioSource.channelCount),
		frameCount: Number(fallbackAudioSource.frameCount),
		chunkFrames: Number(fallbackAudioSource.chunkFrames),
		sampleRate: Number(fallbackAudioSource.sampleRate),
		readStorageChunk: () => Object.freeze([Float32Array.of(0.25), Float32Array.of(-0.25)]),
	});

	const runtime = {
		abortError: () => Object.assign(new Error('aborted'), { name: 'AbortError' }),
		audioBufferChannels: (buffer: Readonly<{ channels: readonly Float32Array[] }>) => buffer.channels,
		cloneProject: (project: AudioEditorProjectCurrent) => structuredClone(project),
		copy: {
			localSourcesMissing: 'Local sources missing',
			rendering: 'Rendering',
			encoding: 'Encoding',
			done: 'Done',
		},
		createVideoExportPlan(project: AudioEditorProjectCurrent, options: Readonly<Record<string, unknown>>) {
			plannedProject = project;
			return createVideoExportPlan(project, options) as unknown as VideoPlan;
		},
		encodeWav: () => stagedWavBytes,
		ffmpeg: {
			async encodeVideo(
				videoBlobs: ReadonlyMap<string, Blob>,
				audioMix: Blob | null,
				plan: VideoPlan,
			) {
				encodedVideoBlobs = new Map(videoBlobs);
				encodedAudioMix = audioMix;
				encodedPlan = plan;
				return { bytes: encodedBytes, mimeType: 'video/mp4' };
			},
		},
		fileService: {
			isDesktop: true,
			getDesktopVideoExportCapabilities: availableDesktopVideoExportCapabilities,
			createDownload(request: Readonly<{ blob: Blob }>) {
				publishedBlob = request.blob;
				return Object.freeze({
					cancelled: false,
					url: 'blob:clip-fallback-export',
					fileName: 'Clip-fallback-export.mp4',
					method: 'object-url',
				});
			},
		},
		findClip: (project: AudioEditorProjectCurrent, id: string) => project.clips.find((clip) => clip.id === id),
		findSource: (project: AudioEditorProjectCurrent, id: string) => project.sources.find((source) => source.id === id),
		getProject: () => canonical,
		handleError(error: unknown) { errors.push(error); },
		hasMissingTimelineSources(
			_project: unknown,
			options: Readonly<{ excludedSourceIds: ReadonlySet<string> }>,
		) {
			assert.deepEqual([...options.excludedSourceIds].sort(), [FALLBACK_AUDIO_SOURCE_ID, FALLBACK_SOURCE_ID].sort());
			return false;
		},
		lifetime: {
			startTask() {
				activeController = new AbortController();
				return Object.freeze({ signal: activeController.signal, assertCurrent() {}, finish() {} });
			},
			cancelTask() { activeController?.abort(); },
		},
		playbackProjects,
		preflightStorage: () => undefined,
		projectGeneration: { capture: () => canonical.id, assertCurrent() {} },
		projectSampleRate: () => SAMPLE_RATE,
		publishDocumentSnapshot() {},
		setStatus() {},
		sourceBuffers,
		state,
		store,
		taskProgress: {
			begin: () => Object.freeze({ setPhase: () => true, finish: () => true }),
		},
		throwIfAborted(signal?: AbortSignal | null) { if (signal?.aborted) throw signal.reason; },
		toggleExport() {},
		verifyProjectFallbackIntegrity(
			candidate: unknown,
			candidateStore: unknown,
			options: Readonly<{
				audioFallback?: ProjectAudioFallbackIntegritySelector;
				videoFallback?: ProjectVideoFallbackIntegritySelector;
			}>,
		) {
			assert.strictEqual(candidate, canonical);
			assert.strictEqual(candidateStore, store);
			assert.deepEqual(options.audioFallback, expectedAudioSelector);
			assert.deepEqual(options.videoFallback, expectedSelector);
			return Object.freeze({
				assertCurrent(current: unknown) { assert.strictEqual(current, canonical); },
				getVerifiedAudioChunkProvider(selector: ProjectAudioFallbackIntegritySelector) {
					assert.deepEqual(selector, expectedAudioSelector);
					return fallbackAudioProvider;
				},
				getVerifiedVideoBlob(selector: ProjectVideoFallbackIntegritySelector) {
					assert.deepEqual(selector, expectedSelector);
					return fallbackBlob;
				},
			});
		},
	};
	const renderSnapshot = async (
		project: AudioEditorProjectCurrent,
		range: RenderRange,
		buffers: ReadonlyMap<string, unknown>,
		_signal?: AbortSignal,
		chunkSources?: ReadonlyMap<string, EngineChunkSource>,
		prepareTimePitchCaches?: boolean,
	): Promise<Readonly<{ sampleRate: number; channels: readonly Float32Array[] }>> => {
		renderedProject = project;
		renderedRange = range;
		renderedSourceMap = buffers;
		renderedChunkSources = chunkSources ?? null;
		preparedTimePitchCaches = prepareTimePitchCaches ?? null;
		return Object.freeze({
			sampleRate: SAMPLE_RATE,
			channels: Object.freeze([Float32Array.of(0.25), Float32Array.of(-0.25)]),
		});
	};

	const result = await createEditorVideoExportAction(runtime, renderSnapshot)({ format: 'video-mp4' });

	assert.deepEqual(errors, []);
	assert.deepEqual(result, {
		url: 'blob:clip-fallback-export',
		fileName: 'Clip-fallback-export.mp4',
		mimeType: 'video/mp4',
		size: encodedBytes.byteLength,
		method: 'object-url',
	});
	assert.deepEqual(canonical, before, 'ordinary export must not mutate the canonical project');
	const exportedProject = capturedValue<AudioEditorProjectCurrent>(plannedProject, 'planned project');
	const audioRenderProject = capturedValue<AudioEditorProjectCurrent>(renderedProject, 'audio render project');
	const plan = capturedValue<VideoPlan>(encodedPlan, 'encoded plan');
	const videoBlobs = capturedValue<ReadonlyMap<string, Blob>>(encodedVideoBlobs, 'encoded video blobs');
	const audioMix = capturedValue<Blob>(encodedAudioMix, 'encoded audio mix');
	const publication = capturedValue<Blob>(publishedBlob, 'published video');
	const privateSourceMap = capturedValue<ReadonlyMap<string, unknown>>(renderedSourceMap, 'render source map');
	const privateChunkSources = capturedValue<ReadonlyMap<string, EngineChunkSource>>(
		renderedChunkSources,
		'render chunk sources',
	);
	assert.strictEqual(audioRenderProject, exportedProject);
	assert.equal(privateSourceMap.size, 0);
	assert.strictEqual(privateChunkSources.get(FALLBACK_AUDIO_SOURCE_ID), fallbackAudioProvider);
	assert.equal(preparedTimePitchCaches, false);

	const target = recordById(exportedProject.clips, TARGET_CLIP_ID);
	const canonicalTarget = recordById(canonical.clips, TARGET_CLIP_ID);
	assert.deepEqual({
		id: target.id,
		timelineStartFrame: target.timelineStartFrame,
		durationFrames: target.durationFrames,
		groupId: target.groupId,
		avLinkId: target.avLinkId,
	}, {
		id: canonicalTarget.id,
		timelineStartFrame: canonicalTarget.timelineStartFrame,
		durationFrames: canonicalTarget.durationFrames,
		groupId: canonicalTarget.groupId,
		avLinkId: canonicalTarget.avLinkId,
	});
	assert.deepEqual({
		sourceId: target.sourceId,
		sourceInFrame: target.sourceInFrame,
		sourceFrameCount: target.sourceFrameCount,
		trimStartFrames: target.trimStartFrames,
		trimEndFrames: target.trimEndFrames,
		speedRatio: target.speedRatio,
		videoEffects: target.videoEffects,
	}, {
		sourceId: FALLBACK_SOURCE_ID,
		sourceInFrame: 0,
		sourceFrameCount: 30,
		trimStartFrames: 0,
		trimEndFrames: 0,
		speedRatio: 1,
		videoEffects: [],
	});
	assert.deepEqual(
		recordById(exportedProject.clips, 'unaffected-clip'),
		recordById(canonical.clips, 'unaffected-clip'),
	);
	assert.deepEqual(
		recordById(exportedProject.tracks, 'picture-track'),
		recordById(canonical.tracks, 'picture-track'),
	);
	assert.equal(recordById(exportedProject.sources, FALLBACK_SOURCE_ID).hasAudio, false);
	assert.equal(exportedProject.clips.some(({ id }) => id === 'linked-audio-clip'), false);
	assert.equal(
		recordById(exportedProject.clips, PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.clip).sourceId,
		FALLBACK_AUDIO_SOURCE_ID,
	);

	assert.equal(plan.version, CANONICAL_VIDEO_EXPORT_PLAN_VERSION);
	assert.deepEqual(plan.range, {
		startFrame: 0,
		endFrame: PROJECT_END,
		durationFrames: PROJECT_END,
	});
	assert.deepEqual(plan.inputs.map((input) => ({
		kind: input.kind,
		inputIndex: input.inputIndex,
		sourceId: input.sourceId ?? null,
	})), [
		{ kind: 'video-source', inputIndex: 0, sourceId: FALLBACK_SOURCE_ID },
		{ kind: 'video-source', inputIndex: 1, sourceId: UNAFFECTED_SOURCE_ID },
		{ kind: 'staged-audio-mix', inputIndex: 2, sourceId: null },
	]);
	assert.equal(plan.inputs.some(({ sourceId }) => sourceId === CANONICAL_TARGET_SOURCE_ID), false);
	assert.deepEqual(loadedStorageKeys, ['unaffected-video-storage']);
	assert.strictEqual(videoBlobs.get(FALLBACK_SOURCE_ID), fallbackBlob);
	assert.strictEqual(videoBlobs.get(UNAFFECTED_SOURCE_ID), unaffectedBlob);

	const transition = plan.intervals.find((interval) => (
		interval.timelineStartFrame === TRANSITION_START && interval.timelineEndFrame === TARGET_END
	));
	assert.ok(transition);
	assert.equal(transition.kind, 'composition');
	assert.equal(transition.durationFrames, TARGET_END - TRANSITION_START);
	assert.equal(transition.layers.length, 1);
	assert.deepEqual({
		trackId: transition.layers[0]?.trackId,
		trackIndex: transition.layers[0]?.trackIndex,
	}, { trackId: 'picture-track', trackIndex: 0 });
	assert.deepEqual(transition.layers[0]?.clips.map((clip) => ({
		role: clip.role,
		clipId: clip.clipId,
		sourceId: clip.sourceId,
		sourceStartFrame: clip.sourceStartFrame,
		sourceEndFrame: clip.sourceEndFrame,
		playbackRate: clip.playbackRate,
		opacityStart: clip.opacityStart,
		opacityEnd: clip.opacityEnd,
		videoEffects: clip.videoEffects,
	})), [{
		role: 'outgoing',
		clipId: TARGET_CLIP_ID,
		sourceId: FALLBACK_SOURCE_ID,
		sourceStartFrame: 23,
		sourceEndFrame: 30,
		playbackRate: 1,
		opacityStart: 1,
		opacityEnd: 0,
		videoEffects: [],
	}, {
		role: 'incoming',
		clipId: 'unaffected-clip',
		sourceId: UNAFFECTED_SOURCE_ID,
		sourceStartFrame: 0,
		sourceEndFrame: 7,
		playbackRate: 1,
		opacityStart: 0,
		opacityEnd: 1,
		videoEffects: [],
	}]);

	assert.deepEqual(plan.filterPlan.audio, {
		strategy: 'staged-mix',
		inputIndex: 2,
		startFrame: 0,
		durationFrames: PROJECT_END,
		sampleRate: SAMPLE_RATE,
		codec: 'aac',
	});
	assert.deepEqual(renderedRange, {
		startFrame: 0,
		endFrame: PROJECT_END,
		includeTail: false,
		outputFrames: PROJECT_END,
		preRollFrames: 0,
	});
	assert.equal(audioMix.type, 'audio/wav');
	assert.deepEqual(new Uint8Array(await audioMix.arrayBuffer()), stagedWavBytes);
	assert.equal(publication.type, 'video/mp4');
	assert.deepEqual(new Uint8Array(await publication.arrayBuffer()), encodedBytes);
});

function clipFallbackProject(): AudioEditorProjectCurrent {
	const targetSource = createVideoSource({
		id: CANONICAL_TARGET_SOURCE_ID,
		storageKey: 'canonical-target-video-storage',
		frameCount: 96_000,
		sampleRate: SAMPLE_RATE,
		width: 1_280,
		height: 720,
		frameRate: 30,
		audioCodec: 'aac',
		hasAudio: true,
		opaqueExtensions: { byteLength: 90 },
	});
	const fallbackSource = createVideoSource({
		id: FALLBACK_SOURCE_ID,
		storageKey: 'rendered-target-video-storage',
		frameCount: TARGET_DURATION,
		sampleRate: SAMPLE_RATE,
		width: 1_280,
		height: 720,
		frameRate: 30,
		audioCodec: null,
		hasAudio: false,
		opaqueExtensions: { byteLength: 45 },
	});
	const unaffectedSource = createVideoSource({
		id: UNAFFECTED_SOURCE_ID,
		storageKey: 'unaffected-video-storage',
		frameCount: 72_000,
		sampleRate: SAMPLE_RATE,
		width: 1_280,
		height: 720,
		frameRate: 30,
		hasAudio: false,
		opaqueExtensions: { byteLength: 60 },
	});
	const audioSource = createAudioSource({
		id: AUDIO_SOURCE_ID,
		storageKey: 'linked-audio-storage',
		frameCount: TARGET_DURATION,
		channelCount: 2,
		sampleRate: SAMPLE_RATE,
	});
	const fallbackAudioSource = createAudioSource({
		id: FALLBACK_AUDIO_SOURCE_ID,
		storageKey: 'rendered-audio-mix-storage',
		frameCount: PROJECT_END,
		channelCount: 2,
		sampleRate: SAMPLE_RATE,
	});
	const targetClip = createVideoClip({
		id: TARGET_CLIP_ID,
		sourceId: targetSource.id,
		timelineStartFrame: TARGET_START,
		sourceStartFrame: 12_000,
		sourceDurationFrames: 36_000,
		durationFrames: TARGET_DURATION,
		trimStartFrames: 6_000,
		trimEndFrames: 10_000,
		speedRatio: 0.75,
		groupId: 'scene-group',
		avLinkId: 'target-av-link',
		videoEffects: [{
			id: 'pixelate-target', type: 'pixelate', enabled: true, params: { blockSize: 12 },
		}],
	});
	const unaffectedClip = createVideoClip({
		id: 'unaffected-clip',
		sourceId: unaffectedSource.id,
		timelineStartFrame: TRANSITION_START,
		durationFrames: PROJECT_END - TRANSITION_START,
	});
	const audioClip = createAudioClip({
		id: 'linked-audio-clip',
		sourceId: audioSource.id,
		timelineStartFrame: TARGET_START,
		durationFrames: TARGET_DURATION,
		groupId: 'scene-group',
		avLinkId: 'target-av-link',
	});
	return createCurrentAudioEditorProject({
		id: 'clip-fallback-export',
		title: 'Clip fallback export',
		now: '2026-08-03T12:00:00.000Z',
		sampleRate: SAMPLE_RATE,
		sources: [targetSource, fallbackSource, unaffectedSource, audioSource, fallbackAudioSource],
		clips: [targetClip, unaffectedClip, audioClip],
		tracks: [
			createVideoTrack({
				id: 'picture-track',
				clipIds: [targetClip.id, unaffectedClip.id],
				laneGroupId: 'camera-lane',
			}),
			createAudioTrack({
				id: 'linked-audio-track',
				clipIds: [audioClip.id],
				laneGroupId: 'camera-lane',
			}, SAMPLE_RATE),
		],
		featureRequirements: { schemaVersion: 2, requirements: [
			{
				id: 'publisher-audio-render',
				featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
				displayName: 'Publisher audio render',
				disposition: 'rendered-fallback',
				fallback: {
					role: 'project-audio-mix-v1',
					kind: 'audio',
					sourceId: FALLBACK_AUDIO_SOURCE_ID,
					sha256: FALLBACK_AUDIO_DIGEST,
				},
			},
			{
				id: 'publisher-target-render',
				featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoEffects,
				displayName: 'Publisher target render',
				disposition: 'rendered-fallback',
				fallback: {
					role: 'video-clip-render-v1',
					kind: 'video',
					sourceId: FALLBACK_SOURCE_ID,
					sha256: FALLBACK_DIGEST,
					targetClipId: TARGET_CLIP_ID,
				},
			},
		] },
	});
}

function recordById(
	values: readonly Readonly<Record<string, unknown>>[],
	id: string,
): Readonly<Record<string, unknown>> {
	const matches = values.filter((value) => value.id === id);
	assert.equal(matches.length, 1, `Expected one record ${id}.`);
	return matches[0]!;
}

function capturedValue<Value>(value: Value | null, label: string): Value {
	if (value === null) throw new Error(`Expected ${label} to be captured.`);
	return value;
}
