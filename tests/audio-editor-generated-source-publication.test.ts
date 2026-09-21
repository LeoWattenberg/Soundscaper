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
		write: async () => undefined,
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
