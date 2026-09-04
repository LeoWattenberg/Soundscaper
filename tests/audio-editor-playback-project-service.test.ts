/* SPDX-License-Identifier: AGPL-3.0-only */

import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyCanonicalProjectToPlaybackEngine,
	createPlaybackProjectService,
} from '../src/common/editor/controller/playback-project-service.ts';
import type { ControllerTrack } from '../src/common/editor/controller/track-domain-types.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS } from '../src/common/editor/project-feature-audio-rendered-fallback.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import { PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS } from '../src/common/editor/project-feature-video-rendered-fallback.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
	createVideoClip,
	createVideoSource,
	createVideoTrack,
} from '../src/common/editor/project-media-factory.ts';

const DIGEST = 'cd'.repeat(32);


function preparedSources(
	sourceBuffers: ReadonlyMap<string, unknown> = new Map(),
	chunkSources: ReadonlyMap<string, unknown> = new Map(),
	onCommit: () => void = () => undefined,
	onDiscard: () => PromiseLike<void> | void = () => undefined,
) {
	return Object.freeze({
		async commit<Result>(apply: (inputs: Readonly<{
			readonly sourceBuffers: ReadonlyMap<string, unknown>;
			readonly chunkSources: ReadonlyMap<string, unknown>;
		}>) => PromiseLike<Result> | Result, options: Readonly<{
			assertCurrent?: () => void;
			retireApplied?: () => PromiseLike<void> | void;
		}> = {}): Promise<Result> {
			try {
				const result = await apply(Object.freeze({ sourceBuffers, chunkSources }));
				options.assertCurrent?.();
				onCommit();
				return result;
			} catch (error) {
				await options.retireApplied?.();
				throw error;
			}
		},
		discard: onDiscard,
	});
}

function fallbackProject(featureId: string = PROJECT_FEATURE_CAPABILITY_IDS.audioEffects) {
	const source = createAudioSource({
		id: 'original-source', storageKey: 'original-source', frameCount: 4,
		channelCount: 2, sampleRate: 48_000,
	});
	const fallback = createAudioSource({
		id: 'fallback-source', storageKey: 'fallback-source', frameCount: 6,
		channelCount: 2, sampleRate: 48_000,
	});
	const clip = createAudioClip({
		id: 'original-clip', sourceId: source.id, durationFrames: 4,
	});
	const track = createAudioTrack({
		id: 'original-track', clipIds: [clip.id],
		effects: [createEffect('compressor', { id: 'effect-a' })],
	});
	return createCurrentAudioEditorProject({
		id: 'fallback-project', now: '2026-07-30T12:00:00.000Z',
		sources: [source, fallback], clips: [clip], tracks: [track],
		featureRequirements: { schemaVersion: 1, requirements: [{
			id: 'publisher-render',
			featureId,
			displayName: 'Publisher render',
			disposition: 'rendered-fallback',
			fallback: { kind: 'audio', sourceId: fallback.id, sha256: DIGEST },
		}] },
	});
}

function videoFallbackProject(featureId: string = PROJECT_FEATURE_CAPABILITY_IDS.videoEffects) {
	const original = createVideoSource({
		id: 'original-video', storageKey: 'original-video', frameCount: 4,
		sampleRate: 48_000, width: 1_920, height: 1_080, frameRate: 30,
	});
	const fallback = createVideoSource({
		id: 'fallback-video', storageKey: 'fallback-video', frameCount: 6,
		sampleRate: 48_000, width: 1_280, height: 720, frameRate: 24,
	});
	const clip = createVideoClip({
		id: 'original-video-clip', sourceId: original.id, durationFrames: 4,
		videoEffects: [{ id: 'effect-a', type: 'pixelate', enabled: true, params: { blockSize: 12 } }],
	});
	const track = createVideoTrack({ id: 'original-video-track', clipIds: [clip.id] });
	return createCurrentAudioEditorProject({
		id: 'video-fallback-project', now: '2026-08-01T12:00:00.000Z',
		sources: [original, fallback], clips: [clip], tracks: [track],
		featureRequirements: { schemaVersion: 1, requirements: [{
			id: 'publisher-video-render',
			featureId,
			displayName: 'Publisher video render',
			disposition: 'rendered-fallback',
			fallback: { kind: 'video', sourceId: fallback.id, sha256: DIGEST },
		}] },
	});
}

test('the playback service composes capability evaluation with a required rendered-audio source', () => {
	const canonical = fallbackProject();
	const service = createPlaybackProjectService({
		audioEffects: false,
		videoEffects: true,
	});
	const result = service.projectForPlayback(canonical);

	assert.equal(result.featureRequirementsReport?.compatible, false);
	assert.equal(result.audioEffectPlaybackBypass, null);
	assert.equal(result.videoEffectPlaybackBypass, null);
	assert.equal(result.audioRenderedFallback?.sourceId, 'fallback-source');
	assert.deepEqual(result.requiredAudioSourceIds, ['fallback-source']);
	assert.deepEqual(result.project.tracks.map((track) => track.id), [
		PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.track,
	]);
	assert.strictEqual((canonical.tracks[0] as ControllerTrack | undefined)?.effects?.[0]?.type, 'compressor');
	assert.equal(Object.isFrozen(result), true);
	assert.equal(Object.isFrozen(result.requiredAudioSourceIds), true);
});

test('an unknown whole-mix role is projected and staged without a registered feature capability', async () => {
	const featureId = 'org.example.future-mixer';
	const canonical = fallbackProject(featureId);
	const service = createPlaybackProjectService({ audioEffects: true, videoEffects: true });
	const projection = service.projectForPlayback(canonical);

	assert.equal(projection.featureRequirementsReport?.items[0]?.availability, 'unknown');
	assert.equal(projection.audioRenderedFallback?.featureId, featureId);
	assert.deepEqual(projection.requiredAudioSourceIds, ['fallback-source']);

	const events: string[] = [];
	await applyCanonicalProjectToPlaybackEngine(canonical, {
		projectForPlayback: (project) => service.projectForPlayback(project),
		getCurrentProject: () => canonical,
		ensureProjectSourcesAvailable: async () => assert.fail('the required whole mix is staged privately'),
		prepareRequiredProjectSources: async (project, options) => {
			events.push('stage');
			assert.equal(project.clips[0]?.sourceId, 'fallback-source');
			assert.deepEqual(options.requiredAudioSourceIds, ['fallback-source']);
			return preparedSources(new Map([['fallback-source', 'verified-pcm']]));
		},
		sourceBuffers: new Map(),
		sourceChunkProviders: new Map(),
		engine: {
			getState: () => ({ state: 'stopped', playbackMode: 'normal' }),
			stop() {},
			applyProject(project, sourceBuffers) {
				events.push('engine');
				assert.equal(project.clips[0]?.sourceId, 'fallback-source');
				assert.equal(sourceBuffers.get('fallback-source'), 'verified-pcm');
			},
		},
		setReadyStatus() {},
	});
	assert.deepEqual(events, ['stage', 'engine']);
});

test('a track-render fallback replaces one lane while other tracks stay native surfaces', () => {
	const source = createAudioSource({
		id: 'fx-lane-source', storageKey: 'fx-lane-source', frameCount: 4, channelCount: 2, sampleRate: 48_000,
	});
	const drySource = createAudioSource({
		id: 'dry-lane-source', storageKey: 'dry-lane-source', frameCount: 4, channelCount: 2, sampleRate: 48_000,
	});
	const fallback = createAudioSource({
		id: 'track-render-source', storageKey: 'track-render-source', frameCount: 4, channelCount: 2, sampleRate: 48_000,
	});
	const fxClip = createAudioClip({ id: 'fx-clip', sourceId: source.id, durationFrames: 4 });
	const dryClip = createAudioClip({ id: 'dry-clip', sourceId: drySource.id, durationFrames: 4 });
	const canonical = createCurrentAudioEditorProject({
		id: 'track-render-project', now: '2026-08-08T12:00:00.000Z',
		sources: [source, drySource, fallback], clips: [fxClip, dryClip],
		tracks: [
			createAudioTrack({
				id: 'fx-track', clipIds: [fxClip.id],
				effects: [createEffect('compressor', { id: 'effect-a' })],
			}),
			createAudioTrack({ id: 'dry-track', clipIds: [dryClip.id] }),
		],
		featureRequirements: { schemaVersion: 2, requirements: [{
			id: 'publisher-track-render', featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
			displayName: 'Publisher track render', disposition: 'rendered-fallback',
			fallback: {
				role: 'audio-track-render-v1', kind: 'audio',
				sourceId: fallback.id, sha256: DIGEST, targetTrackId: 'fx-track',
			},
		}] },
	});
	const before = structuredClone(canonical);

	const projection = createPlaybackProjectService({ audioEffects: false, videoEffects: true })
		.projectForPlayback(canonical);

	assert.equal(projection.audioRenderedFallback?.role, 'audio-track-render-v1');
	assert.equal(projection.audioRenderedFallback?.targetTrackId, 'fx-track');
	assert.ok(projection.requiredAudioSourceIds.includes('track-render-source'));
	const projected = projection.project;
	const fxTrack = projected.tracks.find(({ id }) => id === 'fx-track');
	const dryTrack = projected.tracks.find(({ id }) => id === 'dry-track');
	assert.notDeepEqual(fxTrack?.clipIds, ['fx-clip'],
		'the target lane must be replaced by the reserved render clip');
	assert.deepEqual(dryTrack?.clipIds, ['dry-clip'], 'other lanes must stay canonical native surfaces');
	assert.ok(projected.clips.some(({ sourceId }) => sourceId === 'track-render-source'),
		'the reserved render clip must play the fallback body');
	assert.ok(projected.clips.some(({ id }) => id === 'dry-clip'));
	assert.deepEqual(canonical, before, 'the canonical project must remain unchanged');
});

test('the playback service composes a required rendered-video preview without mutating its source project', () => {
	const canonical = videoFallbackProject();
	const service = createPlaybackProjectService({ audioEffects: true, videoEffects: false });
	const result = service.projectForPlayback(canonical);

	assert.equal(result.featureRequirementsReport?.compatible, false);
	assert.equal(result.audioRenderedFallback, null);
	assert.equal(result.audioEffectPlaybackBypass, null);
	assert.equal(result.videoEffectPlaybackBypass, null);
	assert.equal(result.videoRenderedFallback?.sourceId, 'fallback-video');
	assert.deepEqual(result.requiredAudioSourceIds, []);
	assert.deepEqual(result.requiredVideoSourceIds, ['fallback-video']);
	assert.deepEqual(result.project.tracks.map((track) => track.id), [
		PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS.track,
	]);
	assert.equal(result.project.clips[0]?.sourceId, 'fallback-video');
	assert.equal(canonical.clips[0]?.sourceId, 'original-video');
	assert.equal(Object.isFrozen(result.requiredVideoSourceIds), true);
});

test('playback reapply stages an unknown whole-project video fallback before preview', async () => {
	const featureId = 'org.example.future-video-pipeline';
	const canonical = videoFallbackProject(featureId);
	const service = createPlaybackProjectService({ audioEffects: true, videoEffects: true });
	const projection = service.projectForPlayback(canonical);
	assert.equal(projection.featureRequirementsReport?.items[0]?.availability, 'unknown');
	assert.equal(projection.videoRenderedFallback?.featureId, featureId);
	const events: string[] = [];
	const result = await applyCanonicalProjectToPlaybackEngine(canonical, {
		projectForPlayback: (project) => service.projectForPlayback(project),
		getCurrentProject: () => canonical,
		ensureProjectSourcesAvailable: async (project, options) => {
			events.push('video');
			assert.equal(project.clips[0]?.sourceId, 'fallback-video');
			assert.deepEqual(options.excludedAudioSourceIds, []);
			assert.deepEqual(options.requiredAudioSourceIds, []);
			assert.deepEqual(options.requiredVideoSourceIds, ['fallback-video']);
			return new Map();
		},
		prepareRequiredProjectSources: async () => assert.fail('video fallback does not prepare PCM'),
		sourceBuffers: new Map(),
		sourceChunkProviders: new Map(),
		engine: {
			getState: () => ({ state: 'stopped', playbackMode: 'normal' }),
			stop() {},
			applyProject(project) {
				events.push('engine');
				assert.equal(project.clips[0]?.sourceId, 'fallback-video');
			},
		},
		setReadyStatus() {},
	});

	assert.equal(result, true);
	assert.deepEqual(events, ['video', 'engine']);
});

test('combined fallback reapply keeps staged audio out of direct video readiness', async () => {
	const canonical: Record<string, unknown> = { id: 'combined-canonical' };
	const projected: Record<string, unknown> = { id: 'combined-projected' };
	const events: string[] = [];
	const result = await applyCanonicalProjectToPlaybackEngine(canonical, {
		projectForPlayback: () => Object.freeze({
			project: projected,
			featureRequirementsReport: null,
			audioEffectPlaybackBypass: null,
			audioRenderedFallback: null,
			videoEffectPlaybackBypass: null,
			videoRenderedFallback: null,
			requiredAudioSourceIds: Object.freeze(['fallback-audio']),
			requiredVideoSourceIds: Object.freeze(['fallback-video']),
		}),
		getCurrentProject: () => canonical,
		ensureProjectSourcesAvailable: async (_project, options) => {
			events.push('video');
			assert.deepEqual(options.excludedAudioSourceIds, ['fallback-audio']);
			assert.deepEqual(options.requiredAudioSourceIds, []);
			assert.deepEqual(options.requiredVideoSourceIds, ['fallback-video']);
			return new Map();
		},
		prepareRequiredProjectSources: async (_project, options) => {
			events.push('audio');
			assert.deepEqual(options.requiredAudioSourceIds, ['fallback-audio']);
			return preparedSources();
		},
		sourceBuffers: new Map(), sourceChunkProviders: new Map(),
		engine: {
			getState: () => ({ state: 'stopped', playbackMode: 'normal' }),
			stop() {},
			applyProject(project) { events.push('engine'); assert.strictEqual(project, projected); },
		},
		setReadyStatus() {},
	});

	assert.equal(result, true);
	assert.deepEqual(events, ['audio', 'video', 'engine']);
});

test('the playback service retains the existing bounded bypass path and never traverses future projects', () => {
	const bypass = createCurrentAudioEditorProject({
		id: 'bypass', now: '2026-07-30T12:00:00.000Z',
		tracks: [createAudioTrack({
			id: 'track', effects: [createEffect('limiter', { id: 'limiter-a' })],
		})],
	});
	const service = createPlaybackProjectService({ audioEffects: false, videoEffects: true });
	const projected = service.projectForPlayback(bypass);
	assert.equal(projected.audioRenderedFallback, null);
	assert.deepEqual(projected.requiredAudioSourceIds, []);
	assert.equal(projected.videoRenderedFallback, null);
	assert.deepEqual(projected.requiredVideoSourceIds, []);
	assert.equal(projected.audioEffectPlaybackBypass?.placeholders[0]?.effectId, 'limiter-a');
	assert.equal((projected.project.tracks[0] as ControllerTrack | undefined)?.effects?.[0]?.bypassed, true);

	const future = {
		...bypass,
		schemaVersion: 18,
		get featureRequirements(): never { throw new Error('future feature requirements were traversed'); },
		get tracks(): never { throw new Error('future tracks were traversed'); },
	};
	const unchanged = service.projectForPlayback(future);
	assert.strictEqual(unchanged.project, future);
	assert.equal(unchanged.featureRequirementsReport, null);
	assert.equal(unchanged.audioRenderedFallback, null);
	assert.deepEqual(unchanged.requiredAudioSourceIds, []);
	assert.equal(unchanged.videoRenderedFallback, null);
	assert.deepEqual(unchanged.requiredVideoSourceIds, []);
});
