/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { decodeStandaloneAudioForImport } from '../src/common/editor/controller/standalone-audio-import-decoder.ts';

interface DecodedStub {
	readonly sampleRate: number;
	readonly length: number;
}

class RealtimeContextStub {
	sampleRate = 48_000;
	state = 'running';
	destination = {};
	decoded: ArrayBuffer[] = [];

	async decodeAudioData(encoded: ArrayBuffer): Promise<DecodedStub> {
		this.decoded.push(encoded);
		return { sampleRate: this.sampleRate, length: 8 };
	}

	async close(): Promise<void> { this.state = 'closed'; }
}

class OfflineContextStub {
	static readonly constructedRates: number[] = [];
	static instances: OfflineContextStub[] = [];
	static rejectDecode = false;
	static refusedRates = new Set<number>();

	sampleRate: number;
	decoded: ArrayBuffer[] = [];

	constructor(channels: number | Readonly<{ sampleRate: number }>, _length?: number, sampleRate?: number) {
		// The engine tries the positional constructor before the options form.
		const rate = typeof channels === 'object' ? channels.sampleRate : sampleRate!;
		if (OfflineContextStub.refusedRates.has(rate)) {
			throw new RangeError(`This browser cannot render at ${rate} Hz.`);
		}
		OfflineContextStub.constructedRates.push(rate);
		OfflineContextStub.instances.push(this);
		this.sampleRate = rate;
	}

	async decodeAudioData(encoded: ArrayBuffer): Promise<DecodedStub> {
		this.decoded.push(encoded);
		if (OfflineContextStub.rejectDecode) throw new Error('This offline context cannot decode audio.');
		return { sampleRate: this.sampleRate, length: 8 };
	}
}

function createStubbedEngine({ offline = true } = {}) {
	OfflineContextStub.constructedRates.length = 0;
	OfflineContextStub.instances = [];
	OfflineContextStub.rejectDecode = false;
	OfflineContextStub.refusedRates = new Set();
	const realtime = new RealtimeContextStub();
	const engine = createAudioEditorEngine({
		audioContextFactory: (() => realtime) as never,
		offlineAudioContextFactory: (offline ? OfflineContextStub : null) as never,
	});
	return { engine, realtime };
}

function encodedBytes(): ArrayBuffer {
	const bytes = new ArrayBuffer(16);
	new Uint8Array(bytes).set(Uint8Array.from({ length: 16 }, (_unused, index) => index));
	return bytes;
}

test('a native decode pinned to the source rate never reaches the output device rate', async () => {
	const { engine, realtime } = createStubbedEngine();
	const decoded = await engine.decodeAudioData(encodedBytes(), { sampleRate: 44_100 });
	assert.equal(decoded.sampleRate, 44_100, 'the import keeps the rate the file was authored at');
	assert.deepEqual(OfflineContextStub.constructedRates, [44_100]);
	assert.equal(realtime.decoded.length, 0, 'the realtime context would have resampled to 48 kHz');
	await engine.dispose();
});

test('a native decode skips the offline hop when it would change nothing', async () => {
	const { engine, realtime } = createStubbedEngine();
	const matching = await engine.decodeAudioData(encodedBytes(), { sampleRate: 48_000 });
	assert.equal(matching.sampleRate, 48_000);
	assert.deepEqual(OfflineContextStub.constructedRates, [], 'the realtime context already runs at the source rate');
	assert.equal(realtime.decoded.length, 1);

	// The video import path conforms its audio to the project rate itself and
	// passes no source rate, so it must keep decoding as it always did.
	await engine.decodeAudioData(encodedBytes());
	assert.deepEqual(OfflineContextStub.constructedRates, []);
	assert.equal(realtime.decoded.length, 2);

	for (const unusable of [null, Number.NaN, 0, 1_000, 1_000_000]) {
		await engine.decodeAudioData(encodedBytes(), { sampleRate: unusable });
	}
	assert.deepEqual(OfflineContextStub.constructedRates, [], 'an implausible rate is not pinned');
	await engine.dispose();
});

test('a browser that cannot decode at the source rate still imports the file', async () => {
	const withoutOffline = createStubbedEngine({ offline: false });
	const unpinned = await withoutOffline.engine.decodeAudioData(encodedBytes(), { sampleRate: 44_100 });
	assert.equal(unpinned.sampleRate, 48_000);
	assert.equal(withoutOffline.realtime.decoded.length, 1);
	await withoutOffline.engine.dispose();

	const refusing = createStubbedEngine();
	OfflineContextStub.refusedRates = new Set([44_100]);
	const refused = await refusing.engine.decodeAudioData(encodedBytes(), { sampleRate: 44_100 });
	assert.equal(refused.sampleRate, 48_000);
	assert.equal(refusing.realtime.decoded.length, 1);
	await refusing.engine.dispose();

	const rejecting = createStubbedEngine();
	OfflineContextStub.rejectDecode = true;
	const encoded = encodedBytes();
	const fallback = await rejecting.engine.decodeAudioData(encoded, { sampleRate: 44_100 });
	assert.equal(fallback.sampleRate, 48_000);
	assert.equal(rejecting.realtime.decoded.length, 1);
	// `decodeAudioData` detaches what it is handed, so a failed pinned decode
	// must not have consumed the bytes the fallback still needs.
	assert.equal(rejecting.realtime.decoded[0], encoded, 'the fallback decoded the original bytes');
	assert.notEqual(
		OfflineContextStub.instances[0]!.decoded[0], encoded,
		'the pinned attempt decoded a copy',
	);
	await rejecting.engine.dispose();
});

test('standalone import pins the native decode to the container rate a decoder emits', async () => {
	const pinnedRates: (number | null)[] = [];
	const result = await decodeStandaloneAudioForImport({
		file: { arrayBuffer: async () => encodedBytes() },
		codecRuntime: {},
		sampleRate: 48_000,
		getAudioContext: async () => 'context',
		decodeWithWebAudio: async (_encoded, decodedSampleRate) => {
			pinnedRates.push(decodedSampleRate);
			return { sampleRate: decodedSampleRate ?? 48_000 };
		},
		decodeWithCodec: async () => { throw new Error('the codec runtime is not needed here.'); },
		bufferFromChannels: async () => { throw new Error('the codec runtime is not needed here.'); },
		inspectEncodedSampleRate: () => 22_050,
		inspectDecodedSampleRate: () => 44_100,
	});
	assert.deepEqual(pinnedRates, [44_100]);
	assert.equal(result.decoded.sampleRate, 44_100);
	assert.equal(result.originalSampleRate, 22_050, 'the declared rate stays the reported source metadata');
});

test('standalone import leaves an ambiguous container to decode unpinned', async () => {
	const pinnedRates: (number | null)[] = [];
	const result = await decodeStandaloneAudioForImport({
		file: { arrayBuffer: async () => encodedBytes() },
		codecRuntime: {},
		sampleRate: 48_000,
		getAudioContext: async () => 'context',
		decodeWithWebAudio: async (_encoded, decodedSampleRate) => {
			pinnedRates.push(decodedSampleRate);
			return { sampleRate: 48_000 };
		},
		decodeWithCodec: async () => { throw new Error('the codec runtime is not needed here.'); },
		bufferFromChannels: async () => { throw new Error('the codec runtime is not needed here.'); },
		inspectEncodedSampleRate: () => 24_000,
		inspectDecodedSampleRate: () => null,
	});
	assert.deepEqual(pinnedRates, [null]);
	assert.equal(result.decoded.sampleRate, 48_000);
	assert.equal(result.originalSampleRate, 24_000);
});

test('a native decode failure still falls back to the codec runtime', async () => {
	const result = await decodeStandaloneAudioForImport({
		file: { arrayBuffer: async () => encodedBytes() },
		codecRuntime: {},
		sampleRate: 48_000,
		getAudioContext: async () => 'context',
		decodeWithWebAudio: async () => { throw new Error('This browser cannot decode the file.'); },
		decodeWithCodec: async () => ({ channels: [Float32Array.of(0.5)], sampleRate: 96_000 }),
		bufferFromChannels: async (_channels, sampleRate) => ({ sampleRate }),
		inspectEncodedSampleRate: () => 96_000,
		inspectDecodedSampleRate: () => 96_000,
	});
	assert.equal(result.decoded.sampleRate, 96_000);
	assert.equal(result.originalSampleRate, 96_000);
});
