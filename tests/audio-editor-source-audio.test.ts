/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	SOURCE_CHUNK_FRAMES,
	audioBufferChannels,
	bufferFromChannels,
	canonicalizeBuffer,
	createAudioBuffer,
	createCoalescingSourceWriter,
	createStoredChunkProvider,
	isStreamableStoredSource,
	normalizeByteLimit,
	readStoredAudioBuffer,
	resampleBuffer,
	resampleChannelsWindowedSinc,
	scaleClipEnvelope,
	serializeAudacityNoiseProfile,
	sourceAudioBufferBytes,
	sourcePcmBytes,
	writeBuffer,
	type AudioBufferLike,
} from '../src/common/editor/controller/source-audio.ts';

const copy = {
	decodedAudioEmpty: 'Audio is empty.',
	decodedChannelLengthsMismatch: 'Channel lengths differ.',
	audacityProjectTooLong: 'Project is too long.',
	audioBufferUnsupported: 'AudioBuffer is unavailable.',
};

function bufferFixture(
	channels: readonly Float32Array[],
	sampleRate = 48_000,
	copyToChannel = true,
): AudioBufferLike {
	const stored = channels.map((channel) => channel.slice());
	return {
		length: stored[0]?.length ?? 0,
		numberOfChannels: stored.length,
		sampleRate,
		getChannelData: (channel) => stored[channel] ?? new Float32Array(),
		...(copyToChannel ? {
			copyToChannel(source: Float32Array, channel: number, offset = 0) {
				stored[channel]?.set(source, offset);
			},
		} : {}),
	};
}

function audioContextFixture(copyToChannel = true) {
	return {
		createBuffer(channelCount: number, length: number, sampleRate: number) {
			return bufferFixture(
				Array.from({ length: channelCount }, () => new Float32Array(length)),
				sampleRate,
				copyToChannel,
			);
		},
	};
}

test('buffer writing chunks planar PCM and checks cancellation at both boundaries', async () => {
	const first = Float32Array.from({ length: SOURCE_CHUNK_FRAMES + 2 }, (_, index) => index % 7);
	const second = Float32Array.from({ length: SOURCE_CHUNK_FRAMES + 2 }, (_, index) => -(index % 5));
	const chunks: Float32Array[][] = [];
	await writeBuffer({
		write(channels) { chunks.push(channels); },
	}, bufferFixture([first, second]));
	assert.deepEqual(chunks.map((channels) => channels[0]?.length), [SOURCE_CHUNK_FRAMES, 2]);
	assert.equal(chunks[1]?.[1]?.[1], -2);

	const aborted = new AbortController();
	aborted.abort();
	await assert.rejects(writeBuffer({ write: () => undefined }, bufferFixture([Float32Array.of(1)]), aborted.signal), {
		name: 'AbortError',
	});
});

test('coalescing writers expose geometry, finalize once, and forward aborts', async () => {
	assert.throws(() => createCoalescingSourceWriter({} as never), /writable PCM source/u);
	const writes: Float32Array[][] = [];
	const commits: Array<Record<string, unknown> | undefined> = [];
	let aborts = 0;
	const writer = createCoalescingSourceWriter({
		framesWritten: 10,
		write: async (channels) => { writes.push(channels); },
		commit: async (metadata) => { commits.push(metadata); return 'committed'; },
		abort: () => { aborts += 1; },
	});
	assert.equal(Object.isFrozen(writer), true);
	await writer.write([Float32Array.of(1, 2, 3)]);
	assert.equal(writer.channelCount, 1);
	assert.equal(writer.framesWritten, 10);
	const firstCommit = writer.commit({ sampleRate: 48_000 });
	assert.equal(writer.commit(), firstCommit);
	assert.equal(await firstCommit, 'committed');
	assert.equal(writes.length, 1);
	assert.deepEqual(commits, [{ sampleRate: 48_000, chunkFrames: SOURCE_CHUNK_FRAMES }]);

	const aborted = createCoalescingSourceWriter({
		write: () => undefined,
		commit: () => undefined,
		abort: () => { aborts += 1; return 'aborted'; },
	});
	assert.equal(aborted.abort(new Error('stop')), 'aborted');
	assert.equal(aborts, 1);
});

test('stored buffers and chunk providers use storage identities and validated geometry', async () => {
	const loaded = bufferFixture([Float32Array.of(1, 2)]);
	const source = { id: 'source', storageKey: 'stored', frameCount: 8, channelCount: 1, sampleRate: 48_000, chunkFrames: 4 };
	const loadCalls: string[] = [];
	const store = {
		async loadSourceAudioBuffer(sourceId: string) {
			loadCalls.push(sourceId);
			return loaded;
		},
	};
	assert.equal(await readStoredAudioBuffer(store, source, null), null);
	assert.equal(await readStoredAudioBuffer(store, source, audioContextFixture()), loaded);
	assert.deepEqual(loadCalls, ['stored']);

	const metadata = { id: 'source', frameLength: 8, channelCount: 1, sampleRate: 48_000, chunkFrames: 4, chunkCount: 2 };
	assert.equal(isStreamableStoredSource(source, metadata), true);
	const invalidMetadata: unknown[] = [
		null,
		{ ...metadata, id: 1 },
		{ ...metadata, chunkFrames: 0 },
		{ ...metadata, frameLength: 7 },
		{ ...metadata, sampleRate: 44_100 },
		{ ...metadata, chunkCount: 1 },
	];
	for (const candidate of invalidMetadata) {
		assert.equal(isStreamableStoredSource(source, candidate as typeof metadata | null), false);
	}
	assert.throws(() => createStoredChunkProvider({} as never, source, metadata), /demand-load/u);
	const calls: unknown[][] = [];
	const provider = createStoredChunkProvider({
		readSourceChunk: (...args: unknown[]) => { calls.push(args); return 'chunk'; },
	}, { ...source, storageKey: '' }, metadata);
	assert.equal(Object.isFrozen(provider), true);
	assert.equal(provider.readStorageChunk(1), 'chunk');
	assert.deepEqual(calls, [['source', 1, {}]]);
});

test('memory byte helpers reject invalid and overflowing geometry', () => {
	assert.equal(sourceAudioBufferBytes({ length: 2, numberOfChannels: 2 }), 16);
	assert.equal(sourceAudioBufferBytes({ length: -1, numberOfChannels: 2 }), Number.POSITIVE_INFINITY);
	assert.equal(sourceAudioBufferBytes({ length: Number.MAX_SAFE_INTEGER, numberOfChannels: 2 }), Number.POSITIVE_INFINITY);
	assert.equal(sourcePcmBytes({ frameCount: 2, channelCount: 2 }), 16);
	assert.equal(sourcePcmBytes({ frameCount: 2, channelCount: Number.NaN }), Number.POSITIVE_INFINITY);
	assert.equal(normalizeByteLimit(undefined, 32), 32);
	assert.equal(normalizeByteLimit('64', 32), 64);
	assert.throws(() => normalizeByteLimit(Number.MAX_VALUE, 32), /memory limit/u);
});

test('canonicalization preserves simple buffers and downmixes multichannel input', async () => {
	const mono = bufferFixture([Float32Array.of(0.25, 0.5)]);
	assert.equal(await canonicalizeBuffer(mono, audioContextFixture(), 48_000, copy), mono);
	await assert.rejects(canonicalizeBuffer(bufferFixture([]), audioContextFixture(), 48_000, copy), /empty/u);

	const surround = bufferFixture([
		Float32Array.of(1, 0),
		Float32Array.of(0, 1),
		Float32Array.of(0.5, 0.5),
		Float32Array.of(-0.5, -0.5),
	], 48_000);
	const downmixed = await canonicalizeBuffer(surround, audioContextFixture(), null, copy);
	assert.equal(downmixed.numberOfChannels, 2);
	assert.deepEqual(Array.from(downmixed.getChannelData(0)), [0.625, 0.125]);
	assert.deepEqual(Array.from(downmixed.getChannelData(1)), [-0.125, 0.375]);

	const resampled = await canonicalizeBuffer(surround, audioContextFixture(), 24_000, copy);
	assert.equal(resampled.sampleRate, 24_000);
	assert.equal(resampled.length, 1);
});

test('channel buffers validate shape and support both copy APIs', async () => {
	await assert.rejects(bufferFromChannels([], 48_000, audioContextFixture(), copy), /empty/u);
	await assert.rejects(bufferFromChannels(
		[Float32Array.of(1, 2), Float32Array.of(1)],
		48_000,
		audioContextFixture(),
		copy,
	), /lengths differ/u);
	const copied = await bufferFromChannels(
		[Float32Array.of(1, 2), Float32Array.of(3, 4)],
		48_000,
		audioContextFixture(),
		copy,
	);
	assert.deepEqual(audioBufferChannels(copied).map((channel) => Array.from(channel)), [[1, 2], [3, 4]]);
	const assigned = await bufferFromChannels(
		[Float32Array.of(5, 6)],
		48_000,
		audioContextFixture(false),
		copy,
	);
	assert.deepEqual(Array.from(assigned.getChannelData(0)), [5, 6]);
});

test('ordinary resampling preserves requested rates and exact frame counts', async () => {
	const channels = [Float32Array.of(0, 0.25, 0.5, 0.75)];
	const input = bufferFixture(channels, 48_000);
	assert.equal(await resampleBuffer(input, 48_000, audioContextFixture(), copy), input);
	const halfRate = await resampleBuffer(input, 24_000, audioContextFixture(), copy);
	assert.equal(halfRate.length, 2);
	assert.equal(halfRate.sampleRate, 24_000);
	assert.deepEqual(resampleChannelsWindowedSinc(channels, 48_000, 48_000, 4), channels);
});

test('audio buffer creation uses context, global constructors, temporary contexts, and clear errors', async () => {
	const fromContext = await createAudioBuffer(1, 2, 48_000, audioContextFixture(), copy);
	assert.equal(fromContext.length, 2);
	const audioBufferDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'AudioBuffer');
	const audioContextDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
	const webkitDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'webkitAudioContext');
	try {
		class TestAudioBuffer {
			readonly length: number;
			readonly numberOfChannels: number;
			readonly sampleRate: number;
			readonly #channels: Float32Array[];

			constructor(options: { numberOfChannels: number; length: number; sampleRate: number }) {
				this.length = options.length;
				this.numberOfChannels = options.numberOfChannels;
				this.sampleRate = options.sampleRate;
				this.#channels = Array.from({ length: options.numberOfChannels }, () => new Float32Array(options.length));
			}

			getChannelData(channel: number): Float32Array {
				return this.#channels[channel] ?? new Float32Array();
			}
		}
		Object.defineProperty(globalThis, 'AudioBuffer', { configurable: true, value: TestAudioBuffer });
		const fromGlobal = await createAudioBuffer(2, 3, 44_100, null, copy);
		assert.equal(fromGlobal.numberOfChannels, 2);

		Reflect.deleteProperty(globalThis, 'AudioBuffer');
		let closes = 0;
		class TestAudioContext {
			createBuffer(channelCount: number, length: number, sampleRate: number): AudioBufferLike {
				return bufferFixture(Array.from({ length: channelCount }, () => new Float32Array(length)), sampleRate);
			}

			async close(): Promise<void> {
				closes += 1;
			}
		}
		Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: TestAudioContext });
		const temporary = await createAudioBuffer(1, 4, 32_000, null, copy);
		assert.equal(temporary.sampleRate, 32_000);
		assert.equal(closes, 1);

		Reflect.deleteProperty(globalThis, 'AudioContext');
		Reflect.deleteProperty(globalThis, 'webkitAudioContext');
		await assert.rejects(createAudioBuffer(1, 1, 48_000, null, copy), /unavailable/u);
	} finally {
		restoreProperty('AudioBuffer', audioBufferDescriptor);
		restoreProperty('AudioContext', audioContextDescriptor);
		restoreProperty('webkitAudioContext', webkitDescriptor);
	}
});

test('clip envelopes and noise profiles normalize optional data', () => {
	assert.deepEqual(scaleClipEnvelope({ durationFrames: 0 }, 20), []);
	assert.deepEqual(scaleClipEnvelope({
		durationFrames: 10,
		envelope: [{ frame: -1 }, { frame: 5 }, { frame: 12 }],
	}, 20), [{ frame: 0 }, { frame: 10 }, { frame: 20 }]);
	assert.equal(serializeAudacityNoiseProfile(null), null);
	assert.deepEqual(serializeAudacityNoiseProfile({}), { meanPowers: [] });
});

function restoreProperty(name: string, descriptor: PropertyDescriptor | undefined): void {
	if (descriptor) Object.defineProperty(globalThis, name, descriptor);
	else Reflect.deleteProperty(globalThis, name);
}
