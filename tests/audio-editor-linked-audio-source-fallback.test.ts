/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { encodeWav } from '../src/common/editor/wav.js';
import { LinkedAudioOriginalSourceReader } from '../src/common/editor/storage/linked-audio-original-source-reader.ts';
import { LinkedOriginalResolver } from '../src/common/editor/storage/linked-original-resolver.ts';
import { LinkedOriginalRepository } from '../src/common/editor/storage/linked-original-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { SourceReadRepository } from '../src/common/editor/storage/source-read-repository.ts';
import { SourceRecordRepository } from '../src/common/editor/storage/source-record-repository.ts';
import { SourceRepository } from '../src/common/editor/storage/source-repository.ts';

const LOCATOR_ID = 'locator_audio_000000000001';
const LOCATOR_REVISION = 'snapshot_audio_0000000001';

test('canonical source APIs fall back to linked WAV PCM while list and delete stay owned-only', async () => {
	const body = blobFromBytes(encodeWav([
		Float32Array.of(-1, -0.25, 0.25, 1),
	], { float: true, dither: false, sampleRate: 48_000 }));
	let loads = 0;
	const fixture = sourceFixture(body, () => { loads += 1; });
	await fixture.resolver.bind('project-audio', audioSource(), LOCATOR_ID);

	const metadata = await fixture.sources.getMetadata('physical-audio');
	assert.equal(metadata?.id, 'physical-audio');
	assert.equal(metadata?.frameCount, 4);
	assert.equal(metadata?.chunkCount, 2);
	assert.equal(loads, 1, 'metadata lookup must not reload the selected body');
	assert.deepEqual(await fixture.sources.list(), []);

	const chunk = await fixture.sources.chunk('physical-audio', 1);
	assert.deepEqual({ index: chunk.index, frames: chunk.frames }, { index: 1, frames: 2 });
	assert.deepEqual([...chunk.channels[0]], [0.25, 1]);

	const destination = await fixture.sources.loadAudioBuffer('physical-audio', audioContext());
	assert.deepEqual([...destination.getChannelData(0)], [-1, -0.25, 0.25, 1]);
	assert.equal(loads, 3);

	await fixture.sources.delete('physical-audio');
	assert.ok(await fixture.bindings.get('project-audio', 'source-audio'));
	assert.equal(fixture.releases, 0);
	assert.deepEqual(await fixture.sources.list(), []);
	assert.equal((await fixture.sources.getMetadata('physical-audio'))?.storage, 'linked-audio-original-v1');
});

test('an owned PCM source always wins over a linked original with the same storage key', async () => {
	const body = blobFromBytes(encodeWav([
		Float32Array.of(-1, 1),
	], { float: true, dither: false, sampleRate: 48_000 }));
	let loads = 0;
	const fixture = sourceFixture(body, () => { loads += 1; });
	await fixture.resolver.bind('project-audio', audioSource({ frameCount: 2 }), LOCATOR_ID);
	await fixture.records.putMetadata({
		id: 'physical-audio',
		storage: 'indexeddb-chunks',
		sourceToken: 'owned-token',
		baseSourceId: null,
		path: null,
		committedAt: '2026-08-02T12:00:00.000Z',
		frameCount: 2,
		channelCount: 1,
		sampleRate: 48_000,
		chunkFrames: 2,
		chunkCount: 1,
	});
	await fixture.records.writeChunk({
		key: 'owned-token:0000000000',
		sourceToken: 'owned-token',
		index: 0,
		frames: 2,
		channels: [Float32Array.of(0.125, 0.75)],
	});

	assert.equal((await fixture.sources.getMetadata('physical-audio'))?.sourceToken, 'owned-token');
	assert.deepEqual((await fixture.sources.list()).map(({ id }) => id), ['physical-audio']);
	const chunk = await fixture.sources.chunk('physical-audio', 0);
	assert.deepEqual([...chunk.channels[0]], [0.125, 0.75]);
	assert.equal(loads, 1, 'owned reads must not materialize the linked body');
	const session = await fixture.sources.openReadSession('physical-audio');
	assert.ok(session);
	assert.deepEqual([...((await session.chunk(0)).channels[0])], [0.125, 0.75]);
	await session.release();
	assert.equal(loads, 1, 'owned session admission must not reach the linked fallback');
});

test('canonical source session APIs retain and bulk-release one linked PCM identity', async () => {
	const body = blobFromBytes(encodeWav([
		Float32Array.of(-1, -0.25, 0.25, 1),
	], { float: true, dither: false, sampleRate: 48_000 }));
	let loads = 0;
	const fixture = sourceFixture(body, () => { loads += 1; });
	await fixture.resolver.bind('project-audio', audioSource(), LOCATOR_ID);
	const expected = await fixture.sources.getMetadata('physical-audio');
	const session = await fixture.sources.openReadSession('physical-audio', { expectedSource: expected ?? undefined });
	assert.ok(session);

	assert.deepEqual([...((await session.chunk(1)).channels[0])], [0.25, 1]);
	assert.deepEqual([...((await session.chunk(0)).channels[0])], [-1, -0.25]);
	assert.equal(loads, 2, 'binding and session admission each materialize once');
	await fixture.sources.releaseReadSessions();
	await assert.rejects(session.chunk(0), /released|closed/iu);
});

function sourceFixture(body: Blob, onLoad: () => void) {
	const memory = getMemoryDatabase(`linked-audio-fallback-${Date.now()}-${Math.random()}`);
	const port = { memory, database: async () => null };
	let bindingToken = 0;
	const bindings = new LinkedOriginalRepository(port, {
		now: () => new Date('2026-08-02T10:11:12.345Z'),
		createBindingToken: () => `binding_token_${String(++bindingToken).padStart(8, '0')}`,
	});
	let releases = 0;
	const resolver = new LinkedOriginalResolver(bindings, {
		load(_kind, _locatorId, { expectedRevision }) {
			onLoad();
			return { blob: body, locatorRevision: expectedRevision ?? LOCATOR_REVISION };
		},
		release() { releases += 1; return true; },
	});
	const linked = new LinkedAudioOriginalSourceReader({ bindings, resolver });
	const records = new SourceRecordRepository(port);
	const reader = new SourceReadRepository({
		records,
		fallback: linked,
		pcm: {
			decodeRecord: async (record: Readonly<Record<string, unknown>>) => ({
				index: record.index,
				frames: Number(record.frames),
				channels: record.channels as readonly Float32Array[],
			}),
		} as never,
		opfs: {} as never,
		migrations: { queue: () => undefined } as never,
	});
	const sources = new SourceRepository({
		records,
		reader,
		writer: {} as never,
		migrations: { cancel: async () => undefined } as never,
		media: { deleteAsset: async () => undefined } as never,
		analysis: { delete: async () => undefined } as never,
		opfs: { deletePath: async () => undefined } as never,
	});
	return {
		bindings,
		resolver,
		records,
		sources,
		get releases() { return releases; },
	};
}

function audioSource(overrides: Readonly<Record<string, unknown>> = {}) {
	return Object.freeze({
		kind: 'audio' as const,
		id: 'source-audio',
		storageKey: 'physical-audio',
		mimeType: 'audio/wav',
		frameCount: 4,
		channelCount: 1,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
		sampleFormat: 'float32' as const,
		chunkFrames: 2,
		...overrides,
	});
}

function blobFromBytes(value: Uint8Array): Blob {
	const bytes = new Uint8Array(value.byteLength);
	bytes.set(value);
	return new Blob([bytes], { type: 'audio/wav' });
}

function audioContext(): BaseAudioContext {
	return {
		createBuffer(channelCount: number, frameCount: number) {
			const channels = Array.from({ length: channelCount }, () => new Float32Array(frameCount));
			return {
				copyToChannel(source: Float32Array, channel: number, offset = 0) {
					channels[channel]?.set(source, offset);
				},
				getChannelData(channel: number) {
					const data = channels[channel];
					if (!data) throw new RangeError('AudioBuffer channel is missing.');
					return data;
			},
			};
		},
	} as never;
}
