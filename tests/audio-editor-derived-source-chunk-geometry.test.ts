/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createDerivedSourceService } from '../src/common/editor/controller/derived-source-service.ts';
import {
	SOURCE_CHUNK_FRAMES,
	writeBuffer,
	type AudioBufferLike,
} from '../src/common/editor/controller/source-audio.ts';
import type {
	ControllerProject,
	ControllerSource,
	DerivedSourceRecord,
} from '../src/common/editor/controller/track-domain-types.ts';

const SAMPLE_RATE = 48_000;
const FRAME_COUNT = SOURCE_CHUNK_FRAMES + 1_024;

interface PersistOutcome {
	readonly record: DerivedSourceRecord;
	readonly writeMetadata: readonly Readonly<Record<string, unknown>>[];
	readonly writtenChunkFrames: readonly number[];
	readonly deleted: readonly string[];
}

test('a derived source declares the chunk size its PCM is actually written with', async () => {
	const outcome = await persistDerived(32_768);
	const [metadata] = outcome.writeMetadata;

	assert.equal(outcome.writeMetadata.length, 1);
	assert.equal(metadata.chunkFrames, SOURCE_CHUNK_FRAMES);
	assert.equal(outcome.record.source.chunkFrames, SOURCE_CHUNK_FRAMES);
	assert.deepEqual(outcome.writtenChunkFrames, [SOURCE_CHUNK_FRAMES, FRAME_COUNT - SOURCE_CHUNK_FRAMES]);
	assert.ok(outcome.writtenChunkFrames.every((frames) => frames <= Number(metadata.chunkFrames)));
	assert.deepEqual(outcome.deleted, []);
});

test('a derived source does not inherit an oversized template chunk size', async () => {
	const outcome = await persistDerived(131_072);
	const [metadata] = outcome.writeMetadata;

	assert.equal(metadata.chunkFrames, SOURCE_CHUNK_FRAMES);
	assert.equal(outcome.record.source.chunkFrames, SOURCE_CHUNK_FRAMES);
	assert.deepEqual(outcome.deleted, []);
});

async function persistDerived(templateChunkFrames: number): Promise<PersistOutcome> {
	const writeMetadata: Readonly<Record<string, unknown>>[] = [];
	const writtenChunkFrames: number[] = [];
	const deleted: string[] = [];
	const service = createDerivedSourceService({
		lifetime: { assertActive() {} },
		copy: { effectInvalidAudio: 'Invalid audio' },
		store: {
			beginSourceWrite: async (_sourceId: string, metadata: Readonly<Record<string, unknown>>) => {
				writeMetadata.push(metadata);
				return {
					write: (channels: Float32Array[]) => { writtenChunkFrames.push(channels[0].length); },
					commit: async () => undefined,
					abort: async () => undefined,
				};
			},
			saveAnalysis: async () => undefined,
			deleteAnalysis: async () => undefined,
			deleteSource: async (sourceId: string) => { deleted.push(sourceId); },
		},
		sourceBuffers: new Map<string, AudioBufferLike>(),
		sourcePeaks: new Map<string, unknown>(),
		sourceChunkFrames: SOURCE_CHUNK_FRAMES,
		retireSourceChunkProvider: async () => undefined,
		getProject: project,
		captureProject: () => ({ generation: 1, projectId: 'project' }),
		assertProject() {},
		createId: () => 'derived-source',
		projectSampleRate: () => SAMPLE_RATE,
		getAudioContext: async () => ({}),
		createBufferFromChannels: async (channels: Float32Array[]) => audioBuffer(channels),
		loadSourceChannels: async () => assert.fail('No source load expected.'),
		writeBuffer,
		generateWaveformPeaks: async () => ({ levels: [] }),
		peakCacheKey: (sourceId: string) => `peaks:${sourceId}`,
		cacheSourceBuffer() {},
	});

	const record = await service.persistDerivedSource(
		template(templateChunkFrames),
		[Float32Array.from({ length: FRAME_COUNT }, (_, frame) => (frame % 11) / 11)],
		'Derived',
	);
	return { record, writeMetadata, writtenChunkFrames, deleted };
}

function template(chunkFrames: number): ControllerSource {
	return {
		id: 'source',
		storageKey: 'source',
		name: 'Source',
		mimeType: 'audio/wav',
		frameCount: FRAME_COUNT,
		channelCount: 1,
		sampleRate: SAMPLE_RATE,
		originalSampleRate: SAMPLE_RATE,
		sampleFormat: 'float32',
		chunkFrames,
	};
}

function project(): ControllerProject {
	return {
		schemaVersion: 17,
		id: 'project',
		title: 'Project',
		sampleRate: SAMPLE_RATE,
		tracks: [],
		clips: [],
		sources: [],
		selection: null,
		mixer: { groups: [], sends: [], routes: {} },
		trackFolders: [],
	};
}

function audioBuffer(channels: readonly Float32Array[]): AudioBufferLike {
	return {
		length: channels[0].length,
		numberOfChannels: channels.length,
		sampleRate: SAMPLE_RATE,
		getChannelData: (channel: number) => channels[channel],
	};
}
