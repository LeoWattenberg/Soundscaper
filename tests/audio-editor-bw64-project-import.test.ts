/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import { createProjectImportService, type ProjectImportRuntime } from '../src/common/editor/controller/project-import-service.ts';
import {
	createCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';

interface TestCommand {
	readonly type?: string;
	readonly commands?: readonly TestCommand[];
	readonly source?: unknown;
	readonly changes?: Readonly<Record<string, unknown>>;
}

interface ImportedSource {
	readonly id: string;
	readonly storageKey: string;
	readonly opaqueExtensions: Readonly<{ adm: unknown }>;
}

interface ImportedAdm {
	readonly mode: string;
	readonly payload: unknown;
	readonly riffChunkSequence?: unknown;
	readonly opaqueRiffChunks?: unknown;
	readonly source: Readonly<{ id: string; storageKey: string }>;
	readonly geometry: unknown;
	readonly pristineRevision: number;
	readonly valid: boolean;
}

test('empty-project BW64 import attaches JSON-safe pristine ADM provenance atomically', async () => {
	const descriptor = bw64Descriptor();
	const fixture = projectImportFixture(descriptor, emptyProject(7));
	const result = await createProjectImportService(fixture.runtime).importFile(bw64File());
	const children = batchChildren(fixture.commands[0]);
	const source = children.find((command) => command.type === 'source/add')?.source as ImportedSource;
	const adm = children.find((command) => command.type === 'metadata/update')?.changes?.adm as ImportedAdm;

	assert.equal(result.destination, 'timeline');
	assert.equal(adm.mode, 'passthrough');
	assert.deepEqual(adm.payload, descriptor.adm.payload);
	assert.deepEqual(adm.riffChunkSequence, descriptor.adm.riffChunkSequence);
	assert.deepEqual(adm.opaqueRiffChunks, descriptor.adm.opaqueRiffChunks);
	assert.equal(adm.source.id, source.id);
	assert.equal(adm.source.storageKey, source.storageKey);
	assert.deepEqual(adm.geometry, {
		sampleRate: 48_000,
		channelCount: 6,
		frameCount: 4,
		bitDepth: 24,
		float: false,
	});
	assert.equal(adm.pristineRevision, 8);
	assert.equal(adm.valid, true);
	assert.doesNotThrow(() => JSON.stringify(adm));
	assert.deepEqual(source.opaqueExtensions.adm, descriptor.adm);
	const applied = applyEditorCommand(createCurrentAudioEditorProject({
		now: '2026-07-28T12:00:00.000Z',
		revision: 7,
		tracks: [{ id: 'track-1', name: 'Track 1', type: 'audio', clipIds: [] }],
	}), fixture.commands[0] as never, { now: '2026-07-28T12:00:01.000Z' });
	assert.equal(applied.masterChannels, 6);
	assert.equal(applied.revision, adm.pristineRevision);
});

test('empty-project extensible BW64 import promotes its 20 valid bits and persists decoded PCM', async () => {
	const descriptor = bw64Descriptor({ bitDepth: 24, validBitsPerSample: 20 });
	const fixture = projectImportFixture(descriptor, emptyProject(2));
	await createProjectImportService(fixture.runtime).importFile(bw64File());
	const adm = batchChildren(fixture.commands[0])
		.find((command) => command.type === 'metadata/update')?.changes?.adm as ImportedAdm;

	assert.equal(adm.mode, 'passthrough');
	assert.deepEqual(adm.geometry, {
		sampleRate: 48_000,
		channelCount: 6,
		frameCount: 4,
		bitDepth: 20,
		float: false,
	});
	assert.equal(fixture.writtenChannels.length, 1);
	assert.equal(fixture.writtenChannels[0]?.length, descriptor.channelCount);
	assert.equal(fixture.writtenChannels[0]?.[0]?.length, descriptor.frameCount);
});

test('BW64 ADM stays source-scoped outside empty-project frame-zero promotion', async () => {
	for (const [project, timelineStartFrame] of [
		[{
			...emptyProject(0),
			clips: [{ id: 'existing-clip' }],
			tracks: [{ id: 'existing', type: 'audio', clipIds: ['existing-clip'] }],
		}, 0],
		[emptyProject(0), 12],
	] as const) {
		const fixture = projectImportFixture(bw64Descriptor(), project);
		await createProjectImportService(fixture.runtime).importFile(bw64File(), {
			destination: 'timeline',
			trackId: null,
			timelineStartFrame,
		});
		const children = batchChildren(fixture.commands[0]);
		assert.equal(children.find((command) => command.type === 'metadata/update'), undefined);
		const source = children.find((command) => command.type === 'source/add')?.source as ImportedSource;
		assert.deepEqual(source.opaqueExtensions.adm, bw64Descriptor().adm);
	}
});

test('invalid ADM metadata warns but does not roll back imported BW64 audio', async () => {
	const descriptor = bw64Descriptor({
		adm: { ...bw64Descriptor().adm, valid: false, warnings: ['AXML is malformed.'] },
		metadataWarnings: [{ code: 'adm-axml-invalid', message: 'AXML is malformed.' }],
	});
	const fixture = projectImportFixture(descriptor, emptyProject(3));
	const result = await createProjectImportService(fixture.runtime).importFile(bw64File());
	const adm = batchChildren(fixture.commands[0]).find((command) => command.type === 'metadata/update')?.changes?.adm as ImportedAdm;
	assert.equal(result.destination, 'timeline');
	assert.equal(result.metadataWarnings[0].code, 'adm-axml-invalid');
	assert.match(result.notice, /AXML is malformed/u);
	assert.equal(adm, undefined);
	const source = batchChildren(fixture.commands[0]).find((command) => command.type === 'source/add')?.source as ImportedSource;
	assert.deepEqual(source.opaqueExtensions.adm, descriptor.adm);
});

test('incomplete opaque RIFF preservation keeps otherwise-valid ADM source-scoped', async () => {
	const original = bw64Descriptor();
	const message = 'Unmodeled BW64 chunks exceed the 16 MiB preservation limit.';
	const descriptor = bw64Descriptor({
		adm: { ...original.adm, valid: false, warnings: [message] },
		metadataWarnings: [{ code: 'adm-opaque-chunk-preservation-incomplete', message }],
	});
	const fixture = projectImportFixture(descriptor, emptyProject(0));
	const result = await createProjectImportService(fixture.runtime).importFile(bw64File());
	const children = batchChildren(fixture.commands[0]);

	assert.equal(children.find((command) => command.type === 'metadata/update'), undefined);
	assert.ok(result.metadataWarnings.some(({ code }: { code: string }) => (
		code === 'adm-opaque-chunk-preservation-incomplete'
	)));
	const source = children.find((command) => command.type === 'source/add')?.source as ImportedSource;
	assert.deepEqual(source.opaqueExtensions.adm, descriptor.adm);
});

test('non-reproducible ADM source geometry stays source-scoped with an import warning', async () => {
	for (const [name, overrides] of [
		['sample-rate mismatch', { sampleRate: 96_000 }],
		['32-bit PCM', { bitDepth: 32 }],
		['float PCM', { bitDepth: 32, encoding: 'ieee-float' }],
		['more than 32 channels', { channelCount: 33 }],
	] as const) {
		const descriptor = bw64Descriptor(overrides);
		const fixture = projectImportFixture(descriptor, emptyProject(0));
		const result = await createProjectImportService(fixture.runtime).importFile(bw64File());
		const children = batchChildren(fixture.commands[0]);
		assert.equal(children.find((command) => command.type === 'metadata/update'), undefined, name);
		assert.ok(result.metadataWarnings.some(({ code }: { code: string }) => (
			code === 'adm-passthrough-geometry-unsupported'
			|| code === 'adm-passthrough-sample-rate-mismatch'
		)), name);
	}
});

test('non-neutral empty projects keep otherwise eligible ADM source-scoped', async () => {
	const neutral = emptyProject(0);
	for (const [name, project] of [
		['master gain', { ...neutral, master: { ...neutral.master, gain: 0.5 } }],
		['master effect', { ...neutral, master: { ...neutral.master, effects: [{ id: 'limiter' }] } }],
		['track pan', {
			...neutral,
			tracks: neutral.tracks.map((track) => ({ ...track, pan: 0.25 })),
		}],
		['mixer bus', {
			...neutral,
			mixer: { ...neutral.mixer, groups: [{ id: 'group', gain: 1, pan: 0, effects: [] }] },
		}],
	] as const) {
		const fixture = projectImportFixture(bw64Descriptor(), project);
		const result = await createProjectImportService(fixture.runtime).importFile(bw64File());
		const children = batchChildren(fixture.commands[0]);
		assert.equal(children.find((command) => command.type === 'metadata/update'), undefined, name);
		assert.ok(result.metadataWarnings.some(({ code }: { code: string }) => (
			code === 'adm-passthrough-project-not-pristine'
		)), name);
	}
});

function bw64Descriptor(overrides: Record<string, unknown> = {}) {
	const channelCount = typeof overrides.channelCount === 'number' ? overrides.channelCount : 6;
	return {
		channelCount,
		frameCount: 4,
		sampleRate: 48_000,
		bitDepth: 24,
		encoding: 'pcm-integer',
		pcmBytes: 24,
		metadataWarnings: [],
		adm: {
			container: 'bw64',
			payload: {
				kind: 'axml',
				xml: '<audioFormatExtended />',
				rawBase64: Buffer.from('<audioFormatExtended />').toString('base64'),
			},
			riffChunkSequence: [{
				id: 'JUNK',
				placement: 'before-data',
				rawBase64: Buffer.from([0x4a, 0x55, 0x4e, 0x4b, 3, 0, 0, 0, 1, 2, 3, 0]).toString('base64'),
			}],
			opaqueRiffChunks: [{
				id: 'JUNK',
				placement: 'before-data',
				rawBase64: Buffer.from([0x4a, 0x55, 0x4e, 0x4b, 3, 0, 0, 0, 1, 2, 3, 0]).toString('base64'),
			}],
			chna: {
				numTracks: channelCount,
				entries: Array.from({ length: channelCount }, (_, index) => ({
					trackIndex: index + 1,
					uid: `ATU_${String(index + 1).padStart(8, '0')}`,
					trackRef: `AC_${String(index + 1).padStart(8, '0')}`,
					packRef: 'AP_00010003',
				})),
				rawBase64: 'AgACAAEATFVfMDAwMDAwMDFBQ18wMDAxMDAwMV8wMEFQXzAwMDEwMDAyAAIATFVfMDAwMDAwMDJBQ18wMDAxMDAwMl8wMEFQXzAwMDEwMDAyAA==',
			},
			valid: true,
			warnings: [],
		},
		...overrides,
	};
}

function emptyProject(revision: number) {
	return {
		id: 'project',
		revision,
		sampleRate: 48_000,
		metadata: { bext: null, ixml: null, cart: null, adm: null },
		sources: [],
		clips: [],
		tracks: [{
			id: 'track-1', name: 'Track 1', type: 'audio', clipIds: [],
			gain: 1, pan: 0, mute: false, solo: false, envelope: [], effects: [],
		}],
		master: { gain: 1, pan: 0, mute: false, solo: false, envelope: [], effects: [] },
		mixer: { groups: [], sends: [], routes: {} },
		projectBin: { clips: [] },
	};
}

function bw64File() {
	const bytes = new TextEncoder().encode('BW64');
	return {
		name: 'programme.wav',
		type: 'audio/wav',
		size: bytes.byteLength,
		async arrayBuffer() { return bytes.buffer.slice(0); },
		slice(start = 0, end = bytes.byteLength) {
			const part = bytes.slice(start, end);
			return { async arrayBuffer() { return part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength); } };
		},
	};
}

function projectImportFixture(descriptor: ReturnType<typeof bw64Descriptor>, project: Record<string, unknown>) {
	const commands: unknown[] = [];
	const writtenChannels: Float32Array[][] = [];
	let nextId = 0;
	const writer = {
		async write(channels: Float32Array[]) { writtenChannels.push(channels); },
		async commit() { return { chunkCount: 1 }; },
		async abort() {},
	};
	const runtime: ProjectImportRuntime = {
		SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES: 8,
		SOURCE_CHUNK_FRAMES: 4,
		activateStoredSource: async () => undefined,
		audioBufferChannels: () => [],
		bufferFromChannels: async () => null,
		cacheSourceBuffer: () => undefined,
		canonicalizeBuffer: async () => null,
		commit: (command: unknown) => { commands.push(command); },
		convertLegacyAupToProject: () => null,
		copy: {
			importing: 'Importing', done: 'Done', importSummary: '', timelineFramesFinite: 'finite',
			audioTrackNotFound: 'not found', track: 'Track',
		},
		createAddClipCommand: (trackId: string, clip: unknown) => ({ type: 'clip/add', trackId, clip }),
		createAddSourceCommand: (source: unknown) => ({ type: 'source/add', source }),
		createAddTrackCommand: (track: unknown) => ({ type: 'track/add', track }),
		createStableId: (prefix: string) => `${prefix}-${++nextId}`,
		decodeLegacyAupProject: async () => null,
		editingBlocked: () => false,
		engine: { getAudioContext: async () => null, decodeAudioData: async () => null },
		ffmpeg: { decode: async () => null },
		findTrack: (value: { tracks: Array<{ id: string }> }, id: string) => value.tracks.find((track) => track.id === id),
		formatLegacyAupWarning: () => '',
		generateWaveformPeaks: async () => ({ levels: [] }),
		handleError: () => undefined,
		importVideoFile: async () => null,
		inspectEncodedAudioSampleRate: () => 48_000,
		inspectWavBlobPcm: async () => descriptor,
		isAudioEditorVideoFile: () => false,
		isLegacyAupFile: () => false,
		isLegacyBlockFile: () => false,
		isWavFile: () => true,
		peakCacheKey: (id: string) => id,
		preflightStorage: async () => undefined,
		getProject: () => project,
		projectSampleRate: () => 48_000,
		publishDocumentSnapshot: () => undefined,
		setStatus: () => undefined,
		sourceBuffers: new Map(),
		sourceChunkProviders: new Map(),
		sourcePcmBytes: (value: Record<string, number>) => value.pcmBytes,
		sourcePeaks: new Map(),
		state: { importing: false },
		store: { beginSourceWrite: async () => writer, deleteSource: async () => undefined },
		streamWavBlobPcm: async (_file: unknown, options: { onChunk(channels: Float32Array[]): Promise<void> }) => {
			await options.onChunk(Array.from({ length: descriptor.channelCount }, () => new Float32Array(4)));
		},
		stripExtension: (name: string) => name.replace(/\.wav$/u, ''),
		switchProject: async () => undefined,
		warnEnvelope: () => undefined,
		writeBuffer: async () => undefined,
	};
	return { commands, runtime, writtenChannels };
}

function batchChildren(command: unknown): readonly TestCommand[] {
	const candidate = command as TestCommand;
	return candidate?.type === 'batch' ? candidate.commands ?? [] : [candidate];
}
