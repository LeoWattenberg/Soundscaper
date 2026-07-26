/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createProjectImportService,
	type ProjectImportRuntime,
} from '../src/common/editor/controller/project-import-service.ts';

interface TestFile {
	readonly name: string;
	readonly type?: string;
	readonly size: number;
	arrayBuffer(): Promise<ArrayBuffer>;
	slice?: (start?: number, end?: number) => TestFile;
}

function file(name: string, type = 'audio/wav', size = 16): TestFile {
	const value: TestFile = {
		name,
		type,
		size,
		arrayBuffer: async () => new ArrayBuffer(8),
	};
	return { ...value, slice: () => value };
}

function createFixture() {
	const calls: string[] = [];
	const commands: Array<{ command: unknown; selection: unknown }> = [];
	const statuses: Array<[string, unknown]> = [];
	const placements: unknown[] = [];
	const options = {
		blocked: false,
		decodeFails: false,
		ffmpegFails: false,
		writerFails: false,
		peakFails: false,
		activateFails: false,
		inspectThrows: false,
		incrementalDescriptor: null as null | {
			channelCount: number;
			frameCount: number;
			sampleRate: number;
			pcmBytes: number;
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
		tracks: [{ id: 'target', type: 'audio' }, { id: 'after', type: 'audio' }],
		sources: [],
	};
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
		SOURCE_CHUNK_FRAMES: 2,
		activateStoredSource: async (source: { id: string }) => {
			calls.push(`activate:${source.id}`);
			if (options.activateFails) throw new Error('activate failed');
			sourceChunkProviders.set(source.id, {});
		},
		audioBufferChannels: (value: typeof audio) => value.channels,
		bufferFromChannels: async () => audio,
		cacheSourceBuffer: (sourceId: string, value: unknown) => { sourceBuffers.set(sourceId, value); },
		canonicalizeBuffer: async () => audio,
		commit: (command: unknown, selection: unknown) => { commands.push({ command, selection }); },
		convertStructuredAup3ToProjectV2: () => decodedStructure(),
		copy: {
			importing: 'Importing',
			done: 'Done',
			importSummary: '{successes} succeeded, {failures} failed',
			timelineFramesFinite: 'Frames must be finite.',
			audioTrackNotFound: 'Audio track not found.',
			track: 'Track',
			aupImporting: 'Importing AUP',
			aup3Importing: 'Importing AUP3',
			aupImported: 'AUP imported.',
			aup3Imported: 'AUP3 imported.',
			structuredProjectRequired: 'Structured project required.',
			importedSourceDescriptorMissing: 'Missing {source}.',
			importedSourcePcmInvalid: 'Invalid {source}.',
		},
		createAddClipCommand: (trackId: string, clip: unknown) => ({ type: 'clip/add', trackId, clip }),
		createAddSourceCommand: (source: unknown) => ({ type: 'source/add', source }),
		createAddTrackCommand: (track: unknown) => ({ type: 'track/add', track }),
		createStableId: (prefix: string) => `${prefix}-${++nextId}`,
		decodeAup3File: async (_input: unknown, decodeOptions: { onProgress: (value: unknown) => void }) => {
			decodeOptions.onProgress(0.25);
			decodeOptions.onProgress({ value: 70 });
			decodeOptions.onProgress('invalid');
			return { kind: 'aup3' };
		},
		decodeLegacyAupProject: async (
			_input: unknown,
			_dataFiles: unknown,
			decodeOptions: { onProgress: (value: unknown) => void },
		) => {
			decodeOptions.onProgress({ progress: -0.5 });
			return { kind: 'aup' };
		},
		editingBlocked: () => options.blocked,
		engine: {
			getAudioContext: async () => ({}),
			decodeAudioData: async () => {
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
		formatAup3Warning: (warning: string) => warning === 'ignored' ? '' : `Warning: ${warning}.`,
		generateWaveformPeaks: async () => {
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
		isAup3File: (input: TestFile) => /\.aup3?$/iu.test(input.name),
		isLegacyAupFile: (input: TestFile) => /\.aup$/iu.test(input.name),
		isLegacyBlockFile: (input: TestFile) => /\.au$/iu.test(input.name),
		isWavFile: (input: TestFile) => /\.wav$/iu.test(input.name),
		migrateAudioEditorProject: (project: unknown) => ({ project }),
		peakCacheKey: (sourceId: string) => `peaks:${sourceId}`,
		preflightStorage: async (bytes: number, purpose: string) => { calls.push(`preflight:${purpose}:${bytes}`); },
		getProject: () => currentProject,
		projectSampleRate: () => 48_000,
		publishDocumentSnapshot: () => { calls.push('publish'); },
		setStatus: (message: string, tone?: unknown) => { statuses.push([message, tone]); },
		sourceBuffers,
		sourceChunkProviders,
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
			streamOptions: { onChunk: (channels: Float32Array[]) => Promise<void> },
		) => { await streamOptions.onChunk(audio.channels); },
		stripExtension: (name: string) => name.replace(/\.[^.]+$/u, ''),
		switchProject: async (project: Record<string, unknown>) => {
			calls.push(`switch:${String(project.id)}`);
			currentProject = project;
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
		setProject: (value: Record<string, unknown>) => { currentProject = value; },
		sourceBuffers,
		sourceChunkProviders,
		sourcePeaks,
		statuses,
	};
}

test('audio imports support existing tracks, project-bin placement, and decoder fallback', async () => {
	const fixture = createFixture();
	const service = createProjectImportService(fixture.runtime);
	const timeline = await service.importFile(file('voice.wav'), {
		destination: 'timeline', trackId: 'target', timelineStartFrame: 7,
	});
	assert.equal(timeline.destination, 'timeline');
	assert.equal(timeline.trackId, 'target');
	assert.equal(fixture.commands.length, 1);
	assert.equal(fixture.sourceBuffers.size, 1);

	fixture.options.decodeFails = true;
	const bin = await service.importFile(file('fallback.mp3', 'audio/mpeg'), {
		destination: 'project-bin', timelineStartFrame: 0,
	});
	assert.equal(bin.destination, 'project-bin');
	assert.equal(bin.trackId, null);
	assert.equal(fixture.calls.filter((entry) => entry === 'warn-envelope').length, 2);
});

test('audio imports create indexed tracks and clean persisted data after analysis failure', async () => {
	const fixture = createFixture();
	const service = createProjectImportService(fixture.runtime);
	const created = await service.importFile(file('new-track.mp3', 'audio/mpeg'), {
		destination: 'timeline', trackId: null, trackIndex: 1, timelineStartFrame: 3,
	});
	assert.match(created.trackId, /^track-/u);

	fixture.options.peakFails = true;
	await assert.rejects(() => service.importFile(file('broken.mp3', 'audio/mpeg')), /peaks failed/u);
	assert.equal(fixture.deletedSources.length, 1);
	assert.equal(fixture.sourcePeaks.size, 1);

	fixture.options.peakFails = false;
	fixture.options.writerFails = true;
	await assert.rejects(() => service.importFile(file('writer.mp3', 'audio/mpeg')), /write failed/u);
	assert.equal(fixture.calls.includes('writer-abort'), true);
});

test('incremental WAV imports stream PCM and roll back activation failures', async () => {
	const fixture = createFixture();
	fixture.options.incrementalDescriptor = {
		channelCount: 2, frameCount: 64, sampleRate: 48_000, pcmBytes: 512,
	};
	const service = createProjectImportService(fixture.runtime);
	const result = await service.importFile(file('large.wav'));
	assert.equal(result.destination, 'timeline');
	assert.equal(fixture.sourceChunkProviders.size, 1);

	fixture.options.activateFails = true;
	await assert.rejects(() => service.importFile(file('activation.wav')), /activate failed/u);
	assert.equal(fixture.deletedSources.length, 1);
	assert.equal(fixture.sourceBuffers.size, 0);

	fixture.options.activateFails = false;
	fixture.options.writerFails = true;
	await assert.rejects(() => service.importFile(file('stream-write.wav')), /write failed/u);
	assert.equal(fixture.calls.includes('writer-abort'), true);
});

test('small, multichannel, invalid, and unsliceable WAVs use the regular decoder path', async () => {
	const fixture = createFixture();
	const service = createProjectImportService(fixture.runtime);
	fixture.options.incrementalDescriptor = {
		channelCount: 1, frameCount: 2, sampleRate: 48_000, pcmBytes: 8,
	};
	await service.importFile(file('small.wav'));
	fixture.options.incrementalDescriptor = {
		channelCount: 6, frameCount: 64, sampleRate: 48_000, pcmBytes: 512,
	};
	await service.importFile(file('surround.wav'));
	fixture.options.inspectThrows = true;
	await service.importFile(file('invalid-header.wav'));
	const unsliceable = { ...file('unsliceable.wav'), slice: undefined };
	await service.importFile(unsliceable);
	assert.equal(fixture.commands.length, 4);
});

test('structured Audacity imports persist PCM chunks, progress, and warnings', async () => {
	const legacy = createFixture();
	const legacyResult = await createProjectImportService(legacy.runtime).importFile(file('session.aup'));
	assert.equal(legacyResult.notice, 'AUP imported. Warning: converted.');
	assert.equal(legacy.calls.filter((entry) => entry.startsWith('write:')).length, 3);
	assert.equal(legacy.calls.includes('save-project'), true);
	assert.equal(legacy.statuses.some(([message]) => message === 'Importing AUP3 0%'), true);

	const modern = createFixture();
	modern.options.structuredDecoded = {
		project: {
			id: 'modern-import',
			sources: [{
				id: 'structured-source', name: 'Source', mimeType: 'audio/wav',
				sampleRate: 48_000, channelCount: 1, frameCount: 1,
			}],
		},
		sources: [{ sourceId: 'structured-source', channels: [Float32Array.of(1)] }],
		warnings: ['ignored'],
	};
	const modernResult = await createProjectImportService(modern.runtime).importFile(file('session.aup3'));
	assert.equal(modernResult.notice, 'AUP3 imported.');
	assert.equal(modern.statuses.some(([message]) => message === 'Importing AUP3 25%'), true);
	assert.equal(modern.statuses.some(([message]) => message === 'Importing AUP3 70%'), true);
});

test('structured imports reject malformed descriptors and clean completed source writes', async () => {
	const malformed = createFixture();
	malformed.options.structuredDecoded = { warnings: [], sources: [] };
	await assert.rejects(
		() => createProjectImportService(malformed.runtime).importFile(file('malformed.aup3')),
		/Structured project required/iu,
	);

	const missing = createFixture();
	missing.options.structuredDecoded = {
		project: { id: 'bad', sources: [] },
		sources: [{ sourceId: 'absent', channels: [] }],
		warnings: [],
	};
	await assert.rejects(
		() => createProjectImportService(missing.runtime).importFile(file('missing.aup3')),
		/Missing absent/iu,
	);

	const invalidPcm = createFixture();
	invalidPcm.options.structuredDecoded = {
		project: {
			id: 'bad-pcm',
			sources: [{
				id: 'structured-source', name: 'Bad source', mimeType: 'audio/wav',
				sampleRate: 48_000, channelCount: 1, frameCount: 2,
			}],
		},
		sources: [{ sourceId: 'structured-source', channels: [Float32Array.of(1)] }],
		warnings: [],
	};
	await assert.rejects(
		() => createProjectImportService(invalidPcm.runtime).importFile(file('bad-pcm.aup3')),
		/Invalid Bad source/iu,
	);
});

test('multi-file imports skip legacy blocks, summarize failures, and offset target tracks', async () => {
	const legacy = createFixture();
	legacy.options.videoFailureName = 'bad.mp4';
	const legacyService = createProjectImportService(legacy.runtime);
	await legacyService.importFiles([
		file('project.aup'),
		file('e000.au'),
		file('good.mp4', 'video/mp4'),
		file('bad.mp4', 'video/mp4'),
	]);
	assert.equal(legacy.statuses.at(-1)?.[0], '2 succeeded, 1 failed');
	assert.equal(legacy.calls.includes('error:video failed'), true);
	assert.equal((legacy.runtime.state as { importing: boolean }).importing, false);

	const placement = createFixture();
	await createProjectImportService(placement.runtime).importFiles([
		file('one.mp4', 'video/mp4'),
		file('two.mp4', 'video/mp4'),
	], { destination: 'timeline', trackId: 'target', timelineStartFrame: 9 });
	assert.deepEqual(placement.placements, [
		{ destination: 'timeline', trackId: 'target', timelineStartFrame: 9 },
		{ destination: 'timeline', trackId: null, timelineStartFrame: 9, trackIndex: 1 },
	]);
	assert.equal(placement.statuses.at(-1)?.[0], 'one.mp4 imported two.mp4 imported');

	placement.options.blocked = true;
	assert.equal(await createProjectImportService(placement.runtime).importFiles([file('ignored.mp4', 'video/mp4')]), undefined);
	assert.equal(await createProjectImportService(placement.runtime).importFiles([]), undefined);
});

test('import options reject invalid tracks and unsafe frame values', async () => {
	const fixture = createFixture();
	const service = createProjectImportService(fixture.runtime);
	assert.throws(() => service.normalizeImportTimelineStartFrame(Number.MAX_VALUE), /finite/iu);
	assert.throws(() => service.normalizeImportOptions({ destination: 'elsewhere' }), /Unsupported/u);
	await assert.rejects(
		() => service.importFile(file('missing-track.mp3', 'audio/mpeg'), {
			destination: 'timeline', trackId: 'missing', timelineStartFrame: 0,
		}),
		/Audio track not found/iu,
	);
	fixture.setProject({ id: 'current', tracks: [{ id: 'video', type: 'video' }], sources: [] });
	await assert.rejects(
		() => service.importFile(file('video-track.mp3', 'audio/mpeg'), {
			destination: 'timeline', trackId: 'video', timelineStartFrame: 0,
		}),
		/Audio track not found/iu,
	);
});
