/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { publishGeneratedAudioSource } from '../src/common/editor/controller/edit/internal/generated-source-publication.ts';
import type { AudioBufferLike } from '../src/common/editor/controller/source/source-audio.ts';

type FailureStage = 'commit' | 'cache' | 'analysis';

function publicationFixture(options: Readonly<{
	failureStage?: FailureStage;
	rollbackFailures?: boolean;
}> = {}) {
	const events: string[] = [];
	const primary = new Error(`${options.failureStage ?? 'accept'} failed`);
	const cleanupFailures = {
		abort: new Error('abort failed'),
		buffer: new Error('buffer cleanup failed'),
		peaks: new Error('peak cleanup failed'),
		source: new Error('source cleanup failed'),
	};
	const buffers = new Map<string, AudioBufferLike>();
	const peaks = new Map<string, unknown>();
	let acceptedSource: Readonly<Record<string, unknown>> | null = null;
	let beginMetadata: Readonly<Record<string, unknown>> | null = null;
	const signal = new AbortController().signal;
	const channels = [Float32Array.of(0.25, -0.5)];
	const buffer: AudioBufferLike = {
		length: 2,
		numberOfChannels: 1,
		sampleRate: 48_000,
		getChannelData: () => channels[0]!,
	};
	const writer = {
		write: async (_channels: Float32Array[]): Promise<void> => {},
		commit: async () => {
			events.push('commit');
			if (options.failureStage === 'commit') throw primary;
		},
		abort: async () => {
			events.push('abort');
			if (options.rollbackFailures) throw cleanupFailures.abort;
		},
	};
	const dependencies = {
		sourceChunkFrames: 65_536,
		getAudioContext: async () => {
			events.push('context');
			return {};
		},
		createBuffer: async () => {
			events.push('buffer');
			return buffer;
		},
		createId: () => 'generator-1',
		store: {
			beginSourceWrite: async (_sourceId: string, metadata: Readonly<Record<string, unknown>>) => {
				events.push('begin');
				beginMetadata = metadata;
				return writer;
			},
			saveAnalysis: async () => {
				events.push('analysis');
				if (options.failureStage === 'analysis') throw primary;
			},
			deleteSource: async () => {
				events.push('source-delete');
				if (options.rollbackFailures) throw cleanupFailures.source;
			},
		},
		writeBuffer: async (_writer: typeof writer, _buffer: AudioBufferLike, receivedSignal: AbortSignal) => {
			assert.equal(receivedSignal, signal);
			events.push('write');
		},
		cacheSourceBuffer: (sourceId: string, value: AudioBufferLike) => {
			events.push('cache');
			if (options.failureStage === 'cache') throw primary;
			buffers.set(sourceId, value);
		},
		generatePeaks: async () => {
			events.push('peaks');
			return { maximum: 0.5 };
		},
		peakCacheKey: (sourceId: string) => `peaks:${sourceId}`,
		sourceBuffers: {
			delete(sourceId: string) {
				events.push('buffer-delete');
				if (options.rollbackFailures) throw cleanupFailures.buffer;
				return buffers.delete(sourceId);
			},
		},
		sourcePeaks: {
			set(sourceId: string, value: unknown) {
				events.push('peak-cache');
				peaks.set(sourceId, value);
			},
			delete(sourceId: string) {
				events.push('peak-delete');
				if (options.rollbackFailures) throw cleanupFailures.peaks;
				return peaks.delete(sourceId);
			},
		},
	};
	const request = {
		name: 'Tone',
		sampleRate: 48_000,
		channelCount: 1,
		frameCount: 2,
		channels,
		ownership: {
			signal,
			assertCurrent() { events.push('current'); },
		},
		prepare(source: Readonly<Record<string, unknown>>) {
			events.push('prepare');
			return source;
		},
		accept(source: Readonly<Record<string, unknown>>, prepared: Readonly<Record<string, unknown>>) {
			assert.equal(prepared, source);
			events.push('accept');
			acceptedSource = source;
			return 'accepted';
		},
	};
	return {
		acceptedSource: () => acceptedSource,
		beginMetadata: () => beginMetadata,
		buffers,
		channels,
		cleanupFailures,
		dependencies,
		events,
		peaks,
		primary,
		request,
	};
}

test('generated audio publication owns the durable writer, caches, analysis, and acceptance order', async () => {
	const fixture = publicationFixture();

	assert.equal(await publishGeneratedAudioSource(fixture.dependencies, fixture.request), 'accepted');
	assert.deepEqual(fixture.beginMetadata(), {
		name: 'Tone', mimeType: 'audio/wav', sampleRate: 48_000, channelCount: 1, chunkFrames: 65_536,
	});
	assert.deepEqual(fixture.acceptedSource(), {
		sampleRate: 48_000, sampleFormat: 'float32', chunkFrames: 65_536,
		id: 'generator-1', storageKey: 'generator-1', name: 'Tone', mimeType: 'audio/wav',
		frameCount: 2, channelCount: 1, originalSampleRate: 48_000,
		provenance: { schemaVersion: 1, classification: 'generated', contributions: [] },
	});
	assert.equal(fixture.buffers.has('generator-1'), true);
	assert.equal(fixture.peaks.has('generator-1'), true);
	assert.deepEqual(fixture.events, [
		'context', 'current', 'buffer', 'current', 'begin', 'current', 'write', 'current',
		'commit', 'current', 'prepare', 'cache', 'peaks', 'current', 'peak-cache', 'analysis', 'current', 'accept',
	]);
});

for (const failureStage of ['commit', 'cache', 'analysis'] as const) {
	void test(`generated audio publication rolls back a ${failureStage} failure`, async () => {
		const fixture = publicationFixture({ failureStage });

		await assert.rejects(
			publishGeneratedAudioSource(fixture.dependencies, fixture.request),
			(error: unknown) => error === fixture.primary,
		);
		assert.deepEqual(fixture.events.slice(-4), [
			'abort', 'buffer-delete', 'peak-delete', 'source-delete',
		]);
		assert.equal(fixture.buffers.has('generator-1'), false);
		assert.equal(fixture.peaks.has('generator-1'), false);
		assert.equal(fixture.acceptedSource(), null);
	});
}

test('generated audio rollback attempts every cleanup and aggregates its failures after the primary', async () => {
	const fixture = publicationFixture({ failureStage: 'commit', rollbackFailures: true });

	await assert.rejects(
		publishGeneratedAudioSource(fixture.dependencies, fixture.request),
		(error: unknown) => {
			assert.ok(error instanceof AggregateError);
			assert.equal(error.cause, fixture.primary);
			assert.deepEqual(error.errors, [fixture.primary, ...Object.values(fixture.cleanupFailures)]);
			return true;
		},
	);
	assert.deepEqual(fixture.events.slice(-4), ['abort', 'buffer-delete', 'peak-delete', 'source-delete']);
});

test('stream publication persists each admitted block before requesting another and uses worker peaks', async () => {
	const fixture = publicationFixture();
	let writes = 0;
	let finalized = false;
	const request = { ...fixture.request, channels: undefined, stream: {
		type: 'tone', sampleRate: 48_000, channelCount: 1, frameCount: 2,
		async *chunks() {
			yield [Float32Array.of(0.25)];
			assert.equal(writes, 1);
			yield [Float32Array.of(-0.5)];
			assert.equal(writes, 2);
		},
		finish: async () => { finalized = true; return { version: 1, channelCount: 1, levels: [] }; },
		close() {},
	} };
	fixture.dependencies.store.beginSourceWrite = async () => ({
		write: async (channels: Float32Array[]) => { assert.equal(channels[0]?.length, 1); writes++; },
		commit: async () => { assert.equal(writes, 2); }, abort: async () => undefined,
	});
	assert.equal(await publishGeneratedAudioSource(fixture.dependencies, request), 'accepted');
	assert.equal(finalized, true);
	assert.equal(fixture.events.includes('buffer'), false);
	assert.equal(fixture.events.includes('peaks'), false);
	assert.equal(fixture.buffers.size, 0);
});

test('short stream publication fills one resident buffer without retaining its input chunks', async () => {
	const fixture = publicationFixture();
	const resident = Float32Array.of(0, 0);
	const dependencies = { ...fixture.dependencies, createEmptyBuffer: async () => ({
		length: 2, sampleRate: 48_000, numberOfChannels: 1, getChannelData: () => resident,
	}) };
	const stream = {
		type: 'tone', sampleRate: 48_000, channelCount: 1, frameCount: 2,
		async *chunks() { yield [Float32Array.of(0.25)]; yield [Float32Array.of(-0.5)]; },
		finish: async () => ({ version: 1, channelCount: 1, levels: [] }), close() {},
	};
	await publishGeneratedAudioSource(dependencies, { ...fixture.request, channels: undefined, stream });
	assert.deepEqual(resident, fixture.channels[0]);
	assert.equal(fixture.buffers.size, 1);
});

test('large streams never allocate a whole AudioBuffer and roll back an interrupted block producer', async () => {
	const fixture = publicationFixture();
	const failure = new Error('Worker interrupted');
	const dependencies = { ...fixture.dependencies, createEmptyBuffer: async () => { throw new Error('Whole-result allocation'); } };
	const stream = {
		type: 'noise', sampleRate: 48_000, channelCount: 1, frameCount: 8_388_609,
		async *chunks(): AsyncGenerator<readonly Float32Array[]> { yield [new Float32Array(65_536)]; throw failure; },
		finish: async () => ({ version: 1, channelCount: 1, levels: [] }), close() {},
	};
	await assert.rejects(publishGeneratedAudioSource(dependencies, { ...fixture.request, frameCount: stream.frameCount,
		channels: undefined, stream }), error => error === failure);
	assert.equal(fixture.events.includes('context'), false);
	assert.equal(fixture.acceptedSource(), null);
	assert.deepEqual(fixture.events.slice(-4), ['abort', 'buffer-delete', 'peak-delete', 'source-delete']);
});
