import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createDerivedSourceService,
} from '../src/common/editor/controller/track-audio/internal/derived-audio/derived-source-service.ts';
import type { AudioBufferLike } from '../src/common/editor/controller/source/source-audio.ts';
import {
	deriveSourceProvenance,
	INCOMPLETE_DERIVED_ATTRIBUTION_WARNING,
} from '../src/common/editor/source-provenance-derivation.ts';
import {
	createImportedSourceProvenance,
	createNonImportedSourceProvenance,
} from '../src/common/editor/source-provenance.ts';

test('derived provenance merges and deduplicates every imported contribution', () => {
	const first = importedProvenance('first', 'First.wav');
	const second = importedProvenance('second', 'Second.wav');
	const merged = deriveSourceProvenance([
		{ provenance: first },
		{ provenance: second },
		{ provenance: first },
	]);

	assert.equal(merged?.classification, 'derived');
	assert.deepEqual(merged?.contributions.map(({ id }) => id), ['first', 'second']);
	assert.equal(deriveSourceProvenance([{}]), undefined);
	assert.deepEqual(deriveSourceProvenance([{
		provenance: createNonImportedSourceProvenance('recorded'),
	}]), {
		schemaVersion: 1,
		classification: 'derived',
		contributions: [],
	});
});

test('derived provenance durably warns when known attribution is mixed with an untracked input', () => {
	const imported = importedProvenance('tracked', 'Tracked.wav');
	const mixed = deriveSourceProvenance([{ provenance: imported }, {}]);

	assert.equal(mixed?.classification, 'derived');
	assert.deepEqual(mixed?.contributions.map(({ id }) => id), ['tracked']);
	assert.deepEqual(mixed?.contributions[0]?.warnings, [INCOMPLETE_DERIVED_ATTRIBUTION_WARNING]);

	const recombined = deriveSourceProvenance([
		{ provenance: imported },
		{ provenance: mixed },
	]);
	assert.deepEqual(recombined?.contributions[0]?.warnings, [INCOMPLETE_DERIVED_ATTRIBUTION_WARNING]);
});

test('derived-source persistence marks a one-input transformation as derived', async () => {
	const buffer = audioBuffer([Float32Array.of(0.25, -0.5)]);
	const service = createDerivedSourceService({
		lifetime: { assertActive() {} },
		copy: { effectInvalidAudio: 'Invalid audio' },
		store: {
			beginSourceWrite: async () => ({
				write() {},
				commit() {},
				abort() {},
			}),
			saveAnalysis: async () => undefined,
			deleteSource: async () => undefined,
		},
		sourceBuffers: new Map(),
		sourcePeaks: new Map(),
		sourceChunkFrames: 65_536,
		retireSourceChunkProvider() {},
		getProject: () => ({
			schemaVersion: 1, id: 'project', title: 'Project', sampleRate: 48_000,
			tracks: [], clips: [], sources: [], mixer: { groups: [], sends: [], routes: {} },
		}),
		captureProject: () => ({ generation: 1, projectId: 'project' }),
		assertProject() {},
		createId: () => 'derived',
		projectSampleRate: () => 48_000,
		getAudioContext: async () => ({}),
		createBufferFromChannels: async () => buffer,
		loadSourceChannels: async () => [buffer.getChannelData(0)],
		writeBuffer: async (writer) => { await writer.write([buffer.getChannelData(0)]); },
		generateWaveformPeaks: async () => ({}),
		peakCacheKey: (sourceId) => `peaks:${sourceId}`,
		cacheSourceBuffer() {},
	});
	const record = await service.persistDerivedSource({
		id: 'import', storageKey: 'import', name: 'Import.wav', mimeType: 'audio/wav',
		frameCount: 2, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
		provenance: importedProvenance('import', 'Import.wav'),
	}, [buffer.getChannelData(0)], 'Derived.wav');

	assert.equal(record.source.provenance?.classification, 'derived');
	assert.deepEqual(record.source.provenance?.contributions.map(({ id }) => id), ['import']);
});

function importedProvenance(id: string, originalFileName: string) {
	return createImportedSourceProvenance({
		id,
		origin: {
			kind: 'local-file',
			originalFileName,
			mimeType: 'audio/wav',
		},
	});
}

function audioBuffer(channels: readonly Float32Array[]): AudioBufferLike {
	return {
		length: channels[0]!.length,
		numberOfChannels: channels.length,
		sampleRate: 48_000,
		getChannelData: (channel) => channels[channel]!,
	};
}
