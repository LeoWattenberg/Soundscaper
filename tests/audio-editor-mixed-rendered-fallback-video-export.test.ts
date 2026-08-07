/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS } from '../src/common/editor/project-feature-audio-rendered-fallback.ts';
import { PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS } from '../src/common/editor/project-feature-video-rendered-fallback.ts';
import type { EngineChunkSource } from '../src/common/editor/engine/types.ts';
import type {
	ProjectAudioFallbackIntegritySelector,
	ProjectVideoFallbackIntegritySelector,
} from '../src/common/editor/project-fallback-integrity.ts';
import type { VideoRenderedFallbackDeliveryProjection } from '../src/common/editor/controller/playback-project-service.ts';
import { createEditorVideoExportAction } from '../src/common/editor/controller/video-export-service.ts';
import { admitVideoRenderedFallbackExport } from '../src/common/editor/controller/video-rendered-fallback-export.ts';

const AUDIO_FEATURE_ID = 'org.example.future-audio-pipeline';
const VIDEO_FEATURE_ID = 'org.example.future-video-pipeline';
const AUDIO_SOURCE_ID = 'fallback-audio';
const VIDEO_SOURCE_ID = 'fallback-video';
const AUDIO_DIGEST = 'ab'.repeat(32);
const VIDEO_DIGEST = 'cd'.repeat(32);

test('video delivery admits one audio and one video fallback through one integrity snapshot', async () => {
	const canonical = projectWithFallbackSources();
	const projection = mixedProjection(canonical);
	const provider: EngineChunkSource = Object.freeze({
		channelCount: 2,
		frameCount: 4,
		chunkFrames: 4,
		sampleRate: 48_000,
		readStorageChunk: () => Object.freeze([Float32Array.of(0, 0, 0, 0), Float32Array.of(0, 0, 0, 0)]),
	});
	const videoBlob = new Blob([Uint8Array.of(1, 2, 3)], { type: 'video/mp4' });
	let verificationCalls = 0;
	const admitted = await admitVideoRenderedFallbackExport(canonical, projection, {
		store: Object.freeze({}),
		verifyProjectFallbackIntegrity(project, _store, options) {
			verificationCalls += 1;
			assert.strictEqual(project, canonical);
			assert.deepEqual(options.audioFallback, audioSelector());
			assert.deepEqual(options.videoFallback, videoSelector());
			assert.equal(typeof options.assertCurrent, 'function');
			return Object.freeze({
				assertCurrent(candidate: unknown) { assert.strictEqual(candidate, canonical); },
				getVerifiedAudioChunkProvider(selector: ProjectAudioFallbackIntegritySelector) {
					assert.deepEqual(selector, audioSelector());
					return provider;
				},
				getVerifiedVideoBlob(selector: ProjectVideoFallbackIntegritySelector) {
					assert.deepEqual(selector, videoSelector());
					return videoBlob;
				},
			});
		},
	}, {
		assertCurrent: () => undefined,
	});

	assert.equal(verificationCalls, 1);
	assert.strictEqual(admitted.audioChunkProvider, provider);
	assert.strictEqual(admitted.videoBlob, videoBlob);
	assert.equal(Object.isFrozen(admitted), true);
});

test('mixed video export reuses verified video and renders verified audio through private sources', async () => {
	const canonical = mixedExportProject();
	const before = structuredClone(canonical);
	const projected = Object.freeze({
		...canonical,
		tracks: Object.freeze([
			Object.freeze({
				id: PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.track,
				type: 'audio',
				clipIds: Object.freeze([PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.clip]),
			}),
			Object.freeze({
				id: PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS.track,
				type: 'video',
				clipIds: Object.freeze([PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS.clip]),
			}),
		]),
		clips: Object.freeze([
			Object.freeze({
				id: PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.clip,
				kind: 'audio',
				sourceId: AUDIO_SOURCE_ID,
			}),
			Object.freeze({
				id: PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS.clip,
				kind: 'video',
				sourceId: VIDEO_SOURCE_ID,
			}),
		]),
	});
	const delivery = mixedProjection(projected);
	const provider: EngineChunkSource = Object.freeze({
		channelCount: 2,
		frameCount: 4,
		chunkFrames: 4,
		sampleRate: 48_000,
		readStorageChunk: () => Object.freeze([Float32Array.of(0.25), Float32Array.of(-0.25)]),
	});
	const videoBlob = new Blob([Uint8Array.of(7, 8, 9)], { type: 'video/mp4' });
	const events: string[] = [];
	const errors: unknown[] = [];
	let verificationCalls = 0;
	let plannedProject: unknown = null;
	let activeController: AbortController | null = null;
	const state = {
		exportGeneration: 0,
		exportAbort: null,
		outputUrl: null,
		outputCleanup: null,
		exportOutput: null,
		disposed: false,
	};
	const runtime = {
		abortError: () => new DOMException('Cancelled', 'AbortError'),
		audioBufferChannels: (buffer: Readonly<{ channels: readonly Float32Array[] }>) => buffer.channels,
		cloneProject: (project: typeof canonical) => structuredClone(project),
		copy: {
			localSourcesMissing: 'Local sources missing',
			rendering: 'Rendering',
			encoding: 'Encoding',
			done: 'Done',
		},
		createVideoExportPlan(project: typeof projected) {
			events.push('plan');
			plannedProject = project;
			assert.deepEqual(project.clips.map(({ sourceId }) => sourceId), [AUDIO_SOURCE_ID, VIDEO_SOURCE_ID]);
			return Object.freeze({
				inputs: Object.freeze([Object.freeze({
					kind: 'video-source', sourceId: VIDEO_SOURCE_ID, storageKey: VIDEO_SOURCE_ID,
				})]),
				range: Object.freeze({ startFrame: 0, endFrame: 4, durationFrames: 4 }),
				extension: 'mp4',
			});
		},
		encodeWav(channels: readonly Float32Array[]) {
			events.push('wav');
			assert.equal(channels.length, 2);
			return Uint8Array.of(0x52, 0x49, 0x46, 0x46);
		},
		ffmpeg: {
			async encodeVideo(videoBlobs: ReadonlyMap<string, Blob>, audioMix: Blob | null) {
				events.push('encode');
				assert.strictEqual(videoBlobs.get(VIDEO_SOURCE_ID), videoBlob);
				assert.equal(videoBlobs.size, 1);
				assert.ok(audioMix instanceof Blob);
				return Object.freeze({ bytes: Uint8Array.of(1, 2), mimeType: 'video/mp4' });
			},
		},
		fileService: {
			async createDownload(request: Readonly<{ signal?: AbortSignal }>) {
				events.push('download');
				assert.equal(request.signal?.aborted, false);
				return Object.freeze({ cancelled: false, url: 'blob:mixed', method: 'memory' });
			},
		},
		findClip: (project: typeof projected, clipId: string) => project.clips.find(({ id }) => id === clipId),
		findSource: (project: typeof projected, sourceId: string) => project.sources.find(({ id }) => id === sourceId),
		getProject: () => canonical,
		handleError(error: unknown) { errors.push(error); },
		hasMissingTimelineSources(
			_project: unknown,
			options: Readonly<{ excludedSourceIds: ReadonlySet<string> }>,
		) {
			events.push('missing');
			assert.deepEqual([...options.excludedSourceIds].sort(), [AUDIO_SOURCE_ID, VIDEO_SOURCE_ID].sort());
			return false;
		},
		lifetime: {
			startTask() {
				activeController = new AbortController();
				return Object.freeze({ signal: activeController.signal, assertCurrent() {}, finish() {} });
			},
			cancelTask() { activeController?.abort(); },
		},
		playbackProjects: {
			projectForVideoRenderedFallbackDelivery(project: unknown) {
				events.push('projection');
				assert.strictEqual(project, canonical);
				return delivery;
			},
		},
		preflightStorage() { events.push('preflight'); },
		projectGeneration: { capture: () => canonical.id, assertCurrent() {} },
		projectSampleRate: () => 48_000,
		publishDocumentSnapshot() { events.push('publish'); },
		setStatus() {},
		sourceBuffers: new Map([['canonical-audio', Object.freeze({ shared: true })]]),
		state,
		store: {
			loadMediaAsset() { throw new Error('Verified fallback video must not be loaded again.'); },
		},
		throwIfAborted(signal?: AbortSignal) { if (signal?.aborted) throw signal.reason; },
		toggleExport() {},
		verifyProjectFallbackIntegrity(project: unknown, _store: unknown, options: Readonly<{
			audioFallback?: ProjectAudioFallbackIntegritySelector;
			videoFallback?: ProjectVideoFallbackIntegritySelector;
		}>) {
			events.push('integrity');
			verificationCalls += 1;
			assert.strictEqual(project, canonical);
			assert.deepEqual(options.audioFallback, audioSelector());
			assert.deepEqual(options.videoFallback, videoSelector());
			return Object.freeze({
				assertCurrent(candidate: unknown) { assert.strictEqual(candidate, canonical); },
				getVerifiedAudioChunkProvider(selector: ProjectAudioFallbackIntegritySelector) {
					assert.deepEqual(selector, audioSelector());
					return provider;
				},
				getVerifiedVideoBlob(selector: ProjectVideoFallbackIntegritySelector) {
					assert.deepEqual(selector, videoSelector());
					return videoBlob;
				},
			});
		},
	};
	const renderSnapshot = async (
		project: typeof projected,
		_range: unknown,
		sourceMap?: ReadonlyMap<string, unknown>,
		_signal?: AbortSignal,
		chunkSources?: ReadonlyMap<string, EngineChunkSource>,
		prepareTimePitchCaches?: boolean,
	) => {
		events.push('render');
		assert.strictEqual(project, plannedProject);
		assert.equal(sourceMap?.size, 0);
		assert.equal(chunkSources?.size, 1);
		assert.strictEqual(chunkSources?.get(AUDIO_SOURCE_ID), provider);
		assert.equal(prepareTimePitchCaches, false);
		await provider.readStorageChunk(0);
		return Object.freeze({
			sampleRate: 48_000,
			channels: Object.freeze([Float32Array.of(0.25), Float32Array.of(-0.25)]),
		});
	};

	const result = await createEditorVideoExportAction(runtime, renderSnapshot)({ format: 'video-mp4' });

	assert.equal(result?.mimeType, 'video/mp4');
	assert.equal(verificationCalls, 1);
	assert.deepEqual(errors, []);
	assert.deepEqual(canonical, before);
	assert.deepEqual(events.filter((event) => [
		'projection', 'missing', 'integrity', 'plan', 'preflight', 'render', 'wav', 'encode', 'download', 'publish',
	].includes(event)), [
		'projection', 'missing', 'integrity', 'plan', 'preflight', 'render', 'wav', 'encode', 'download', 'publish',
	]);
});

function projectWithFallbackSources() {
	return Object.freeze({
		schemaVersion: 9,
		id: 'mixed-fallback-video-export',
		sampleRate: 48_000,
		masterChannels: 2,
		tracks: Object.freeze([]),
		clips: Object.freeze([]),
		sources: Object.freeze([
			Object.freeze({
				id: AUDIO_SOURCE_ID,
				kind: 'audio',
				storageKey: AUDIO_SOURCE_ID,
				channelCount: 2,
				frameCount: 4,
				chunkFrames: 4,
				sampleRate: 48_000,
			}),
			Object.freeze({
				id: VIDEO_SOURCE_ID,
				kind: 'video',
				storageKey: VIDEO_SOURCE_ID,
				frameCount: 4,
				sampleRate: 48_000,
				width: 640,
				height: 360,
				frameRate: 30,
			}),
		]),
	});
}

function mixedProjection(project: object): VideoRenderedFallbackDeliveryProjection<object> {
	return Object.freeze({
		project,
		featureRequirementsReport: Object.freeze({
			schemaVersion: 1,
			format: 'soundscaper-project',
			compatible: false,
			counts: Object.freeze({ available: 0, unavailable: 1, unknown: 1 }),
			items: Object.freeze([
				Object.freeze({
					requirementId: 'publisher-audio-render',
					featureId: AUDIO_FEATURE_ID,
					displayName: 'Audio render',
					availability: 'unknown',
					declaredDisposition: 'rendered-fallback',
					disposition: 'rendered-fallback',
					fallback: Object.freeze({
						role: 'project-audio-mix-v1', kind: 'audio', sourceId: AUDIO_SOURCE_ID, sha256: AUDIO_DIGEST,
					}),
					message: 'Audio fallback',
				}),
				Object.freeze({
					requirementId: 'publisher-video-render',
					featureId: VIDEO_FEATURE_ID,
					displayName: 'Video render',
					availability: 'unknown',
					declaredDisposition: 'rendered-fallback',
					disposition: 'rendered-fallback',
					fallback: Object.freeze({
						role: 'project-video-render-v1', kind: 'video', sourceId: VIDEO_SOURCE_ID, sha256: VIDEO_DIGEST,
					}),
					message: 'Video fallback',
				}),
			]),
		}),
		audioRenderedFallback: Object.freeze({
			schemaVersion: 1,
			role: 'project-audio-mix-v1',
			featureId: AUDIO_FEATURE_ID,
			requirementId: 'publisher-audio-render',
			sourceId: AUDIO_SOURCE_ID,
			trackId: PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.track,
			clipId: PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.clip,
		}),
		videoRenderedFallback: Object.freeze({
			schemaVersion: 1,
			role: 'project-video-render-v1',
			featureId: VIDEO_FEATURE_ID,
			requirementId: 'publisher-video-render',
			sourceId: VIDEO_SOURCE_ID,
			trackId: PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS.track,
			clipId: PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS.clip,
		}),
		requiredAudioSourceIds: Object.freeze([AUDIO_SOURCE_ID]),
		requiredVideoSourceIds: Object.freeze([VIDEO_SOURCE_ID]),
	});
}

function mixedExportProject() {
	return Object.freeze({
		...projectWithFallbackSources(),
		title: 'Mixed fallback export',
		tracks: Object.freeze([
			Object.freeze({ id: 'canonical-audio-track', type: 'audio', clipIds: Object.freeze(['canonical-audio-clip']) }),
			Object.freeze({ id: 'canonical-video-track', type: 'video', clipIds: Object.freeze(['canonical-video-clip']) }),
		]),
		clips: Object.freeze([
			Object.freeze({ id: 'canonical-audio-clip', kind: 'audio', sourceId: 'canonical-audio' }),
			Object.freeze({ id: 'canonical-video-clip', kind: 'video', sourceId: 'canonical-video' }),
		]),
		sources: Object.freeze([
			...projectWithFallbackSources().sources,
			Object.freeze({
				id: 'canonical-audio', kind: 'audio', storageKey: 'canonical-audio',
				channelCount: 2, frameCount: 4, chunkFrames: 4, sampleRate: 48_000,
			}),
			Object.freeze({
				id: 'canonical-video', kind: 'video', storageKey: 'canonical-video',
				frameCount: 4, sampleRate: 48_000, width: 640, height: 360, frameRate: 30,
			}),
		]),
	});
}

function audioSelector(): ProjectAudioFallbackIntegritySelector {
	return Object.freeze({
		requirementId: 'publisher-audio-render',
		featureId: AUDIO_FEATURE_ID,
		role: 'project-audio-mix-v1',
		kind: 'audio',
		sourceId: AUDIO_SOURCE_ID,
		sha256: AUDIO_DIGEST,
		targetTrackId: null,
	});
}

function videoSelector(): ProjectVideoFallbackIntegritySelector {
	return Object.freeze({
		requirementId: 'publisher-video-render',
		featureId: VIDEO_FEATURE_ID,
		role: 'project-video-render-v1',
		kind: 'video',
		sourceId: VIDEO_SOURCE_ID,
		sha256: VIDEO_DIGEST,
		targetClipId: null,
	});
}
