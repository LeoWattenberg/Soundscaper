/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEffectMacroService } from '../../src/common/editor/controller/effects/internal/macro/effect-macro-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../../src/common/editor/controller/shared/lifecycle.ts';
import type { EffectTarget } from '../../src/common/editor/controller/effects/effect-selection-service.ts';
import type { SelectionEffectResult } from '../../src/common/editor/controller/effects/internal/effect-result-service.ts';

function deferred<Value>() {
	let resolve: (value: Value) => void = () => undefined;
	let reject: (error: unknown) => void = () => undefined;
	const promise = new Promise<Value>((accept, decline) => { resolve = accept; reject = decline; });
	return { promise, reject, resolve };
}

export function createHarness(options: Readonly<{
	blocked?: boolean;
	deferPersistence?: boolean;
	memoryLimitBytes?: number;
	target?: boolean;
	audacityRack?: boolean;
	project?: Readonly<Record<string, unknown>>;
	validateRenderSnapshot?: (project: Readonly<Record<string, unknown>>) => void;
	multipleTargets?: boolean;
	targetClipIds?: readonly string[];
	sourceSampleRate?: number;
}> = {}) {
	const defaultProject = {
		id: 'project-a',
		tracks: [{
			id: 'track-a', name: 'Track', type: 'audio' as const, clipIds: ['clip-a'],
			effects: [], gain: 0.5, pan: 0.2, mute: true, solo: true, envelope: [{ frame: 1, value: 0.5 }],
		}],
		master: { gain: 0.7, pan: 0.1, mute: true, effects: [{ id: 'master-fx', type: 'delay' }] },
		mixer: { groups: [{ id: 'group-a' }], sends: [{ id: 'send-a' }], routes: { 'track-a': {} } },
	};
	if (options.multipleTargets) defaultProject.tracks.push({ ...defaultProject.tracks[0]!, id: 'track-b', name: 'Second track' });
	let project = (options.project ?? defaultProject) as typeof defaultProject;
	const target: EffectTarget = {
		track: project.tracks[0], startFrame: 100, endFrame: 300, durationFrames: 200,
		channelCount: 1, hasAudio: true,
		...(options.targetClipIds ? { clipIds: options.targetClipIds } : {}),
		...(options.sourceSampleRate ? { sourceId: 'source-a', sourceTrackId: 'track-a', sourceClipId: 'clip-a',
			sourceSampleRate: options.sourceSampleRate, sourceFrameCount: 10_000,
			track: { ...project.tracks[0]!, id: 'source-editor:source-a' } } : {}),
	};
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const projectGeneration = new EditorProjectGeneration();
	projectGeneration.activate(project.id);
	const render = deferred<{ channels: readonly Float32Array[] }>();
	const dryRanges: Array<readonly [string, number, number]> = [];
	const selectionEffectCalls: Array<Readonly<{
		effectType: string;
		sampleRate: number;
		channels: readonly Float32Array[];
		params: Readonly<Record<string, unknown>>;
		context: Readonly<Record<string, unknown>>;
	}>> = [];
	const stagedProjects: Array<Readonly<Record<string, unknown>>> = [];
	const stagedSources: Array<ReadonlyMap<string, unknown>> = [];
	const bufferSampleRates: number[] = [];
	const persistence = deferred<void>();
	const persistenceStarted = deferred<void>();
	const persisted: unknown[] = [];
	const persistedBatches: Array<readonly SelectionEffectResult[]> = [];
	const persistedProjects: string[] = [];
	const statuses: Array<readonly [string, string | undefined]> = [];
	const errors: unknown[] = [];
	const snapshots: Readonly<Record<string, unknown>>[] = [];
	let processing = false;
	let publications = 0;
	let persistenceCommits = 0;
	const service = createEffectMacroService({
		lifetime,
		projectGeneration,
		copy: {
			audioTrackNotFound: 'Track missing',
			audacityApplied: 'Applied',
			audacityProcessing: 'Processing',
			audacitySelectionHint: 'Select audio',
			effectRackEmpty: 'Rack empty',
			macroApplied: 'Macro applied',
			macroEffectsRequired: 'Effects required',
			macrosPalette: 'Macro',
			macroProcessing: 'Macro processing',
			macroSelectionRequired: 'Selection required',
			untitledMacro: 'Untitled Macro',
			autoDuckControlTrack: 'Control track required',
			effectInvalidAudio: 'Invalid audio',
			noiseProfileMissing: 'Noise profile required',
		},
		memoryLimitBytes: options.memoryLimitBytes ?? 1_000_000,
		getProject: () => project,
		audacityEffectTarget: () => options.target === false ? null : target,
		audacityEffectTargets: () => options.target === false ? [] : options.multipleTargets
			? [target, { ...target, track: project.tracks[1]! }] : [target],
		editingBlocked: () => Boolean(options.blocked || processing),
		materializeRackEffect: (effect) => ({
			id: String(effect.id), type: String(effect.type), enabled: true,
			params: effect.params as Readonly<Record<string, unknown>> ?? {},
		}),
		projectSampleRate: () => 1_000,
		effectRackLatencyFrames: () => 0,
		isAudacityRackEffectType: () => Boolean(options.audacityRack),
		estimateAudacityEffectPeakBytes: () => options.memoryLimitBytes === 1 ? 2 : 0,
		audacityEffectMemoryError: () => new Error('Too large'),
		setProcessing: (value) => { processing = value; },
		setStatus: (message, status) => { statuses.push([message, status]); },
		publishDocumentSnapshot: () => { publications += 1; },
		preflightStorage: async () => undefined,
		cloneProject: (value) => structuredClone(value),
		renderSnapshot: async (snapshot) => {
			const captured = structuredClone(snapshot) as unknown as Readonly<Record<string, unknown>>;
			snapshots.push(captured);
			options.validateRenderSnapshot?.(snapshot as unknown as Readonly<Record<string, unknown>>);
			return render.promise;
		},
		renderStagedSnapshot: async (snapshot, _range, sourceBuffers) => {
			const captured = structuredClone(snapshot) as unknown as Readonly<Record<string, unknown>>;
			// A staged rack run renders audio the chain already holds, so the
			// fake echoes back what the caller handed the source map.
			stagedProjects.push(captured);
			stagedSources.push(sourceBuffers);
			const staged = [...sourceBuffers.values()][0] as
				Readonly<{ channels: readonly Float32Array[] }> | undefined;
			return { channels: (staged?.channels ?? []).map((channel) => channel.map((value) => value * 4)) };
		},
		projectFrameCount: () => 10_000,
		renderDryTrackRange: async (trackId, startFrame, endFrame) => {
			dryRanges.push([trackId, startFrame, endFrame]);
			return [new Float32Array([1, 2])];
		},
		runSelectionEffectWorker: async (request) => {
			selectionEffectCalls.push({
				effectType: request.effectType,
				sampleRate: request.sampleRate,
				channels: request.channels.map((channel) => channel.slice()),
				params: request.params,
				context: request.context,
			});
			return { channels: request.channels.map((channel) => channel.map((value) => value + 1)) };
		},
		createAudioBuffer: async (channels, sampleRate) => {
			bufferSampleRates.push(sampleRate);
			return { channels: channels.map((channel) => channel.slice()) };
		},
		audioBufferChannels: (buffer) => [...buffer.channels as readonly Float32Array[]],
		matchAudacitySelectionChannels: (channels) => [...channels],
		persistAudacityEffectResult: async (...args) => {
			persisted.push(args);
			if (options.deferPersistence) {
				persistenceStarted.resolve(undefined);
				await persistence.promise;
			}
			const persistenceOptions = args[3] as Readonly<{ assertCurrent?: () => void }>;
			persistenceOptions.assertCurrent?.();
			persistenceCommits += 1;
			persistedProjects.push(project.id);
		},
		persistAudacityEffectResults: async (results: readonly SelectionEffectResult[]) => { persistedBatches.push(results); },
		handleError: (error) => { errors.push(error); },
	});
	return {
		bufferSampleRates,
		dryRanges,
		errors,
		selectionEffectCalls,
		stagedProjects,
		stagedSources,
		get processing() { return processing; },
		get publications() { return publications; },
		persistence,
		get persistenceCommits() { return persistenceCommits; },
		persistenceStarted,
		persisted,
		persistedBatches,
		persistedProjects,
		render,
		service,
		snapshots,
		statuses,
		supersedeMacroTask() {
			return lifetime.startTask('selection-effect-macro');
		},
		switchProject() {
			project = { ...project, id: 'project-b' };
			projectGeneration.invalidate();
			projectGeneration.activate(project.id);
		},
	};
}
