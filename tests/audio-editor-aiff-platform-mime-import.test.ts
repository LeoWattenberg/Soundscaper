/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { encodeAiff } from '../src/common/editor/aiff.js';
import { maintainedAiffMimeType } from '../src/common/editor/controller/aiff-file-identity.ts';
import { admitChangedContentAudioCandidate } from '../src/common/editor/controller/audio-relink-probe.ts';
import { inspectDesktopStandalonePcm } from '../src/common/editor/controller/desktop-standalone-pcm-import.ts';
import { createIncrementalPcmImporter } from '../src/common/editor/controller/incremental-wav-import-service.ts';
import { createLinkedAudioImportAdmission } from '../src/common/editor/controller/linked-audio-import-admission.ts';
import { createLinkedPcmImporter } from '../src/common/editor/controller/linked-wav-import-service.ts';
import { DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER } from '../src/common/editor/desktop-main-audio-codec-runtime-marker.ts';

const LOCATOR_ID = 'locator_0000000000000001';
const LOCATOR_REVISION = 'revision_0000000000000001';

test('maintained AIFF identity canonicalises the platform MIME spellings a picker reports', () => {
	for (const type of ['audio/x-aiff', 'AUDIO/X-AIFF', 'audio/aiff', 'audio/x-aiff; charset=binary', '']) {
		assert.equal(maintainedAiffMimeType({ name: 'field.aiff', type }), 'audio/aiff', type);
	}
	assert.equal(maintainedAiffMimeType({ name: 'field.AIF' }), 'audio/aiff');
	assert.equal(maintainedAiffMimeType({ name: 'field.aiff', type: 'audio/wav' }), null);
	assert.equal(maintainedAiffMimeType({ name: 'field.aifc', type: 'audio/x-aiff' }), null);
	assert.equal(maintainedAiffMimeType({ name: 'field.wav', type: 'audio/x-aiff' }), null);
	assert.equal(maintainedAiffMimeType('field.aiff'), null);
	assert.equal(maintainedAiffMimeType(null), null);
});

test('desktop standalone import reads a platform-typed AIFF on the maintained PCM reader', async () => {
	const codecRuntime = { [DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER]: true as const };
	const file = new File([aiffBytes()], 'linux.aiff', { type: 'audio/x-aiff' });

	const descriptor = await inspectDesktopStandalonePcm(file, codecRuntime, null) as Readonly<{
		container: string;
		frameCount: number;
		channelCount: number;
		sampleRate: number;
	}> | null;

	assert.ok(descriptor, 'a platform-typed AIFF must stay on the bounded first-party reader');
	assert.equal(descriptor.container, 'aiff');
	assert.equal(descriptor.frameCount, 5);
	assert.equal(descriptor.channelCount, 2);
	assert.equal(descriptor.sampleRate, 48_000);
	assert.equal(
		await inspectDesktopStandalonePcm(
			new File([aiffBytes()], 'compressed.aiff', { type: 'audio/mpeg' }),
			codecRuntime,
			null,
		),
		null,
	);
});

test('incremental PCM import stores the canonical AIFF MIME type for a platform-typed file', async () => {
	const beginMimeTypes: unknown[] = [];
	const sourceMimeTypes: unknown[] = [];
	const importIncrementalPcm = createIncrementalPcmImporter({
		SOURCE_CHUNK_FRAMES: 2,
		activateStoredSource: async () => undefined,
		commit: () => undefined,
		copy: { track: 'Track' },
		createStableId: (prefix: string) => `${prefix}-1`,
		getProject: () => ({ tracks: [] }),
		importResultWithWarnings: (result: unknown) => result,
		preflightStorage: async () => undefined,
		prepareImportedMediaCommand: (source: { mimeType: unknown }) => {
			sourceMimeTypes.push(source.mimeType);
			return { command: {}, selection: {}, result: { destination: 'timeline' } };
		},
		projectSampleRate: () => 48_000,
		reportProgress: () => undefined,
		retireSourceChunkProvider: async () => undefined,
		sourceBuffers: new Map<string, unknown>(),
		sourcePcmBytes: () => 8,
		sourcePeaks: new Map<string, unknown>(),
		store: {
			async beginSourceWrite(_sourceId: string, metadata: Record<string, unknown>) {
				beginMimeTypes.push(metadata.mimeType);
				return {
					abort: async () => undefined,
					commit: async () => ({ chunkCount: 1 }),
					write: async () => undefined,
				};
			},
			deleteSource: async () => undefined,
		},
		streamAiffBlobPcm: async (_file: unknown, options: {
			onChunk(channels: Float32Array[]): Promise<void>;
		}) => options.onChunk([Float32Array.of(0.25, -0.25)]),
		streamWavBlobPcm: async () => { throw new Error('An AIFF container must not stream on the WAV reader.'); },
		stripExtension: (name: string) => name.replace(/\.[^.]+$/u, ''),
		warnEnvelope: () => undefined,
	});

	await importIncrementalPcm(
		{ name: 'linux.aiff', type: 'audio/x-aiff' },
		{ container: 'aiff', frameCount: 2, channelCount: 1, sampleRate: 48_000 },
		{},
		{},
	);

	assert.deepEqual(beginMimeTypes, ['audio/aiff']);
	assert.deepEqual(sourceMimeTypes, ['audio/aiff']);
});

test('linked AIFF admission binds the canonical identity for a platform-typed file', async () => {
	const bound: Array<Record<string, unknown>> = [];
	const importLinkedAudio = createLinkedAudioImportAdmission({
		importLinkedPcm: createLinkedPcmImporter({
			SOURCE_CHUNK_FRAMES: 65_536,
			activateStoredSource: async () => undefined,
			assertProject: () => undefined,
			captureProject: () => 'project-generation-1',
			commit: () => undefined,
			copy: { track: 'Track' },
			createStableId: (prefix: string) => `${prefix}-1`,
			getProject: () => ({ id: 'project-1', tracks: [], sources: [] }),
			importResultWithWarnings: (result: unknown) => result,
			peakCacheKey: (sourceId: string) => `peaks:${sourceId}`,
			prepareImportedMediaCommand: () => ({
				command: {},
				selection: {},
				result: { destination: 'project-bin' },
			}),
			projectSampleRate: () => 48_000,
			retireSourceChunkProvider: async () => undefined,
			sourceBuffers: new Map<string, unknown>(),
			sourcePeaks: new Map<string, unknown>(),
			store: {
				async bindLinkedAudioOriginal(_projectId, source) {
					bound.push(source as Record<string, unknown>);
					return { bindingToken: 'binding_token_00000001' };
				},
				async getSourceMetadata(storageKey) { return { sourceId: storageKey, chunkCount: 1 }; },
				async releaseLinkedOriginalLocator() { return true; },
				async unlinkLinkedAudioOriginal() { return true; },
			},
			stripExtension: (name: string) => name.replace(/\.[^.]+$/u, ''),
			warnEnvelope: () => undefined,
		}),
		inspectWavBlobPcm: async () => { throw new Error('A maintained AIFF must not reach the WAV reader.'); },
		isWavFile: () => false,
		prepareWavImportMetadata: () => ({}),
		releaseLinkedOriginalLocator: async () => true,
		validateImportTimelineTrack: () => undefined,
	});
	const file = new File([aiffBytes()], 'field-recording.aiff', { type: 'audio/x-aiff' });

	await importLinkedAudio(file, {
		destination: 'project-bin',
		linkedAudioLocatorId: LOCATOR_ID,
		linkedAudioLocatorRevision: LOCATOR_REVISION,
	}, { kind: 'audio', locatorId: LOCATOR_ID, locatorRevision: LOCATOR_REVISION });

	assert.equal(bound.length, 1);
	assert.equal(bound[0]?.name, 'field-recording.aiff');
	assert.equal(bound[0]?.mimeType, 'audio/aiff');
});

test('changed-content relink admits a platform-typed AIFF replacement for a canonical source', async () => {
	const replacement = new File([aiffBytes()], 'replacement.aiff', { type: 'audio/x-aiff' });

	await admitChangedContentAudioCandidate(replacement, {
		mimeType: 'audio/aiff',
		frameCount: 5,
		channelCount: 2,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
	});
});

function aiffBytes(): Uint8Array {
	const encoded = encodeAiff([
		Float32Array.of(-1, -0.5, 0, 0.5, 0.75),
		Float32Array.of(0.25, -0.25, 0.75, -0.75, 0),
	], { sampleRate: 48_000, sampleFormat: 'int16', dither: 'none' });
	assert.ok(encoded instanceof Uint8Array);
	return Uint8Array.from(encoded);
}
