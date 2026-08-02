/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyCanonicalProjectToPlaybackEngine,
	createPlaybackProjectApplyService,
	createPlaybackProjectService,
	PLAYBACK_PROJECT_APPLY_TASK,
} from '../src/common/editor/controller/playback-project-service.ts';
import { EditorControllerLifetime } from '../src/common/editor/controller/lifecycle.ts';
import type { ControllerTrack } from '../src/common/editor/controller/track-domain-types.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS } from '../src/common/editor/project-feature-audio-rendered-fallback.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import { PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS } from '../src/common/editor/project-feature-video-rendered-fallback.ts';
import {
	createAudioClipV9,
	createAudioEditorProjectV9,
	createAudioSourceV9,
	createAudioTrackV9,
	createVideoClipV9,
	createVideoSourceV9,
	createVideoTrackV9,
} from '../src/common/editor/project-v9.ts';

const DIGEST = 'cd'.repeat(32);

function deferred<Value>() {
	let resolve: (value: Value | PromiseLike<Value>) => void = () => undefined;
	const promise = new Promise<Value>((complete) => { resolve = complete; });
	return { promise, resolve };
}

function preparedSources(
	sourceBuffers: ReadonlyMap<string, unknown> = new Map(),
	chunkSources: ReadonlyMap<string, unknown> = new Map(),
	onCommit: () => void = () => undefined,
) {
	return Object.freeze({
		async commit<Result>(apply: (inputs: Readonly<{
			readonly sourceBuffers: ReadonlyMap<string, unknown>;
			readonly chunkSources: ReadonlyMap<string, unknown>;
		}>) => PromiseLike<Result> | Result, options: Readonly<{
			assertCurrent?: () => void;
		}> = {}): Promise<Result> {
			const result = await apply(Object.freeze({ sourceBuffers, chunkSources }));
			options.assertCurrent?.();
			onCommit();
			return result;
		},
		discard() {},
	});
}

function fallbackProject() {
	const source = createAudioSourceV9({
		id: 'original-source', storageKey: 'original-source', frameCount: 4,
		channelCount: 2, sampleRate: 48_000,
	});
	const fallback = createAudioSourceV9({
		id: 'fallback-source', storageKey: 'fallback-source', frameCount: 6,
		channelCount: 2, sampleRate: 48_000,
	});
	const clip = createAudioClipV9({
		id: 'original-clip', sourceId: source.id, durationFrames: 4,
	});
	const track = createAudioTrackV9({
		id: 'original-track', clipIds: [clip.id],
		effects: [createEffect('compressor', { id: 'effect-a' })],
	});
	return createAudioEditorProjectV9({
		id: 'fallback-project', now: '2026-07-30T12:00:00.000Z',
		sources: [source, fallback], clips: [clip], tracks: [track],
		featureRequirements: { schemaVersion: 1, requirements: [{
			id: 'publisher-render',
			featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
			displayName: 'Publisher render',
			disposition: 'rendered-fallback',
			fallback: { kind: 'audio', sourceId: fallback.id, sha256: DIGEST },
		}] },
	});
}

function videoFallbackProject() {
	const original = createVideoSourceV9({
		id: 'original-video', storageKey: 'original-video', frameCount: 4,
		sampleRate: 48_000, width: 1_920, height: 1_080, frameRate: 30,
	});
	const fallback = createVideoSourceV9({
		id: 'fallback-video', storageKey: 'fallback-video', frameCount: 6,
		sampleRate: 48_000, width: 1_280, height: 720, frameRate: 24,
	});
	const clip = createVideoClipV9({
		id: 'original-video-clip', sourceId: original.id, durationFrames: 4,
		videoEffects: [{ id: 'effect-a', type: 'pixelate', enabled: true, params: { blockSize: 12 } }],
	});
	const track = createVideoTrackV9({ id: 'original-video-track', clipIds: [clip.id] });
	return createAudioEditorProjectV9({
		id: 'video-fallback-project', now: '2026-08-01T12:00:00.000Z',
		sources: [original, fallback], clips: [clip], tracks: [track],
		featureRequirements: { schemaVersion: 1, requirements: [{
			id: 'publisher-video-render',
			featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoEffects,
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

test('playback reapply requires the rendered-video body before applying its transient preview project', async () => {
	const canonical = videoFallbackProject();
	const service = createPlaybackProjectService({ audioEffects: true, videoEffects: false });
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
			applyProject(project) { events.push('engine'); assert.strictEqual(project, projected); },
		},
		setReadyStatus() {},
	});

	assert.equal(result, true);
	assert.deepEqual(events, ['audio', 'video', 'engine']);
});

test('the playback service retains the existing bounded bypass path and never traverses future projects', () => {
	const bypass = createAudioEditorProjectV9({
		id: 'bypass', now: '2026-07-30T12:00:00.000Z',
		tracks: [createAudioTrackV9({
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
		schemaVersion: 10,
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

test('playback reapplies only the projected document after required sources are ready', async () => {
	const canonical = fallbackProject();
	const service = createPlaybackProjectService({ audioEffects: false, videoEffects: true });
	const sourceBuffers = new Map<string, unknown>([['ordinary', Object.freeze({})]]);
	const transient = new Map<string, unknown>([['fallback-source', Object.freeze({ fallback: true })]]);
	const sourceChunkProviders = new Map<string, unknown>();
	const events: string[] = [];
	const applied: Array<typeof canonical> = [];
	const result = await applyCanonicalProjectToPlaybackEngine(canonical, {
		projectForPlayback: (project) => service.projectForPlayback(project),
		getCurrentProject: () => canonical,
		ensureProjectSourcesAvailable: async () => assert.fail('required fallback must use staged preparation'),
		prepareRequiredProjectSources: async (project, options) => {
			events.push('sources');
			assert.equal(project.clips[0]?.sourceId, 'fallback-source');
			assert.deepEqual(options.requiredAudioSourceIds, ['fallback-source']);
			return preparedSources(new Map([...sourceBuffers, ...transient]), sourceChunkProviders);
		},
		sourceBuffers,
		sourceChunkProviders,
		engine: {
			getState: () => ({ state: 'stopped', playbackMode: 'normal' }),
			async applyProject(project, buffers, options) {
				events.push('engine');
				applied.push(project);
				assert.equal(buffers.get('ordinary'), sourceBuffers.get('ordinary'));
				assert.equal(buffers.get('fallback-source'), transient.get('fallback-source'));
				assert.strictEqual(options.chunkSources, sourceChunkProviders);
			},
		},
		setReadyStatus: () => { events.push('ready'); },
	});

	assert.equal(result, true);
	assert.deepEqual(events, ['sources', 'engine']);
	assert.equal(applied[0]?.clips?.[0]?.sourceId, 'fallback-source');
	assert.strictEqual(canonical.clips[0]?.sourceId, 'original-source');
});

test('a canonical identity change during source preparation suppresses the stale engine apply', async () => {
	const canonical = fallbackProject();
	let current: typeof canonical | null = canonical;
	let engineCalls = 0;
	let sourceCommits = 0;
	const service = createPlaybackProjectService({ audioEffects: false, videoEffects: true });
	const applied = await applyCanonicalProjectToPlaybackEngine(canonical, {
		projectForPlayback: (project) => service.projectForPlayback(project),
		getCurrentProject: () => current,
		ensureProjectSourcesAvailable: async () => assert.fail('required fallback must use staged preparation'),
		prepareRequiredProjectSources: async () => {
			current = null;
			return preparedSources(new Map(), new Map(), () => { sourceCommits += 1; });
		},
		sourceBuffers: new Map(),
		sourceChunkProviders: new Map(),
		engine: {
			getState: () => ({ state: 'stopped', playbackMode: 'normal' }),
			applyProject() { engineCalls += 1; },
		},
		setReadyStatus() {},
	});
	assert.equal(applied, false);
	assert.equal(engineCalls, 0);
	assert.equal(sourceCommits, 0);
});

test('a canonical identity change during engine apply suppresses staged source publication', async () => {
	const canonical = fallbackProject();
	let current: typeof canonical | null = canonical;
	let sourceCommits = 0;
	const started = deferred<void>();
	const release = deferred<void>();
	const service = createPlaybackProjectService({ audioEffects: false, videoEffects: true });
	const applying = applyCanonicalProjectToPlaybackEngine(canonical, {
		projectForPlayback: (project) => service.projectForPlayback(project),
		getCurrentProject: () => current,
		ensureProjectSourcesAvailable: async () => assert.fail('required fallback must use staged preparation'),
		prepareRequiredProjectSources: async () => preparedSources(
			new Map(), new Map(), () => { sourceCommits += 1; },
		),
		sourceBuffers: new Map(), sourceChunkProviders: new Map(),
		engine: {
			getState: () => ({ state: 'stopped', playbackMode: 'normal' }),
			async applyProject() { started.resolve(); await release.promise; },
		},
		setReadyStatus() {},
	});
	await started.promise;
	current = null;
	release.resolve();
	assert.equal(await applying, false);
	assert.equal(sourceCommits, 0);
});

test('a microtask identity change after engine return suppresses staged source publication', async () => {
	const canonical = fallbackProject();
	let current: typeof canonical | null = canonical;
	let sourceCommits = 0;
	const service = createPlaybackProjectService({ audioEffects: false, videoEffects: true });
	const applied = await applyCanonicalProjectToPlaybackEngine(canonical, {
		projectForPlayback: (project) => service.projectForPlayback(project),
		getCurrentProject: () => current,
		ensureProjectSourcesAvailable: async () => assert.fail('required fallback must use staged preparation'),
		prepareRequiredProjectSources: async () => preparedSources(
			new Map(), new Map(), () => { sourceCommits += 1; },
		),
		sourceBuffers: new Map(), sourceChunkProviders: new Map(),
		engine: {
			getState: () => ({ state: 'stopped', playbackMode: 'normal' }),
			async applyProject() {
				queueMicrotask(() => { current = null; });
			},
		},
		setReadyStatus() {},
	});
	assert.equal(applied, false);
	assert.equal(sourceCommits, 0);
});

test('a newer playback reapply aborts stalled source readiness and alone reaches the engine', async () => {
	const first = { ...fallbackProject(), id: 'first-project' };
	const second = { ...fallbackProject(), id: 'second-project' };
	let current: typeof first | null = first;
	const lifetime = new EditorControllerLifetime();
	const started = deferred<void>();
	const taskNames: string[] = [];
	const sourceSignals: AbortSignal[] = [];
	const appliedProjectIds: string[] = [];
	let sourceCalls = 0;
	const applyService = createPlaybackProjectApplyService({
		lifetime: {
			startTask(name: string) {
				taskNames.push(name);
				return lifetime.startTask(name);
			},
		},
		projectForPlayback: createPlaybackProjectService({
			audioEffects: false, videoEffects: true,
		}).projectForPlayback,
		getCurrentProject: () => current,
		ensureProjectSourcesAvailable: async () => assert.fail('required fallback must use staged preparation'),
		prepareRequiredProjectSources: async (
			_project: typeof first,
			options: Readonly<{ requiredAudioSourceIds: readonly string[]; signal?: AbortSignal }>,
		) => {
			const signal = options.signal;
			assert.ok(signal);
			sourceCalls += 1;
			sourceSignals.push(signal);
			if (sourceCalls !== 1) return preparedSources();
			started.resolve();
			return new Promise<never>((_resolve, reject) => {
				signal.addEventListener('abort', () => { reject(signal.reason); }, { once: true });
			});
		},
		sourceBuffers: new Map(),
		sourceChunkProviders: new Map(),
		engine: {
			getState: () => ({ state: 'stopped', playbackMode: 'normal' }),
			applyProject(project: typeof first) { appliedProjectIds.push(project.id); },
		},
		setReadyStatus() {},
	});

	const firstApply = applyService.apply(first);
	await started.promise;
	current = second;
	const secondApply = applyService.apply(second);
	await assert.rejects(firstApply, (error) => (
		error === sourceSignals[0]?.reason
		&& error instanceof DOMException
		&& error.name === 'AbortError'
	));
	assert.equal(await secondApply, true);
	assert.deepEqual(taskNames, [PLAYBACK_PROJECT_APPLY_TASK, PLAYBACK_PROJECT_APPLY_TASK]);
	assert.deepEqual(appliedProjectIds, ['second-project']);
});
