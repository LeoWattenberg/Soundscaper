import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createDerivedSourceService,
} from '../src/common/editor/controller/track-audio/internal/derived-audio/derived-source-service.ts';
import type { AudioBufferLike } from '../src/common/editor/controller/source/source-audio.ts';
import {
	deriveEffectResultProvenance,
	deriveSourceProvenanceForIds,
	deriveSourceProvenance,
	INCOMPLETE_DERIVED_ATTRIBUTION_WARNING,
} from '../src/common/editor/source-provenance-derivation.ts';
import { loadSourceProvenanceDerivation } from '../src/common/editor/source-provenance-derivation-loader.ts';
import { createNonImportedSourceProvenance } from '../src/common/editor/source-provenance-root.ts';
import {
	createImportedSourceProvenance,
} from '../src/common/editor/source-provenance.ts';

test('derived provenance runtime is deferred behind one cached module promise', async () => {
	const first = loadSourceProvenanceDerivation();
	assert.equal(loadSourceProvenanceDerivation(), first);
	assert.equal((await first).deriveSourceProvenance, deriveSourceProvenance);
});

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

test('render provenance selects only sources that materially overlap an effect target', () => {
	const sources = [
		{ id: 'before', provenance: importedProvenance('before', 'Before.wav') },
		{ id: 'inside', provenance: importedProvenance('inside', 'Inside.wav') },
		{ id: 'after', provenance: importedProvenance('after', 'After.wav') },
	];
	const project = {
		sources,
		tracks: [{ id: 'track', clipIds: ['before-clip', 'inside-clip', 'after-clip'] }],
		clips: [
			{ id: 'before-clip', sourceId: 'before', timelineStartFrame: 0, durationFrames: 10 },
			{ id: 'inside-clip', sourceId: 'inside', timelineStartFrame: 10, durationFrames: 10 },
			{ id: 'after-clip', sourceId: 'after', timelineStartFrame: 20, durationFrames: 10 },
		],
	};
	const target = {
		track: { id: 'track' }, startFrame: 10, endFrame: 20,
	};

	assert.deepEqual(deriveEffectResultProvenance(project, target)?.contributions
		.map(({ id }) => id), ['inside']);
	assert.deepEqual(deriveSourceProvenanceForIds(sources, ['after', 'before'])?.contributions
		.map(({ id }) => id), ['before', 'after']);
});

test('derived provenance is detached, frozen and compares contribution metadata canonically', () => {
	const first = structuredClone(importedProvenance('tracked', 'Tracked.wav'));
	const contribution = first.contributions[0]!;
	(contribution.metadata.raw as Record<string, unknown>).first = 1;
	(contribution.metadata.raw as Record<string, unknown>).second = 2;
	const reordered = structuredClone(first);
	(reordered.contributions[0]!.metadata as { raw: Record<string, unknown> }).raw = { second: 2, first: 1 };

	const derived = deriveSourceProvenance([{ provenance: first }, { provenance: reordered }]);
	(contribution.metadata.raw as Record<string, unknown>).first = 9;

	assert.equal(derived?.contributions[0]?.metadata.raw.first, 1);
	assert.equal(Object.isFrozen(derived?.contributions[0]?.metadata.raw), true);
	assert.throws(() => createNonImportedSourceProvenance('imported' as never), /recorded or generated/iu);
});

test('derived provenance preserves contribution and warning bounds across merged inputs', () => {
	assert.throws(() => deriveSourceProvenance(Array.from({ length: 257 }, (_, index) => ({
		provenance: importedProvenance(`source-${String(index)}`, `${String(index)}.wav`),
	}))), /cannot exceed 256/iu);

	const warnings = Array.from({ length: 256 }, (_, index) => `warning-${String(index)}`);
	const first = createImportedSourceProvenance({
		...importedContribution('same', 'Same.wav'),
		warnings,
	});
	const second = createImportedSourceProvenance({
		...importedContribution('same', 'Same.wav'),
		warnings: ['one-more-warning'],
	});
	assert.throws(() => deriveSourceProvenance([
		{ provenance: first }, { provenance: second },
	]), /cannot exceed 256/iu);
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
	return createImportedSourceProvenance(importedContribution(id, originalFileName));
}

function importedContribution(id: string, originalFileName: string) {
	return {
		id,
		origin: {
			kind: 'local-file',
			originalFileName,
			mimeType: 'audio/wav',
		},
	};
}

function audioBuffer(channels: readonly Float32Array[]): AudioBufferLike {
	return {
		length: channels[0]!.length,
		numberOfChannels: channels.length,
		sampleRate: 48_000,
		getChannelData: (channel) => channels[channel]!,
	};
}
