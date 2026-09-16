/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { AudioSample, BufferSource, BufferTarget, EncodedAudioPacketSource,
	EncodedPacket, EncodedPacketSink, Input, MP4, Mp4OutputFormat, Output } from 'mediabunny';
import { prepareStreamedAudioImport } from '../src/common/editor/browser-streamed-audio-import.ts';
import { aacSourceMetadata } from '../src/common/editor/aac-source-geometry.ts';
import { aacLcM4a48_000Fixture } from './helpers/os-audio-codec-fixtures.ts';

async function withNativeAacFixture(body: (seen: { packets: number; constructors: number; closedData: number; closedDecoders: number; flushes: number }) => Promise<void>): Promise<void> {
	const seen = { packets: 0, constructors: 0, closedData: 0, closedDecoders: 0, flushes: 0 };
	const previous = new Map(['AudioDecoder', 'AudioData', 'EncodedAudioChunk'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
	class FixtureData {
		readonly format = 'f32-planar'; readonly sampleRate = 48_000; readonly numberOfFrames = 1024; readonly numberOfChannels = 2;
		private readonly sample: AudioSample;
		private closed = false;
		constructor(readonly timestamp: number) {
			const firstFrame = Math.round(timestamp / 1e6 * 48_000);
			this.sample = new AudioSample({ format: this.format, sampleRate: this.sampleRate, numberOfChannels: this.numberOfChannels,
				timestamp: timestamp / 1e6, data: Float32Array.from({ length: 2048 }, (_, index) => firstFrame + index % 1024) });
		}
		copyTo(destination: AllowSharedBufferSource, options: AudioDataCopyToOptions): void { this.sample.copyTo(destination, options); }
		close(): void { if (!this.closed) { this.closed = true; this.sample.close(); seen.closedData++; } }
	}
	class FixtureChunk {
		readonly type: EncodedAudioChunkType; readonly timestamp: number; readonly duration: number | null; readonly byteLength: number;
		constructor(init: EncodedAudioChunkInit) { this.type = init.type; this.timestamp = init.timestamp; this.duration = init.duration ?? null; this.byteLength = init.data.byteLength; }
	}
	class FixtureDecoder extends EventTarget {
		readonly decodeQueueSize = 0;
		private closed = false;
		constructor(private readonly init: AudioDecoderInit) { super(); seen.constructors++; }
		static isConfigSupported(config: AudioDecoderConfig) { return Promise.resolve({ supported: config.codec === 'mp4a.40.2', config }); }
		configure(config: AudioDecoderConfig): void { assert.equal(config.sampleRate, 48_000); assert.equal(config.numberOfChannels, 2); }
		decode(chunk: EncodedAudioChunk): void {
			assert.ok(chunk.timestamp >= 0); assert.equal(chunk.duration, null); assert.ok(chunk.byteLength > 0); seen.packets++;
			this.init.output(new FixtureData(chunk.timestamp) as unknown as AudioData);
		}
		flush(): Promise<void> { seen.flushes++; return Promise.resolve(); }
		close(): void { if (!this.closed) { this.closed = true; seen.closedDecoders++; } }
	}
	Object.defineProperty(globalThis, 'AudioData', { configurable: true, writable: true, value: FixtureData });
	Object.defineProperty(globalThis, 'EncodedAudioChunk', { configurable: true, writable: true, value: FixtureChunk });
	Object.defineProperty(globalThis, 'AudioDecoder', { configurable: true, writable: true, value: FixtureDecoder });
	try { await body(seen); } finally {
		for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
	}
}

async function encodedFixture(sourceFrames: number, options: { metadata?: string; packets?: number; offset?: number } = {}): Promise<Blob> {
	const canary = new Input({ source: new BufferSource(aacLcM4a48_000Fixture()), formats: [MP4] });
	try {
		const track = await canary.getPrimaryAudioTrack();
		assert.ok(track);
		const packet = await new EncodedPacketSink(track).getFirstPacket();
		const config = await track.getDecoderConfig();
		assert.ok(packet && config);
		const target = new BufferTarget();
		const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'fragmented' }), target });
		const source = new EncodedAudioPacketSource('aac');
		output.addAudioTrack(source);
		output.setMetadataTags({ raw: { scaf: options.metadata ?? aacSourceMetadata(48_000, 2, sourceFrames) } });
		await output.start();
		for (let index = 0; index < (options.packets ?? Math.ceil(sourceFrames / 1024) + 1); index++) {
			await source.add(new EncodedPacket(packet.data, 'key', (index * 1024 + (index > 0 ? options.offset ?? 0 : 0)) / 48_000, 1024 / 48_000),
				index === 0 ? { decoderConfig: config } : undefined);
		}
		await output.finalize();
		assert.ok(target.buffer);
		return new Blob([target.buffer]);
	} finally { canary.dispose(); }
}

async function negativeEditList(blob: Blob): Promise<Blob> {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	const view = new DataView(bytes.buffer);
	const find = (start: number, end: number, type: string): number => {
		for (let offset = start; offset < end; offset += view.getUint32(offset)) {
			if (String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) === type) return offset;
		}
		throw new Error(`Missing ${type} fixture box`);
	};
	const moov = find(0, bytes.length, 'moov');
	const trak = find(moov + 8, moov + view.getUint32(moov), 'trak');
	const edit = new Uint8Array(36);
	const editView = new DataView(edit.buffer);
	editView.setUint32(0, 36); edit.set(new TextEncoder().encode('edts'), 4);
	editView.setUint32(8, 28); edit.set(new TextEncoder().encode('elst'), 12);
	editView.setUint32(20, 1); editView.setUint32(24, 3072);
	editView.setInt32(28, 1024); editView.setUint32(32, 65536);
	view.setUint32(moov, view.getUint32(moov) + edit.length);
	view.setUint32(trak, view.getUint32(trak) + edit.length);
	return new Blob([bytes.subarray(0, trak + 8), edit, bytes.subarray(trak + 8)]);
}

test('fragmented native AAC import trims its validated priming and partial final frame exactly', async () => withNativeAacFixture(async seen => {
	const prepared = await prepareStreamedAudioImport(await encodedFixture(1030));
	assert.equal(prepared.descriptor.frameCount, 1030);
	assert.equal(prepared.descriptor.sampleRate, 48_000); assert.equal(prepared.descriptor.channelCount, 2);
	assert.equal(seen.packets, 0, 'Source admission cannot allocate decoded PCM'); assert.equal(seen.constructors, 0);
	const values: number[] = [];
	await prepared.stream({ chunkFrames: 127, onChunk(channels) {
		assert.equal(channels.length, 2);
		assert.ok(channels[0]!.length <= 127);
		assert.deepEqual(channels[0], channels[1]);
		values.push(...channels[0]!);
	} });
	assert.deepEqual(values, Array.from({ length: 1030 }, (_, index) => index + 1024));
	assert.equal(seen.packets, 3); assert.equal(seen.closedData, 3); assert.equal(seen.closedDecoders, 1); assert.equal(seen.flushes, 1);
	const noPriming = await prepareStreamedAudioImport(await encodedFixture(1030, { packets: 2 }));
	const unshifted: number[] = [];
	await noPriming.stream({ chunkFrames: 127, onChunk(channels) { unshifted.push(...channels[0]!); } });
	assert.deepEqual(unshifted, Array.from({ length: 1030 }, (_, index) => index));
	assert.equal(seen.packets, 5); assert.equal(seen.closedData, 5); assert.equal(seen.closedDecoders, 2); assert.equal(seen.flushes, 2);
}));

test('AAC source metadata cannot hide excessive encoded delay, forged geometry, or discontinuity', async () => withNativeAacFixture(async seen => {
	for (const options of [
		{ packets: 4 },
		{ metadata: 'SoundscaperAAC1:44100:2:1030' },
		{ metadata: 'SoundscaperAAC1:48000:1:1030' },
		{ metadata: 'SoundscaperAAC1:48000:2:172800001' },
		{ offset: 1024 },
	]) {
		await assert.rejects(prepareStreamedAudioImport(await encodedFixture(1030, options)), /AAC source geometry/u);
		assert.equal(seen.packets, 0); assert.equal(seen.constructors, 0);
	}
}));

test('tagged AAC rejects a negative edited packet timeline rather than trimming priming twice', async () => withNativeAacFixture(async seen => {
	const blob = await negativeEditList(await encodedFixture(1030));
	const input = new Input({ source: new BufferSource(new Uint8Array(await blob.arrayBuffer())), formats: [MP4] });
	try {
		const track = await input.getPrimaryAudioTrack();
		assert.ok(track);
		assert.equal(await track.getFirstTimestamp(), -1024 / 48_000);
	} finally { input.dispose(); }
	await assert.rejects(prepareStreamedAudioImport(blob), /AAC source geometry/u);
	assert.equal(seen.packets, 0); assert.equal(seen.constructors, 0);
}));
