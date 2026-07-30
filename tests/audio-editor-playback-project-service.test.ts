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
import {
	createAudioClipV9,
	createAudioEditorProjectV9,
	createAudioSourceV9,
	createAudioTrackV9,
} from '../src/common/editor/project-v9.ts';

const DIGEST = 'cd'.repeat(32);

function deferred<Value>() {
	let resolve: (value: Value | PromiseLike<Value>) => void = () => undefined;
	const promise = new Promise<Value>((complete) => { resolve = complete; });
	return { promise, resolve };
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
		ensureProjectSourcesAvailable: async (project, options) => {
			events.push('sources');
			assert.equal(project.clips[0]?.sourceId, 'fallback-source');
			assert.deepEqual(options.requiredAudioSourceIds, ['fallback-source']);
			return transient;
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
	const service = createPlaybackProjectService({ audioEffects: false, videoEffects: true });
	const applied = await applyCanonicalProjectToPlaybackEngine(canonical, {
		projectForPlayback: (project) => service.projectForPlayback(project),
		getCurrentProject: () => current,
		ensureProjectSourcesAvailable: async () => {
			current = null;
			return new Map();
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
		ensureProjectSourcesAvailable: async (
			_project: typeof first,
			options: Readonly<{ requiredAudioSourceIds: readonly string[]; signal?: AbortSignal }>,
		) => {
			const signal = options.signal;
			assert.ok(signal);
			sourceCalls += 1;
			sourceSignals.push(signal);
			if (sourceCalls !== 1) return new Map();
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
