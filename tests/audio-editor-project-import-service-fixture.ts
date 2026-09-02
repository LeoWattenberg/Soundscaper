/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	ProjectImportRuntime,
} from '../src/common/editor/controller/project-import-service.ts';

export interface TestFile {
	readonly name: string;
	readonly type?: string;
	readonly size: number;
	arrayBuffer(): Promise<ArrayBuffer>;
	slice?: (start?: number, end?: number) => TestFile;
}

export function file(name: string, type = 'audio/wav', size = 16): TestFile {
	const value: TestFile = {
		name,
		type,
		size,
		arrayBuffer: async () => new ArrayBuffer(8),
	};
	return { ...value, slice: () => value };
}

export function deferred<Value>() {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((accept) => { resolve = accept; });
	return { promise, resolve };
}

export function bextMetadata(timeReference = '0') {
	return Object.freeze({
		description: 'Location recording',
		originator: 'Soundscaper Tests',
		originatorReference: 'TEST-REFERENCE',
		originationDate: '2026-07-28',
		originationTime: '12:34:56',
		timeReference,
		version: 1,
		umid: '',
		loudnessValue: null,
		loudnessRange: null,
		maxTruePeakLevel: null,
		maxMomentaryLoudness: null,
		maxShortTermLoudness: null,
		codingHistory: 'A=PCM,F=44100,W=24,M=stereo,T=Recorder',
	});
}

function commandChildren(command: unknown) {
	const candidate = command as { type?: string; commands?: unknown[] };
	return candidate.type === 'batch' ? candidate.commands || [] : [candidate];
}

export function commandOfType(command: unknown, type: string) {
	return commandChildren(command).find((child) => (child as { type?: string }).type === type) as Record<string, unknown> | undefined;
}

export function createFixture() {
	const calls: string[] = [];
	const commands: Array<{ command: unknown; selection: unknown }> = [];
	const statuses: Array<[string, unknown]> = [];
	const placements: unknown[] = [];
	const options = {
		blocked: false,
		commitFails: false,
		decodeFails: false,
		ffmpegFails: false,
		writerFails: false,
		peakFails: false,
		decodeGate: null as Promise<void> | null,
		legacyDecodeGate: null as Promise<void> | null,
		peakGate: null as Promise<void> | null,
		activateFails: false,
		activationGate: null as Promise<void> | null,
		inspectThrows: false,
		incrementalDescriptor: null as null | {
			channelCount: number;
			frameCount: number;
			sampleRate: number;
			pcmBytes: number;
			bext?: ReturnType<typeof bextMetadata> | null;
			metadataWarnings?: ReadonlyArray<{ code: string; message: string }>;
			markers?: ReadonlyArray<{
				id: number; sampleOffset: number; sampleLength: number; label: string; note: string;
			}>;
		},
		structuredDecoded: null as null | {
			project?: Record<string, unknown>;
			sources?: Array<{ sourceId: string; channels: Float32Array[] }>;
			warnings?: string[];
		},
		videoFailureName: '',
	};
	const audio = {
		length: 4,
		numberOfChannels: 1,
		sampleRate: 48_000,
		channels: [Float32Array.of(0.1, 0.2, 0.3, 0.4)],
	};
	let currentProject: Record<string, unknown> = {
		id: 'current',
		metadata: { bext: null },
		tracks: [{ id: 'target', type: 'audio' }, { id: 'after', type: 'audio' }],
		sources: [],
	};
	let projectGeneration = 0;
	let nextId = 0;
	const sourceBuffers = new Map<string, unknown>();
	const sourceChunkProviders = new Map<string, unknown>();
	const sourcePeaks = new Map<string, unknown>();
	const deletedSources: string[] = [];
	const writer = () => ({
		async write(channels: Float32Array[]) {
			calls.push(`write:${channels[0]?.length || 0}`);
			if (options.writerFails) throw new Error('write failed');
		},
		async commit() {
			calls.push('writer-commit');
			return { chunkCount: 1 };
		},
		async abort() { calls.push('writer-abort'); },
	});
	const structuredProject = () => ({
		id: 'imported',
		title: 'Imported',
		sources: [{
			id: 'structured-source',
			name: 'Structured audio',
			mimeType: 'audio/wav',
			sampleRate: 48_000,
			channelCount: 1,
			frameCount: 5,
		}],
		tracks: [],
		clips: [],
	});
	const decodedStructure = () => options.structuredDecoded || {
		project: structuredProject(),
		sources: [{ sourceId: 'structured-source', channels: [Float32Array.of(1, 2, 3, 4, 5)] }],
		warnings: ['converted'],
	};
	const runtime: ProjectImportRuntime = {
		SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES: 32,
		SOURCE_CHUNK_FRAMES: 65_536,
		activateStoredSource: async (source: { id: string }) => {
			calls.push(`activate:${source.id}`);
			if (options.activationGate) await options.activationGate;
			if (options.activateFails) throw new Error('activate failed');
			sourceChunkProviders.set(source.id, {});
		},
		audioBufferChannels: (value: typeof audio) => value.channels,
		bufferFromChannels: async () => audio,
		cacheSourceBuffer: (sourceId: string, value: unknown) => { sourceBuffers.set(sourceId, value); },
		canonicalizeBuffer: async () => audio,
		commit: (command: unknown, selection: unknown) => {
			if (options.commitFails) throw new Error('commit failed');
			commands.push({ command, selection });
			const batch = command as { type?: string; commands?: Array<{ type?: string; changes?: Record<string, unknown> }> };
			const children: Array<{ type?: string; changes?: Record<string, unknown> }> = batch.type === 'batch'
				? batch.commands || []
				: [batch];
			const metadataUpdate = children.find((child) => child.type === 'metadata/update');
			if (metadataUpdate?.changes) {
				currentProject = {
					...currentProject,
					metadata: {
						...(currentProject.metadata as Record<string, unknown>),
						...metadataUpdate.changes,
					},
				};
			}
		},
		convertLegacyAupToProject: () => decodedStructure(),
		copy: {
			importing: 'Importing',
			done: 'Done',
			importSummary: '{successes} succeeded, {failures} failed',
			timelineFramesFinite: 'Frames must be finite.',
			audioTrackNotFound: 'Audio track not found.',
			track: 'Track',
			aupImporting: 'Importing AUP',
			aupImported: 'AUP imported.',
			structuredProjectRequired: 'Structured project required.',
			importedSourceDescriptorMissing: 'Missing {source}.',
			importedSourcePcmInvalid: 'Invalid {source}.',
		},
		createAddClipCommand: (trackId: string, clip: unknown) => ({ type: 'clip/add', trackId, clip }),
		createAddSourceCommand: (source: unknown) => ({ type: 'source/add', source }),
		createAddTrackCommand: (track: unknown) => ({ type: 'track/add', track }),
		createStableId: (prefix: string) => `${prefix}-${++nextId}`,
		decodeLegacyAupProject: async (
			_input: unknown,
			_dataFiles: unknown,
			decodeOptions: { onProgress: (value: unknown) => void },
		) => {
			decodeOptions.onProgress({ progress: -0.5 });
			calls.push('legacy-decode-started');
			if (options.legacyDecodeGate) await options.legacyDecodeGate;
			return decodedStructure();
		},
		editingBlocked: () => options.blocked,
		engine: {
			getAudioContext: async () => ({}),
			decodeAudioData: async () => {
				calls.push('decode-started');
				if (options.decodeGate) await options.decodeGate;
				if (options.decodeFails) throw new Error('native decode failed');
				return audio;
			},
		},
		ffmpeg: {
			decode: async () => {
				if (options.ffmpegFails) throw new Error('ffmpeg failed');
				return { channels: audio.channels, sampleRate: 44_100 };
			},
		},
		findTrack: (project: { tracks: Array<{ id: string }> }, trackId: string) => (
			project.tracks.find((track) => track.id === trackId) || null
		),
		formatLegacyAupWarning: (warning: string) => warning === 'ignored' ? '' : `Warning: ${warning}.`,
		generateWaveformPeaks: async () => {
			calls.push('peaks-started');
			if (options.peakGate) await options.peakGate;
			if (options.peakFails) throw new Error('peaks failed');
			return { levels: [] };
		},
		handleError: (error: unknown) => { calls.push(`error:${(error as Error).message}`); },
		importVideoFile: async (input: TestFile, importOptions: unknown) => {
			placements.push(importOptions);
			if (input.name === options.videoFailureName) throw new Error('video failed');
			return { notice: `${input.name} imported` };
		},
		inspectEncodedAudioSampleRate: () => 44_100,
		inspectWavBlobPcm: async () => {
			if (options.inspectThrows) throw new Error('invalid wav');
			return options.incrementalDescriptor;
		},
		isAudioEditorVideoFile: (input: TestFile) => input.type?.startsWith('video/') || false,
		isLegacyAupFile: (input: TestFile) => /\.aup$/iu.test(input.name),
		isLegacyBlockFile: (input: TestFile) => /\.au$/iu.test(input.name),
		isWavFile: (input: TestFile) => /\.wav$/iu.test(input.name),
		peakCacheKey: (sourceId: string) => `peaks:${sourceId}`,
		preflightStorage: async (bytes: number, purpose: string) => { calls.push(`preflight:${purpose}:${bytes}`); },
		getProject: () => currentProject,
		captureProject: () => projectGeneration,
		assertProject: (generation: number) => {
			if (generation !== projectGeneration) throw new Error('stale project generation');
		},
		projectSampleRate: () => 48_000,
		publishDocumentSnapshot: () => { calls.push('publish'); },
		retireSourceChunkProvider: (sourceId: string) => { sourceChunkProviders.delete(sourceId); },
		setStatus: (message: string, tone?: unknown) => { statuses.push([message, tone]); },
		sourceBuffers,
		sourcePcmBytes: (descriptor: { pcmBytes: number } | null) => descriptor?.pcmBytes || 0,
		sourcePeaks,
		state: { importing: false },
		store: {
			beginSourceWrite: async () => writer(),
			saveAnalysis: async () => { calls.push('save-analysis'); },
			deleteSource: async (sourceId: string) => { deletedSources.push(sourceId); },
			saveProject: async () => { calls.push('save-project'); },
			deleteProject: async (projectId: string) => { calls.push(`delete-project:${projectId}`); },
		},
		streamWavBlobPcm: async (
			_input: unknown,
			{ descriptor, onChunk }: { descriptor: { channelCount: number; frameCount: number };
				onChunk: (channels: Float32Array[]) => Promise<void> },
		) => onChunk(Array.from({ length: descriptor.channelCount }, () => new Float32Array(descriptor.frameCount))),
		stripExtension: (name: string) => name.replace(/\.[^.]+$/u, ''),
		switchProject: async (project: Record<string, unknown>) => {
			calls.push(`switch:${String(project.id)}`);
			currentProject = project;
			projectGeneration += 1;
		},
		warnEnvelope: () => { calls.push('warn-envelope'); },
		writeBuffer: async (target: ReturnType<typeof writer>) => { await target.write(audio.channels); },
	};
	return {
		calls,
		commands,
		deletedSources,
		options,
		placements,
		runtime,
		setProject: (value: Record<string, unknown>) => {
			currentProject = value;
			projectGeneration += 1;
		},
		sourceBuffers,
		sourceChunkProviders,
		sourcePeaks,
		statuses,
	};
}
