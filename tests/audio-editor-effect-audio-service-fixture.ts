/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createEffectAudioService,
	type EffectAudioProject,
	type EffectAudioState,
} from '../src/common/editor/controller/effect-audio-service.ts';
import { matchAudacitySelectionChannels } from '../src/common/editor/audacity-selection.js';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/lifecycle.ts';
import type { EffectTarget } from '../src/common/editor/controller/effect-selection-service.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

export function deferred<Value>() {
	let resolve: (value: Value) => void = () => undefined;
	const promise = new Promise<Value>((accept) => { resolve = accept; });
	return { promise, resolve };
}

export function createHarness(options: Readonly<{
	deferRender?: boolean;
	deferPersistence?: boolean;
	deferWorker?: boolean;
	loadFailure?: boolean;
	masterChannels?: number;
	memoryLimitBytes?: number;
	project?: EffectAudioProject;
	spectralRenderFrameDelta?: number;
	spectralTargetCount?: 1 | 2;
	spectralWorkerFrameDelta?: number;
	validateRenderSnapshot?: (project: EffectAudioProject) => void;
}> = {}) {
	let project: EffectAudioProject = options.project ?? baselineHarnessProject(options.masterChannels);
	const state: EffectAudioState = {
		selectedTrackId: 'track-a',
		selectedClipId: 'clip-a',
		audacityEffectProcessing: false,
		audacityNoiseProfile: null,
	};
	const target: EffectTarget = {
		track: project.tracks[0]!, clipId: 'clip-a', clipIds: ['clip-a'],
		startFrame: 100, endFrame: 4_100, durationFrames: 4_000, channelCount: 1, hasAudio: true,
	};
	const spectralTargets: EffectTarget[] = [target];
	if (options.spectralTargetCount === 2) {
		spectralTargets.push({
			track: project.tracks[1]!, startFrame: 100, endFrame: 4_100,
			durationFrames: 4_000, channelCount: 1, hasAudio: true,
		});
	}
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const projectGeneration = new EditorProjectGeneration();
	projectGeneration.activate(project.id);
	const render = deferred<Readonly<{ channels: readonly Float32Array[] }>>();
	const persistence = deferred<void>();
	const persistenceStarted = deferred<void>();
	const worker = deferred<Readonly<{ profile: unknown }>>();
	const snapshots: EffectAudioProject[] = [];
	const commands: unknown[] = [];
	const persisted: unknown[] = [];
	const preflightBytes: number[] = [];
	const statuses: string[] = [];
	const noiseProfileWorkerChannels: Float32Array[][] = [];
	const noiseProfileWorkerParams: Readonly<Record<string, unknown>>[] = [];
	let publications = 0;
	let persistenceCommits = 0;
	let prefixDisposals = 0;
	let spectralWorkerCalls = 0;
	const service = createEffectAudioService({
		lifetime,
		captureProject: () => projectGeneration.capture(project.id),
		assertProject: (token) => projectGeneration.assertCurrent(token),
		state,
		copy: {
			audacityApplied: 'Applied', audacityProcessing: 'Processing', audacityProfileProcessing: 'Profiling',
			audacitySelectionHint: 'Select audio', audioTrackNotFound: 'Track missing', effectProcessingFailed: 'Failed',
			noiseProfileMinimumSamples: 'Too short', noiseProfileReady: 'Profile ready', rackEffectNotFound: 'Effect missing',
			spectralAmplify: 'Spectral amplify', spectralApplied: 'Spectral applied', spectralDelete: 'Spectral delete',
			spectralGainInvalid: 'Bad spectral gain', spectralProcessing: 'Spectral processing',
			spectralSelectionRequired: 'Select spectrum', v2Required: 'Version 2 required',
		},
		memoryLimitBytes: options.memoryLimitBytes ?? 1_000_000_000,
		getProject: () => project as never,
		activeSelection: () => project.selection ?? null,
		audacityEffectTarget: () => target,
		audacityEffectTargets: () => spectralTargets,
		audacityEffectSelectionDetails: (selection, targets) => ({
			trackIds: selection?.trackIds ?? targets.map((entry) => entry.track.id),
			clipIds: targets.flatMap((entry) => entry.clipId ? [entry.clipId] : []),
			frequencyRange: selection?.frequencyRange ?? null,
		}),
		editingBlocked: () => state.audacityEffectProcessing,
		projectSampleRate: () => project.sampleRate,
		currentAudacityEffectParams: () => ({}),
		estimateAudacityEffectPeakBytes: () => 1,
		audacityEffectMemoryError: () => new Error('Too large'),
		preflightStorage: async (bytes) => { preflightBytes.push(bytes); },
		createId: (prefix) => `${prefix}-id`,
		cloneProject: (value) => structuredClone(value),
		audacitySelectionChannelCount: () => 1,
		renderSnapshot: async (snapshot, renderOptions) => {
			snapshots.push(structuredClone(snapshot));
			options.validateRenderSnapshot?.(snapshot);
			const outputFrames = Number(renderOptions.outputFrames) + (options.spectralRenderFrameDelta ?? 0);
			return options.deferRender ? render.promise : { channels: [new Float32Array(outputFrames)] };
		},
		prepareCommittedTimePitchCaches: async () => undefined,
		createRenderEngine: () => ({
			loadProject: (snapshot) => {
				snapshots.push(structuredClone(snapshot));
				if (options.loadFailure) throw new Error('load failed');
			},
			renderTrack: async () => ({ channels: [new Float32Array([0.3])] }),
			renderMix: async () => ({
				channels: Array.from(
					{ length: Number(project.masterChannels) || 2 },
					(_, index) => new Float32Array([index + 1]),
				),
			}),
			dispose: async () => { prefixDisposals += 1; },
		}),
		sourceBuffers: new Map(),
		audioBufferChannels: (buffer) => [...buffer.channels ?? []],
		matchAudacitySelectionChannels,
		runSelectionEffectWorker: async ({ channels, params }) => {
			noiseProfileWorkerChannels.push(channels.map((channel) => channel.slice()));
			noiseProfileWorkerParams.push(params);
			return options.deferWorker ? worker.promise : { profile: { bins: [1, 2] } };
		},
		runSpectralEditWorker: async (channels) => {
			spectralWorkerCalls += 1;
			return channels.map((channel) => new Float32Array(
				channel.length + (options.spectralWorkerFrameDelta ?? 0),
			));
		},
		serializeNoiseProfile: (profile) => ({ serialized: profile }),
		commit: (command) => { commands.push(command); },
		persistAudacityEffectResults: async (...args) => {
			persisted.push(args);
			if (options.deferPersistence) {
				persistenceStarted.resolve(undefined);
				await persistence.promise;
			}
			const persistenceOptions = args[2] as Readonly<{ assertCurrent?: () => void }>;
			persistenceOptions.assertCurrent?.();
			persistenceCommits += 1;
		},
		setStatus: (message) => { statuses.push(message); },
		publishDocumentSnapshot: () => { publications += 1; },
	});
	return {
		commands,
		get prefixDisposals() { return prefixDisposals; },
		noiseProfileWorkerChannels,
		noiseProfileWorkerParams,
		get publications() { return publications; },
		persistence,
		get persistenceCommits() { return persistenceCommits; },
		persistenceStarted,
		persisted,
		preflightBytes,
		render,
		service,
		setSelection(selection: EffectAudioProject['selection']) { project = { ...project, selection }; },
		snapshots,
		state,
		statuses,
		target,
		get spectralWorkerCalls() { return spectralWorkerCalls; },
		switchProject() {
			project = { ...project, id: 'project-b' };
			projectGeneration.invalidate();
			projectGeneration.activate(project.id);
		},
		worker,
	};
}

function baselineHarnessProject(masterChannels = 2): EffectAudioProject {
	const source = createAudioSource({
		id: 'source-a', storageKey: 'pcm:a', name: 'Source', mimeType: 'audio/wav',
		frameCount: 4_000, channelCount: 1, sampleRate: 48_000,
		originalSampleRate: 48_000, sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const clip = createAudioClip({
		id: 'clip-a', sourceId: source.id, title: 'Clip', timelineStartFrame: 100,
		sourceStartFrame: 0, sourceDurationFrames: 4_000, durationFrames: 4_000,
	});
	const project = createSoundscaperProject({
		id: 'project-a', title: 'Effect fixture', now: '2026-08-28T12:00:00.000Z',
		masterChannels,
		sources: [source], clips: [clip],
		tracks: [
			createAudioTrack({
				id: 'track-a', name: 'A', clipIds: [clip.id], gain: 0.5, pan: 0.2,
				mute: true, solo: true, spectrogram: { windowSize: 2_048 },
				effects: [
					createEffect('delay', { id: 'before' }),
					createEffect('audacity-noise-reduction', { id: 'noise', enabled: false }),
				],
			}),
			createAudioTrack({ id: 'track-b', name: 'B', clipIds: [], effects: [] }),
		],
		selection: {
			startFrame: 100, endFrame: 4_100, trackIds: ['track-a'], clipIds: ['clip-a'],
			frequencyRange: { minimumFrequency: 80, maximumFrequency: 4_000 },
		},
	});
	return {
		...project,
		master: {
			...(project.master as Readonly<Record<string, unknown>>),
			gain: 0.8,
			effects: [createEffect('delay', { id: 'master' })],
		},
	} as unknown as EffectAudioProject;
}

export function folderedLegacyProject() {
	return createAudioEditorProjectV17({
		id: 'project-folders', title: 'Foldered legacy', now: '2026-08-19T12:00:00.000Z',
		sources: [createAudioSource({
			id: 'source-a', storageKey: 'pcm:a', frameCount: 8, channelCount: 1,
			sampleRate: 48_000, originalSampleRate: 48_000, sampleFormat: 'float32', chunkFrames: 65_536,
		})],
		clips: [createAudioClip({
			id: 'voice-clip', sourceId: 'source-a', title: 'Voice', timelineStartFrame: 0,
			durationFrames: 8, sourceStartFrame: 0, sourceDurationFrames: 8,
		})],
		tracks: [
			createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['voice-clip'], effects: [] }),
			createAudioTrack({ id: 'music', name: 'Music', clipIds: [], effects: [] }),
		],
		trackFolders: [{ id: 'stems', name: 'Stems', mute: true }],
		sequences: [{
			id: 'main',
			trackNodes: [
				{ kind: 'folder', id: 'stems', parentFolderId: null },
				{ kind: 'track', id: 'voice', parentFolderId: 'stems' },
				{ kind: 'track', id: 'music', parentFolderId: null },
			],
		}],
		primarySequenceId: 'main',
	});
}

export function v21RenderProject() {
	return createSoundscaperProject({
		id: 'project-a', title: 'Selection render', now: '2026-08-14T12:00:00.000Z',
		tracks: [
			createAudioTrack({
				id: 'track-a', name: 'A', clipIds: [],
				effects: [
					createEffect('delay', { id: 'before' }),
					createEffect('audacity-noise-reduction', { id: 'noise', enabled: false }),
				],
			}),
			createAudioTrack({ id: 'track-b', name: 'B', clipIds: [] }),
		],
		sequences: [{ id: 'main', trackIds: ['track-a', 'track-b'] }],
		primarySequenceId: 'main',
		automationLanes: [{
			id: 'track-a-gain',
			address: { kind: 'strip', strip: { kind: 'track', id: 'track-a' }, parameterId: 'gain' },
			timebase: 'absolute-samples',
			points: [{ id: 'start', position: 0, value: 0.25 }],
			segments: [],
		}],
	});
}
