/* SPDX-License-Identifier: AGPL-3.0-only */

import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyCanonicalProjectToPlaybackEngine,
	createPlaybackProjectApplyService,
	createPlaybackProjectService,
	PLAYBACK_PROJECT_APPLY_TASK,
} from '../src/common/editor/controller/playback-project-service.ts';
import { EditorControllerLifetime } from '../src/common/editor/controller/lifecycle.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';

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


/**
 * What a playback reapply does when the project moves underneath it.
 *
 * Preparing sources and applying to the engine both await, and the user can switch or edit
 * the project in either gap. Every case here is one such gap: the apply that must be
 * suppressed, the staged publication that must not land, and the stalled readiness a newer
 * reapply must abort so only the latest reaches the engine.
 *
 * `tests/audio-editor-playback-project-service.test.ts` covers what a fallback-substituted
 * project looks like once composed.
 */

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
			stop() {},
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

test('playback reapply awaits staged cleanup and preserves primary cleanup context', async () => {
	const canonical = fallbackProject();
	const service = createPlaybackProjectService({ audioEffects: false, videoEffects: true });
	const engineFailure = new Error('engine apply failed');
	const cleanupFailure = new Error('provider cleanup failed');
	const gate = deferred<void>();
	const cleanupStarted = deferred<void>();
	let engineStopped = false;
	const applying = applyCanonicalProjectToPlaybackEngine(canonical, {
		projectForPlayback: (project) => service.projectForPlayback(project),
		getCurrentProject: () => canonical,
		ensureProjectSourcesAvailable: async () => assert.fail('required fallback must use staged preparation'),
		prepareRequiredProjectSources: async () => preparedSources(
			new Map(),
			new Map(),
			() => undefined,
			async () => {
				assert.equal(engineStopped, true);
				cleanupStarted.resolve();
				await gate.promise;
				throw cleanupFailure;
			},
		),
		sourceBuffers: new Map(),
		sourceChunkProviders: new Map(),
		engine: {
			getState: () => ({ state: 'stopped', playbackMode: 'normal' }),
			stop() { engineStopped = true; },
			applyProject() { throw engineFailure; },
		},
		setReadyStatus() {},
	});
	await cleanupStarted.promise;
	let settled = false;
	void applying.finally(() => { settled = true; }).catch(() => undefined);
	await Promise.resolve();
	assert.equal(settled, false);
	gate.resolve();
	await assert.rejects(applying, (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.deepEqual(error.errors, [engineFailure, cleanupFailure]);
		assert.strictEqual(error.cause, engineFailure);
		return true;
	});
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
			stop() {},
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
			stop() {},
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
			stop() {},
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
			stop() {},
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
