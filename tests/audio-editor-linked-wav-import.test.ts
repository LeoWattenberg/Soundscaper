/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { encodeAiff } from '../src/common/editor/aiff.js';
import { createLinkedPcmImporter } from '../src/common/editor/controller/linked-wav-import-service.ts';
import {
	createProjectImportService,
	type ProjectImportRuntime,
} from '../src/common/editor/controller/project-import-service.ts';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';
import { encodeWav } from '../src/common/editor/wav.js';

const LOCATOR_ID = 'locator_0000000000000001';
const LOCATOR_REVISION = 'revision_0000000000000001';

type FixtureCall = readonly [string, unknown?, unknown?];

class TestSourceChunkProviders extends Map<string, unknown> {
	readonly #calls: FixtureCall[];
	readonly #drainOperation: () => Promise<void>;

	constructor(calls: FixtureCall[], drainOperation: () => Promise<void>) {
		super();
		this.#calls = calls;
		this.#drainOperation = drainOperation;
	}

	override delete(sourceId: string): boolean {
		this.#calls.push(['delete-provider', sourceId]);
		return super.delete(sourceId);
	}

	async drain(): Promise<void> {
		this.#calls.push(['drain-providers:start']);
		await this.#drainOperation();
		this.#calls.push(['drain-providers:done']);
	}
}

test('linked WAV import binds and activates canonical PCM without publishing an owned body', async () => {
	const fixture = importFixture();
	const result = await fixture.importLinkedWav(
		fixture.file,
		fixture.descriptor,
		fixture.options,
		fixture.wavMetadata,
	);

	assert.deepEqual(result, { destination: 'project-bin', sourceId: 'source-1' });
	assert.deepEqual(fixture.calls.map(([name]) => name), [
		'capture-project', 'prepare-command', 'assert-project', 'bind-audio',
		'get-source-metadata', 'activate-source', 'assert-project', 'commit-command',
		'warn-envelope',
	]);
	const source = fixture.calls.find(([name]) => name === 'bind-audio')?.[1] as Record<string, unknown>;
	assert.deepEqual(source, {
		schemaVersion: 2,
		kind: 'audio',
		sampleFormat: 'float32',
		chunkFrames: 65_536,
		id: 'source-1',
		storageKey: 'source-1',
		name: 'field-recording.wav',
		mimeType: 'audio/wav',
		frameCount: 4,
		channelCount: 2,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
	});
	assert.deepEqual(fixture.calls.find(([name]) => name === 'bind-audio')?.[2], {
		locatorId: LOCATOR_ID,
		expectedLocatorRevision: LOCATOR_REVISION,
		expectedSnapshot: fixture.file,
	});
	assert.equal(fixture.calls.some(([name]) => name === 'begin-source-write'), false);
	assert.equal(fixture.calls.some(([name]) => name === 'release-locator'), false);
});

test('linked AIFF import binds the canonical container identity without an owned body', async () => {
	const fixture = importFixture();
	const file = Object.freeze({ name: 'field-recording.aiff', type: 'audio/aiff', size: 62 });
	const result = await fixture.importLinkedPcm(
		file,
		fixture.descriptor,
		fixture.options,
		fixture.wavMetadata,
	);

	assert.deepEqual(result, { destination: 'project-bin', sourceId: 'source-1' });
	const source = fixture.calls.find(([name]) => name === 'bind-audio')?.[1] as Record<string, unknown>;
	assert.equal(source.name, 'field-recording.aiff');
	assert.equal(source.mimeType, 'audio/aiff');
	assert.equal(source.sampleFormat, 'float32');
	assert.equal(fixture.calls.some(([name]) => name === 'begin-source-write'), false);
	assert.equal(fixture.calls.some(([name]) => name === 'release-locator'), false);
});

test('linked WAV import unlinks and releases its exact locator when activation fails', async () => {
	const cancellation = new DOMException('waveform cancelled', 'AbortError');
	const fixture = importFixture({ activationError: cancellation });
	await assert.rejects(
		fixture.importLinkedWav(fixture.file, fixture.descriptor, fixture.options, fixture.wavMetadata),
		(error: unknown) => error === cancellation,
	);
	assert.deepEqual(fixture.calls.filter(([name]) => (
		['delete-provider', 'publish-engine-providers', 'drain-providers:start', 'drain-providers:done',
			'unlink-audio', 'release-locator', 'delete-analysis'].includes(name)
	)), [
		['delete-provider', 'source-1'],
		['publish-engine-providers'],
		['drain-providers:start'],
		['drain-providers:done'],
		['unlink-audio', {
			projectId: 'project-1', sourceId: 'source-1', bindingToken: 'binding_token_00000001',
		}],
		['delete-analysis', 'peaks:source-1'],
		['release-locator', {
			kind: 'audio', locatorId: LOCATOR_ID, locatorRevision: LOCATOR_REVISION,
		}],
	]);
	assert.equal(fixture.sourceBuffers.has('source-1'), false);
	assert.equal(fixture.sourceChunkProviders.has('source-1'), false);
	assert.equal(fixture.sourcePeaks.has('source-1'), false);
});

test('linked WAV rollback retains its binding and locator when provider cleanup fails', async () => {
	const primary = new Error('activation failed');
	const cleanup = new Error('provider cleanup failed');
	const fixture = importFixture({
		activationError: primary,
		providerDrainOperation: async () => { throw cleanup; },
	});

	await assert.rejects(
		fixture.importLinkedWav(fixture.file, fixture.descriptor, fixture.options, fixture.wavMetadata),
		(error: unknown) => {
			assert.ok(error instanceof AggregateError);
			assert.deepEqual(error.errors, [primary, cleanup]);
			assert.strictEqual(error.cause, primary);
			return true;
		},
	);
	assert.equal(fixture.sourceChunkProviders.has('source-1'), false);
	assert.equal(fixture.calls.some(([name]) => name === 'unlink-audio'), false);
	assert.equal(fixture.calls.some(([name]) => name === 'delete-analysis'), false);
	assert.equal(fixture.calls.some(([name]) => name === 'release-locator'), false);
});

test('linked WAV rollback waits for provider cleanup before unlinking its original', async () => {
	const primary = new Error('activation failed');
	const started = deferred();
	const gate = deferred();
	const fixture = importFixture({
		activationError: primary,
		providerDrainOperation: async () => {
			started.resolve();
			await gate.promise;
		},
	});

	const pending = fixture.importLinkedWav(
		fixture.file,
		fixture.descriptor,
		fixture.options,
		fixture.wavMetadata,
	);
	await started.promise;
	assert.equal(fixture.calls.some(([name]) => name === 'unlink-audio'), false);
	assert.equal(fixture.calls.some(([name]) => name === 'release-locator'), false);
	gate.resolve();
	await assert.rejects(pending, (error: unknown) => error === primary);
	assert.equal(fixture.calls.some(([name]) => name === 'unlink-audio'), true);
	assert.equal(fixture.calls.some(([name]) => name === 'release-locator'), true);
});

test('linked WAV import releases an unpublished locator when exact binding fails', async () => {
	const fixture = importFixture({
		bindingError: new Error('binding rejected'),
		providerDrainOperation: async () => { throw new Error('unrelated provider failure'); },
	});
	await assert.rejects(
		fixture.importLinkedWav(fixture.file, fixture.descriptor, fixture.options, fixture.wavMetadata),
		/binding rejected/u,
	);
	assert.equal(fixture.calls.some(([name]) => name === 'unlink-audio'), false);
	assert.deepEqual(fixture.calls.filter(([name]) => name === 'release-locator'), [[
		'release-locator', {
			kind: 'audio', locatorId: LOCATOR_ID, locatorRevision: LOCATOR_REVISION,
		},
	]]);
});

test('linked WAV import releases its locator when local admission fails before binding', async () => {
	for (const [file, descriptor] of [
		[{ ...importFixture().file, type: 'audio/mpeg' }, importFixture().descriptor],
		[importFixture().file, { ...importFixture().descriptor, frameCount: 0 }],
	] as const) {
		const fixture = importFixture();
		await assert.rejects(
			fixture.importLinkedWav(file, descriptor, fixture.options, fixture.wavMetadata),
			/WAV|frame count/iu,
		);
		assert.equal(fixture.calls.some(([name]) => name === 'bind-audio'), false);
		assert.deepEqual(fixture.calls.filter(([name]) => name === 'release-locator'), [[
			'release-locator', {
				kind: 'audio', locatorId: LOCATOR_ID, locatorRevision: LOCATOR_REVISION,
			},
		]]);
	}
});

test('project import admits and activates a canonical linked BW64 .wav without browser decoding', async () => {
	const calls: string[] = [];
	let nextId = 0;
	let project = projectFixture();
	const file = bw64File();
	const runtime: Record<string, unknown> = {
		SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES: 32 * 1024 ** 2,
		SOURCE_CHUNK_FRAMES: 65_536,
		activateStoredSource: async () => { calls.push('activate-source'); },
		assertProject: () => { calls.push('assert-project'); },
		captureProject: () => { calls.push('capture-project'); return 'generation-1'; },
		commit: (command: { readonly commands?: readonly Record<string, unknown>[] }) => {
			calls.push('commit-command');
			const source = command.commands?.find((child) => child.type === 'source/add')?.source;
			project = { ...project, sources: source ? [source] : [] };
		},
		copy: {
			audioTrackNotFound: 'Audio track not found.',
			timelineFramesFinite: 'Timeline frames must be finite.',
			track: 'Track',
		},
		createAddClipCommand: (trackId: string, clip: unknown) => ({ type: 'clip/add', trackId, clip }),
		createAddSourceCommand: (source: unknown) => ({ type: 'source/add', source }),
		createAddTrackCommand: (track: unknown) => ({ type: 'track/add', track }),
		createStableId: (prefix: string) => `${prefix}-${++nextId}`,
		editingBlocked: () => false,
		engine: {
			getAudioContext: async () => { throw new Error('browser decoder path used'); },
		},
		ffmpeg: { decode: async () => { throw new Error('FFmpeg path used'); } },
		findTrack: () => null,
		getProject: () => project,
		inspectWavBlobPcm,
		isAudioEditorVideoFile: () => false,
		isLegacyAupFile: () => false,
		isWavFile: () => true,
		peakCacheKey: (sourceId: string) => `peaks:${sourceId}`,
		projectSampleRate: () => 48_000,
		sourceBuffers: new Map(),
		sourceChunkProviders: new Map(),
		sourcePcmBytes: () => 32,
		sourcePeaks: new Map(),
		store: {
			async beginSourceWrite() { calls.push('begin-source-write'); throw new Error('owned write used'); },
			async bindLinkedAudioOriginal() {
				calls.push('bind-audio');
				return { bindingToken: 'binding_token_00000001' };
			},
			async getSourceMetadata() { return { sourceId: 'source-1', chunkCount: 1 }; },
			async releaseLinkedOriginalLocator() { calls.push('release-locator'); return true; },
			async unlinkLinkedAudioOriginal() { calls.push('unlink-audio'); return true; },
		},
		stripExtension: (name: string) => name.replace(/\.[^.]+$/u, ''),
		warnEnvelope: () => undefined,
	};
	const result = await createProjectImportService(runtime as ProjectImportRuntime).importFile(file, {
		destination: 'project-bin',
		linkedAudioLocatorId: LOCATOR_ID,
		linkedAudioLocatorRevision: LOCATOR_REVISION,
	});
	assert.equal(result.destination, 'project-bin');
	assert.equal(calls.includes('bind-audio'), true);
	assert.equal(calls.includes('activate-source'), true);
	assert.equal(calls.includes('begin-source-write'), false);
});

test('project import admits and activates first-party linked AIFF-C without browser decoding', async () => {
	const calls: string[] = [];
	let nextId = 0;
	let project = projectFixture();
	const boundSources: Readonly<Record<string, unknown>>[] = [];
	const file = aiffFile('float32');
	const runtime: Record<string, unknown> = {
		SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES: 32 * 1024 ** 2,
		SOURCE_CHUNK_FRAMES: 65_536,
		activateStoredSource: async () => { calls.push('activate-source'); },
		assertProject: () => { calls.push('assert-project'); },
		captureProject: () => { calls.push('capture-project'); return 'generation-1'; },
		commit: (command: { readonly commands?: readonly Record<string, unknown>[] }) => {
			calls.push('commit-command');
			const source = command.commands?.find((child) => child.type === 'source/add')?.source;
			project = { ...project, sources: source ? [source] : [] };
		},
		copy: {
			audioTrackNotFound: 'Audio track not found.',
			timelineFramesFinite: 'Timeline frames must be finite.',
			track: 'Track',
		},
		createAddClipCommand: (trackId: string, clip: unknown) => ({ type: 'clip/add', trackId, clip }),
		createAddSourceCommand: (source: unknown) => ({ type: 'source/add', source }),
		createAddTrackCommand: (track: unknown) => ({ type: 'track/add', track }),
		createStableId: (prefix: string) => `${prefix}-${++nextId}`,
		editingBlocked: () => false,
		engine: {
			getAudioContext: async () => { throw new Error('browser decoder path used'); },
		},
		ffmpeg: { decode: async () => { throw new Error('FFmpeg path used'); } },
		findTrack: () => null,
		getProject: () => project,
		inspectWavBlobPcm,
		isAudioEditorVideoFile: () => false,
		isLegacyAupFile: () => false,
		isWavFile: () => false,
		peakCacheKey: (sourceId: string) => `peaks:${sourceId}`,
		projectSampleRate: () => 48_000,
		sourceBuffers: new Map(),
		sourceChunkProviders: new Map(),
		sourcePcmBytes: () => 32,
		sourcePeaks: new Map(),
		store: {
			async beginSourceWrite() { calls.push('begin-source-write'); throw new Error('owned write used'); },
			async bindLinkedAudioOriginal(_projectId: string, source: Readonly<Record<string, unknown>>) {
				calls.push('bind-audio');
				boundSources.push(source);
				return { bindingToken: 'binding_token_00000001' };
			},
			async getSourceMetadata() { return { sourceId: 'source-1', chunkCount: 1 }; },
			async releaseLinkedOriginalLocator() { calls.push('release-locator'); return true; },
			async unlinkLinkedAudioOriginal() { calls.push('unlink-audio'); return true; },
		},
		stripExtension: (name: string) => name.replace(/\.[^.]+$/u, ''),
		warnEnvelope: () => undefined,
	};
	const result = await createProjectImportService(runtime as ProjectImportRuntime).importFile(file, {
		destination: 'project-bin',
		linkedAudioLocatorId: LOCATOR_ID,
		linkedAudioLocatorRevision: LOCATOR_REVISION,
	});

	assert.equal(result.destination, 'project-bin');
	assert.equal(boundSources[0]?.mimeType, 'audio/aiff');
	assert.equal(boundSources[0]?.frameCount, 4);
	assert.equal(calls.includes('activate-source'), true);
	assert.equal(calls.includes('begin-source-write'), false);
	assert.equal(calls.includes('release-locator'), false);
});

interface FixtureOptions {
	readonly activationError?: Error;
	readonly bindingError?: Error;
	readonly providerDrainOperation?: () => Promise<void>;
}

function importFixture(options: FixtureOptions = {}) {
	const calls: FixtureCall[] = [];
	const sourceBuffers = new Map<string, unknown>();
	const sourceChunkProviders = new TestSourceChunkProviders(
		calls,
		options.providerDrainOperation ?? (async () => undefined),
	);
	const sourcePeaks = new Map<string, unknown>();
	let project = Object.freeze({ id: 'project-1', tracks: Object.freeze([]), sources: Object.freeze([]) });
	let nextId = 0;
	const file = Object.freeze({ name: 'field-recording.wav', type: 'audio/wav', size: 60 });
	const descriptor = Object.freeze({
		frameCount: 4,
		channelCount: 2,
		sampleRate: 48_000,
		markers: Object.freeze([]),
	});
	const importOptions = Object.freeze({
		destination: 'project-bin',
		trackId: null,
		timelineStartFrame: 0,
		linkedAudioLocatorId: LOCATOR_ID,
		linkedAudioLocatorRevision: LOCATOR_REVISION,
	});
	const wavMetadata = Object.freeze({
		importOptions,
		warnings: Object.freeze([]),
		projectBext: null,
		projectIxml: null,
		projectCart: null,
		projectAdmCandidate: null,
		sourceBext: null,
		sourceIxml: null,
		sourceCart: null,
		sourceAdm: null,
	});
	const importLinkedPcm = createLinkedPcmImporter({
		SOURCE_CHUNK_FRAMES: 65_536,
		activateStoredSource: async (_source, _metadata) => {
			calls.push(['activate-source']);
			sourceBuffers.set('source-1', {});
			sourceChunkProviders.set('source-1', {});
			sourcePeaks.set('source-1', {});
			if (options.activationError) throw options.activationError;
		},
		assertProject: () => { calls.push(['assert-project']); },
		captureProject: () => { calls.push(['capture-project']); return 'project-generation-1'; },
		commit: (command) => {
			calls.push(['commit-command', command]);
			project = Object.freeze({ ...project, sources: Object.freeze([{ id: 'source-1' }]) }) as never;
		},
		copy: Object.freeze({ track: 'Track' }),
		createStableId: (prefix) => `${prefix}-${++nextId}`,
		getProject: () => project,
		importResultWithWarnings: (result) => result,
		peakCacheKey: (sourceId) => `peaks:${sourceId}`,
		prepareImportedMediaCommand: (source) => {
			calls.push(['prepare-command', source]);
			return {
				command: Object.freeze({ type: 'source/add', source }),
				selection: Object.freeze({}),
				result: Object.freeze({ destination: 'project-bin', sourceId: source.id }),
			};
		},
		projectSampleRate: () => 48_000,
		retireSourceChunkProvider: async (sourceId) => {
			sourceChunkProviders.delete(sourceId);
			calls.push(['publish-engine-providers']);
			await sourceChunkProviders.drain();
		},
		sourceBuffers,
		sourcePeaks,
		store: {
			async bindLinkedAudioOriginal(projectId, source, locatorId, bindOptions) {
				calls.push(['bind-audio', source, { locatorId, ...bindOptions }]);
				assert.equal(projectId, 'project-1');
				if (options.bindingError) throw options.bindingError;
				return Object.freeze({ bindingToken: 'binding_token_00000001' });
			},
			async deleteAnalysis(key) { calls.push(['delete-analysis', key]); },
			async getSourceMetadata(storageKey) {
				calls.push(['get-source-metadata', storageKey]);
				return Object.freeze({ sourceId: storageKey, chunkCount: 1 });
			},
			async releaseLinkedOriginalLocator(reference) {
				calls.push(['release-locator', reference]);
				return true;
			},
			async unlinkLinkedAudioOriginal(projectId, sourceId, bindingToken) {
				calls.push(['unlink-audio', { projectId, sourceId, bindingToken }]);
				return true;
			},
		},
		stripExtension: (name) => name.replace(/\.[^.]+$/u, ''),
		warnEnvelope: () => { calls.push(['warn-envelope']); },
	});
	return {
		calls,
		descriptor,
		file,
		importLinkedPcm,
		importLinkedWav: importLinkedPcm,
		options: importOptions,
		sourceBuffers,
		sourceChunkProviders,
		sourcePeaks,
		wavMetadata,
	};
}

function bw64File() {
	const encoded = encodeWav([
		Float32Array.of(-1, -0.5, 0, 0.5),
		Float32Array.of(0.5, 0, -0.5, -1),
	], {
		container: 'bw64', bitDepth: 16, dither: 'none', sampleRate: 48_000,
	});
	const bytes = new Uint8Array(encoded.byteLength);
	bytes.set(encoded);
	return Object.freeze({
		name: 'field-recording.wav',
		type: 'audio/wav',
		size: bytes.byteLength,
		async arrayBuffer() { return bytes.slice().buffer; },
		slice(start = 0, end = bytes.byteLength) {
			const value = bytes.slice(start, end);
			return { async arrayBuffer() { return value.buffer; } };
		},
	});
}

function aiffFile(sampleFormat: 'int16' | 'float32' = 'int16') {
	const encoded = encodeAiff([
		Float32Array.of(-1, -0.5, 0, 0.5),
		Float32Array.of(0.5, 0, -0.5, -1),
	], { sampleFormat, dither: 'none', sampleRate: 48_000 });
	assert.ok(encoded instanceof Uint8Array);
	const bytes = new Uint8Array(encoded.byteLength);
	bytes.set(encoded);
	return Object.freeze({
		name: 'field-recording.aiff',
		type: 'audio/aiff',
		size: bytes.byteLength,
		async arrayBuffer() { return bytes.slice().buffer; },
		slice(start = 0, end = bytes.byteLength) {
			const value = bytes.slice(start, end);
			return { async arrayBuffer() { return value.buffer; } };
		},
	});
}

function projectFixture() {
	return {
		id: 'project-1',
		revision: 0,
		sampleRate: 48_000,
		metadata: { bext: null, ixml: null, cart: null, adm: null },
		sources: [] as unknown[],
		clips: [] as unknown[],
		tracks: [] as unknown[],
		projectBin: { clips: [] as unknown[] },
	};
}

function deferred() {
	let resolvePromise: () => void = () => undefined;
	const promise = new Promise<void>((resolve) => { resolvePromise = resolve; });
	return { promise, resolve: resolvePromise };
}
