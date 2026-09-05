/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { throwIfAborted } from '../src/common/editor/controller/app-helpers.ts';
import {
	NYQUIST_EVALUATION_TASK,
	createSelectionEffectExecutionService,
} from '../src/common/editor/controller/effect-execution-service.ts';
import {
	EDITOR_PROJECT_TASK_SCOPE,
	EditorControllerLifetime,
	EditorProjectGeneration,
	type EditorProjectToken,
	type EditorTaskScope,
} from '../src/common/editor/controller/lifecycle.ts';
import {
	freezeNyquistResult,
	mixNyquistPreviewChannels,
	normalizeNyquistRole,
	nyquistAudioResultBytes,
	nyquistMaximumOutputFrames,
	nyquistResultStatus,
} from '../src/common/editor/controller/nyquist-audio.ts';
import { createFixture, deferred, project } from './helpers/audio-editor-project-switch-fixture.ts';

interface NyquistHarnessState {
	audacityEffectProcessing: boolean;
	nyquistAbort: EditorTaskScope | null;
	nyquistResult: unknown;
	audacityControlTrackId: string | null;
	lastAudacityEffect: unknown;
}

interface PersistCall {
	readonly results: readonly unknown[];
	readonly committed: boolean;
	readonly refusal: unknown;
}

function createNyquistHarness() {
	const lifetime = new EditorControllerLifetime();
	const projectGeneration = new EditorProjectGeneration();
	projectGeneration.activate('project-a');
	const state: NyquistHarnessState = {
		audacityEffectProcessing: false,
		nyquistAbort: null,
		nyquistResult: null,
		audacityControlTrackId: null,
		lastAudacityEffect: null,
	};
	const evaluation = deferred<Readonly<Record<string, unknown>>>();
	const persistEntered = deferred<void>();
	const persistGate = deferred<void>();
	const persistCalls: PersistCall[] = [];
	const target = {
		track: { id: 'track-a' },
		startFrame: 0,
		endFrame: 16,
		durationFrames: 16,
		channelCount: 1,
		clipIds: ['clip-a'],
		hasAudio: true,
	};
	const service = createSelectionEffectExecutionService({
		lifetime,
		captureProject: () => projectGeneration.capture(),
		assertProject: (token: EditorProjectToken) => { projectGeneration.assertCurrent(token); },
		NYQUIST_AGGREGATE_AUDIO_LIMIT_BYTES: 1_000_000_000,
		abortError: () => new DOMException('Aborted.', 'AbortError'),
		activeSelection: () => ({ startFrame: 0, endFrame: 16 }),
		audacityEffectMemoryError: () => new Error('Too large'),
		audacityEffectSelectionDetails: () => ({ trackIds: ['track-a'], clipIds: ['clip-a'], frequencyRange: null }),
		audacityEffectTargets: () => [target],
		cancelAudacityEffectPreview: () => undefined,
		copy: { audacityProcessing: 'Processing', audacitySelectionHint: 'Select audio', done: 'Done' },
		editingBlocked: () => false,
		freezeNyquistResult,
		mixNyquistPreviewChannels,
		normalizeNyquistRole,
		nyquistAudioResultBytes,
		nyquistEvaluator: async () => evaluation.promise,
		nyquistHostProperties: () => ({}),
		nyquistMaximumOutputFrames,
		nyquistResultStatus,
		persistAudacityEffectResults: async (
			results: readonly unknown[],
			_type: unknown,
			options: Readonly<{ assertCurrent?: () => void }> = {},
		) => {
			persistEntered.resolve();
			await persistGate.promise;
			try {
				options.assertCurrent?.();
			} catch (refusal) {
				persistCalls.push({ results, committed: false, refusal });
				throw refusal;
			}
			persistCalls.push({ results, committed: true, refusal: null });
			return [];
		},
		persistNyquistGeneratedAudio: async () => undefined,
		persistNyquistLabels: () => undefined,
		playNyquistPreview: async () => undefined,
		preflightStorage: async () => undefined,
		getProject: () => ({ id: 'project-a' }),
		projectDurationFrames: () => 1_000,
		projectSampleRate: () => 48_000,
		publishDocumentSnapshot: () => undefined,
		renderDryTrackRange: async () => [new Float32Array(16)],
		setStatus: () => undefined,
		state,
		throwIfAborted,
		updateTaskProgress: () => undefined,
	});
	return {
		evaluation, lifetime, persistCalls, persistEntered, persistGate, projectGeneration, service, state,
	};
}

const NYQUIST_AUDIO = Object.freeze({
	type: 'audio', sampleRate: 48_000, frameCount: 16, channels: [new Float32Array(16)],
});

test('a Nyquist replacement refuses to commit once the editor owns a different project', async () => {
	const harness = createNyquistHarness();
	const run = harness.service.runNyquistEvaluation({ source: '(mult s 2)', role: 'process' });
	await Promise.resolve();
	assert.ok(harness.state.nyquistAbort, 'the evaluation should register a cancellable handle');
	harness.evaluation.resolve(NYQUIST_AUDIO);
	await harness.persistEntered.promise;

	harness.projectGeneration.invalidate();
	harness.projectGeneration.activate('project-b');
	harness.persistGate.resolve();

	assert.equal(await run, null, 'a superseded evaluation reports cancellation rather than a result');
	assert.equal(harness.persistCalls.length, 1);
	assert.equal(harness.persistCalls[0]?.committed, false, 'the Nyquist result must not commit into the current project');
	assert.equal((harness.persistCalls[0]?.refusal as Readonly<{ name?: string }>)?.name, 'AbortError');
});

test('a Nyquist evaluation superseded before persistence never reaches the result service', async () => {
	const harness = createNyquistHarness();
	harness.persistGate.resolve();
	const run = harness.service.runNyquistEvaluation({ source: '(mult s 2)', role: 'process' });
	await Promise.resolve();

	harness.projectGeneration.invalidate();
	harness.projectGeneration.activate('project-b');
	harness.evaluation.resolve(NYQUIST_AUDIO);

	assert.equal(await run, null);
	assert.deepEqual(harness.persistCalls, []);
});

test('switching projects aborts an in-flight Nyquist evaluation', async () => {
	const fixture = createFixture();
	const nyquistAbort = fixture.lifetime.startTask(NYQUIST_EVALUATION_TASK, {
		scope: EDITOR_PROJECT_TASK_SCOPE,
	});
	fixture.state.nyquistAbort = nyquistAbort;

	await fixture.service.switchProject(project('next-project'));

	assert.equal(nyquistAbort.signal.aborted, true, 'a project switch must cancel Nyquist work started under the old project');
	assert.equal(fixture.state.nyquistAbort, null);
});

test('reactivating the active project preserves an in-flight Nyquist evaluation', async () => {
	const fixture = createFixture();
	const activeProject = fixture.getProject();
	assert.ok(activeProject);
	const nyquistAbort = fixture.lifetime.startTask(NYQUIST_EVALUATION_TASK, {
		scope: EDITOR_PROJECT_TASK_SCOPE,
	});
	fixture.state.nyquistAbort = nyquistAbort;

	await fixture.service.switchProject(activeProject);

	assert.equal(nyquistAbort.signal.aborted, false);
	assert.strictEqual(fixture.state.nyquistAbort, nyquistAbort);
});
