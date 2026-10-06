/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioGeneratorProject, AudioGeneratorState, AudioGeneratorServiceDependencies } from '../../src/common/editor/controller/edit/generator-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../../src/common/editor/controller/shared/lifecycle.ts';
import type { AudioEditorCommand } from '../../src/common/editor/commands/protocol.ts';
import type { AudioBufferLike } from '../../src/common/editor/controller/source/source-audio.ts';

export function project(id = 'project-a', selection: AudioGeneratorProject['selection'] = {
	startFrame: 10,
	endFrame: 20,
	trackIds: ['track-a'],
}): AudioGeneratorProject {
	return {
		id,
		schemaVersion: 5,
		title: id,
		sampleRate: 1_000,
		masterChannels: 2,
		selection,
		sources: [{ id: 'existing-source', channelCount: 1 }],
		clips: [{
			id: 'existing-clip', sourceId: 'existing-source', timelineStartFrame: 0,
			sourceStartFrame: 0, sourceDurationFrames: 100, durationFrames: 100,
		}],
		tracks: [{ id: 'track-a', type: 'audio', clipIds: ['existing-clip'] }],
	};
}

export function createFixture(overrides: Partial<AudioGeneratorServiceDependencies> = {}) {
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const projectGeneration = new EditorProjectGeneration();
	let activeProject = project();
	projectGeneration.activate(activeProject.id);
	const state: Omit<AudioGeneratorState, 'audacityEffectProcessing'> & { audacityEffectProcessing: boolean } = {
		selectedTrackId: 'track-a', audacityEffectProcessing: false, lastGeneratorRequest: null,
	};
	const commits: Array<Readonly<{
		command: AudioEditorCommand;
		selection?: Readonly<{ selectTrackId?: string | null; selectClipId?: string | null }>;
	}>> = [];
	const statuses: Array<Readonly<{ message: string; state?: string }>> = [];
	const preflights: number[] = [];
	const deletedSources: string[] = [];
	const sourceBuffers = new Map<string, AudioBufferLike>();
	const sourcePeaks = new Map<string, unknown>();
	let publishes = 0;
	let nextId = 0;
	const writer = {
		write: async () => undefined,
		commit: async () => undefined,
		abort: async () => undefined,
	};
	const dependencies: AudioGeneratorServiceDependencies = {
		lifetime,
		projectGeneration,
		state,
		copy: {
			audioBufferUnsupported: 'Audio buffers unsupported.',
			audacityProjectTooLong: 'Too long.',
			chirpGenerator: 'Chirp',
			decodedAudioEmpty: 'Empty audio.',
			decodedChannelLengthsMismatch: 'Channel mismatch.',
			done: 'Done.',
			dtmfGenerator: 'DTMF',
			generatingAudio: 'Generating audio.',
			morseGenerator: 'Morse code',
			noiseGenerator: 'Noise',
			silenceAudio: 'Silence',
			silenceGenerator: 'Silence',
			timeSelectionRequired: 'Select time.',
			toneGenerator: 'Tone',
		},
		getProject: () => activeProject,
		editingBlocked: () => false,
		getPositionFrames: () => 40,
		snapFrame: (value) => Math.round(Number(value)),
		trackChannelCount: () => 1,
		effectTargets: () => [],
		persistEffectResults: async () => undefined,
		preflightStorage: async (bytes) => { preflights.push(bytes); },
		getAudioContext: async () => ({}),
		createBuffer: async (channels, sampleRate) => ({
			length: channels[0]?.length ?? 0,
			numberOfChannels: channels.length,
			sampleRate,
			getChannelData: (channel) => channels[channel] ?? new Float32Array(),
		}),
		store: {
			beginSourceWrite: async () => writer,
			saveAnalysis: async () => undefined,
			deleteSource: async (sourceId) => { deletedSources.push(sourceId); },
		},
		writeBuffer: async () => undefined,
		cacheSourceBuffer: (sourceId, buffer) => { sourceBuffers.set(sourceId, buffer); },
		generatePeaks: async (channels) => ({ frameCount: channels[0]?.length ?? 0 }),
		peakCacheKey: (sourceId) => `peaks:${sourceId}`,
		sourceBuffers,
		sourcePeaks,
		sourceChunkFrames: 65_536,
		createId: (prefix) => `${prefix}-${++nextId}`,
		commit: (command, selectionValue) => { commits.push({ command, selection: selectionValue }); },
		setStatus: (message, nextState) => { statuses.push({ message, state: nextState }); },
		publish: () => { publishes += 1; },
		setEffectProcessing: (processing) => { state.audacityEffectProcessing = processing; },
		...overrides,
	};
	return {
		commits,
		deletedSources,
		dependencies,
		lifetime,
		preflights,
		projectGeneration,
		publishes: () => publishes,
		replaceProject(id: string) {
			activeProject = project(id);
			projectGeneration.activate(id);
		},
		sourceBuffers,
		sourcePeaks,
		state,
		statuses,
		writer,
	};
}
