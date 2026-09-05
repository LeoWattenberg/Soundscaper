/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { throwIfAborted } from '../src/common/editor/controller/app-helpers.ts';
import { createSelectionEffectExecutionService } from '../src/common/editor/controller/effect-execution-service.ts';
import type { EffectTarget } from '../src/common/editor/controller/effect-selection-service.ts';
import {
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
import {
	createNyquistGeneratedAudioService,
	type NyquistGeneratedAudioProject,
	type NyquistGeneratedAudioState,
	type PersistNyquistAudioOptions,
} from '../src/common/editor/controller/nyquist-generated-audio-service.ts';
import { deferred } from './helpers/audio-editor-project-switch-fixture.ts';

interface GeneratorCall {
	readonly assertCurrentKind: string;
	readonly committed: boolean;
	readonly refusal: unknown;
}

interface ExecutionHarnessState {
	audacityEffectProcessing: boolean;
	nyquistAbort: EditorTaskScope | null;
	nyquistResult: unknown;
	audacityControlTrackId: string | null;
	lastAudacityEffect: unknown;
}

const NYQUIST_AUDIO = Object.freeze({
	type: 'audio', sampleRate: 48_000, frameCount: 16, channels: [new Float32Array(16)],
});

/** Drives runNyquistEvaluation's generate branch with a gated generator persistence. */
function createExecutionHarness() {
	const lifetime = new EditorControllerLifetime();
	const projectGeneration = new EditorProjectGeneration();
	projectGeneration.activate('project-a');
	const state: ExecutionHarnessState = {
		audacityEffectProcessing: false,
		nyquistAbort: null,
		nyquistResult: null,
		audacityControlTrackId: null,
		lastAudacityEffect: null,
	};
	const evaluation = deferred<Readonly<Record<string, unknown>>>();
	const persistEntered = deferred<void>();
	const persistGate = deferred<void>();
	const generatorCalls: GeneratorCall[] = [];
	const service = createSelectionEffectExecutionService({
		lifetime,
		captureProject: () => projectGeneration.capture(),
		assertProject: (token: EditorProjectToken) => { projectGeneration.assertCurrent(token); },
		NYQUIST_AGGREGATE_AUDIO_LIMIT_BYTES: 1_000_000_000,
		abortError: () => new DOMException('Aborted.', 'AbortError'),
		activeSelection: () => null,
		audacityEffectMemoryError: () => new Error('Too large'),
		audacityEffectSelectionDetails: () => ({ trackIds: [], clipIds: [], frequencyRange: null }),
		audacityEffectTargets: () => [],
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
		persistAudacityEffectResults: async () => [],
		persistNyquistGeneratedAudio: async (
			_channels: readonly Float32Array[],
			options: PersistNyquistAudioOptions = {},
		) => {
			persistEntered.resolve();
			await persistGate.promise;
			const assertCurrentKind = typeof options.assertCurrent;
			try {
				options.assertCurrent?.();
			} catch (refusal) {
				generatorCalls.push({ assertCurrentKind, committed: false, refusal });
				throw refusal;
			}
			generatorCalls.push({ assertCurrentKind, committed: true, refusal: null });
			return 'clip-1';
		},
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
	return { evaluation, generatorCalls, persistEntered, persistGate, projectGeneration, service, state };
}

test('a Nyquist generator refuses to commit once the editor owns a different project', async () => {
	const harness = createExecutionHarness();
	const run = harness.service.runNyquistEvaluation({ source: '(osc 60)', role: 'generate' });
	await Promise.resolve();
	assert.ok(harness.state.nyquistAbort, 'the evaluation should register a cancellable handle');
	harness.evaluation.resolve(NYQUIST_AUDIO);
	await harness.persistEntered.promise;

	harness.projectGeneration.invalidate();
	harness.projectGeneration.activate('project-b');
	harness.persistGate.resolve();

	assert.equal(await run, null, 'a superseded generator reports cancellation rather than a result');
	assert.equal(harness.generatorCalls.length, 1);
	assert.equal(
		harness.generatorCalls[0]?.assertCurrentKind,
		'function',
		"the generate branch must carry the evaluation's ownership assertion",
	);
	assert.equal(
		harness.generatorCalls[0]?.committed,
		false,
		'the generated audio must not commit into the current project',
	);
	assert.equal((harness.generatorCalls[0]?.refusal as Readonly<{ name?: string }>)?.name, 'AbortError');
});

interface GeneratedAudioHarnessOptions {
	readonly selection?: boolean;
	readonly onReplacement?: (options: Readonly<{ assertCurrent?: (() => void) | null }>) => void;
}

/** Exercises the generated-audio persistence directly, with a caller-owned assertion. */
function createGeneratedAudioHarness(options: GeneratedAudioHarnessOptions = {}) {
	let project: NyquistGeneratedAudioProject = {
		id: 'project-a', schemaVersion: 5, title: 'Project', sampleRate: 1_000,
		tracks: [{ id: 'track-a', name: 'Track', type: 'audio', clipIds: [] }],
		clips: [],
		selection: options.selection ? { startFrame: 100, endFrame: 200, trackIds: ['track-a'] } : null,
	};
	const state: NyquistGeneratedAudioState = { selectedTrackId: 'track-a' };
	const target: EffectTarget = {
		track: project.tracks[0]!, startFrame: 100, endFrame: 200, durationFrames: 100,
		channelCount: 1, hasAudio: true,
	};
	const projectGeneration = new EditorProjectGeneration();
	projectGeneration.activate(project.id);
	const commands: unknown[] = [];
	const replacementOptions: Array<Readonly<{ assertCurrent?: unknown }>> = [];
	let beginWrites = 0;
	let id = 0;
	const service = createNyquistGeneratedAudioService({
		state,
		copy: {
			effectChannelLengthsMismatch: 'Channel mismatch', effectInvalidAudio: 'Invalid audio',
			nyquistPrompt: 'Nyquist Prompt',
		},
		sourceChunkFrames: 64,
		getProject: () => project,
		captureProject: () => projectGeneration.capture(project.id),
		assertProject: (token) => { projectGeneration.assertCurrent(token); },
		activeSelection: () => project.selection ?? null,
		audacityEffectTarget: () => target,
		persistAudacityEffectResult: async (_target, _type, _channels, persistOptions) => {
			replacementOptions.push(persistOptions);
			options.onReplacement?.(persistOptions);
			return 'replacement';
		},
		matchAudacitySelectionChannels: (channels, count) => channels.slice(0, count),
		assertAudioOutput: () => undefined,
		projectSampleRate: () => project.sampleRate,
		preflightStorage: async () => undefined,
		createId: (prefix) => `${prefix}-${++id}`,
		getAudioContext: async () => ({}),
		bufferFromChannels: async (channels) => ({
			numberOfChannels: channels.length,
			length: channels[0]?.length ?? 0,
			getChannelData: (index: number) => channels[index]!,
		}),
		store: {
			beginSourceWrite: async () => {
				beginWrites += 1;
				return { write: async () => undefined, commit: async () => undefined, abort: async () => undefined };
			},
			saveAnalysis: async () => undefined,
			deleteAnalysis: async () => undefined,
			deleteSource: async () => undefined,
		},
		writeBuffer: async () => undefined,
		snapTimelineFrame: (frame) => Math.round(Number(frame)),
		getPositionFrames: () => 250,
		cacheSourceBuffer: () => undefined,
		generateWaveformPeaks: async () => ({ minimum: [-1], maximum: [1] }),
		peakCacheKey: (sourceId) => `peaks:${sourceId}`,
		sourceBuffers: new Map<string, unknown>(),
		sourcePeaks: new Map<string, unknown>(),
		commit: (command) => { commands.push(command); },
	});
	return {
		get beginWrites() { return beginWrites; },
		commands,
		projectGeneration,
		replacementOptions,
		service,
		switchProject() {
			project = { ...project, id: 'project-b' };
			projectGeneration.invalidate();
			projectGeneration.activate(project.id);
		},
	};
}

test("the generator branch obeys the caller's ownership assertion, not a token minted at entry", async () => {
	const harness = createGeneratedAudioHarness();
	const evaluationToken = harness.projectGeneration.capture();
	harness.switchProject();

	await assert.rejects(
		() => harness.service.persistNyquistGeneratedAudio([new Float32Array([0.1, 0.2])], {
			name: 'Tone',
			assertCurrent: () => { harness.projectGeneration.assertCurrent(evaluationToken); },
		}),
		{ code: 'PROJECT_CHANGED' },
	);
	assert.equal(harness.beginWrites, 0, 'a refused generator must not allocate storage');
	assert.equal(harness.commands.length, 0, 'a refused generator must not commit into the new project');
});

test("the replacement branch hands the caller's ownership assertion to the effect-result owner", async () => {
	let refusal: unknown = null;
	const harness = createGeneratedAudioHarness({
		selection: true,
		onReplacement: (persistOptions) => {
			harness.switchProject();
			try {
				persistOptions.assertCurrent?.();
			} catch (error) {
				refusal = error;
				throw error;
			}
		},
	});
	const evaluationToken = harness.projectGeneration.capture();

	await assert.rejects(
		() => harness.service.persistNyquistGeneratedAudio([new Float32Array(100)], {
			name: 'Generated',
			assertCurrent: () => { harness.projectGeneration.assertCurrent(evaluationToken); },
		}),
		{ code: 'PROJECT_CHANGED' },
	);
	assert.equal(harness.replacementOptions.length, 1);
	assert.equal(
		typeof harness.replacementOptions[0]?.assertCurrent,
		'function',
		'the effect-result owner must be able to refuse mid-flight, not only after it commits',
	);
	assert.equal((refusal as Readonly<{ code?: string }>)?.code, 'PROJECT_CHANGED');
});
