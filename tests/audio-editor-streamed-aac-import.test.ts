/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { AudioSample, BufferSource, BufferTarget, CustomAudioDecoder, EncodedAudioPacketSource,
	EncodedPacket, EncodedPacketSink, Input, MP4, Mp4OutputFormat, Output, registerDecoder,
	type AudioCodec } from 'mediabunny';
import { prepareStreamedAudioImport } from '../src/common/editor/browser-streamed-audio-import.ts';
import { aacSourceMetadata } from '../src/common/editor/aac-source-geometry.ts';
import { aacLcM4a48_000Fixture } from './helpers/os-audio-codec-fixtures.ts';

let decodedPackets = 0;
class FixtureAacDecoder extends CustomAudioDecoder {
	static override supports(codec: AudioCodec): boolean { return codec === 'aac'; }
	override init(): void {}
	override decode(packet: EncodedPacket): void {
		decodedPackets++;
		const firstFrame = Math.round(packet.timestamp * 48_000);
		this.onSample(new AudioSample({ format: 'f32-planar', sampleRate: 48_000, numberOfChannels: 2,
			timestamp: packet.timestamp, data: Float32Array.from({ length: 2048 }, (_value, index) => firstFrame + index % 1024) }));
	}
	override flush(): void {}
	override close(): void {}
}
registerDecoder(FixtureAacDecoder);

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

test('fragmented AAC import trims its validated priming and partial final frame exactly', async () => {
	decodedPackets = 0;
	const prepared = await prepareStreamedAudioImport(await encodedFixture(1025));
	assert.equal(prepared.descriptor.frameCount, 1025);
	assert.equal(decodedPackets, 0, 'Source admission cannot allocate decoded PCM');
	const values: number[] = [];
	await prepared.stream({ chunkFrames: 127, onChunk(channels) {
		assert.equal(channels.length, 2);
		assert.ok(channels[0]!.length <= 127);
		assert.deepEqual(channels[0], channels[1]);
		values.push(...channels[0]!);
	} });
	assert.deepEqual(values, Array.from({ length: 1025 }, (_value, index) => index + 1024));
	const noPriming = await prepareStreamedAudioImport(await encodedFixture(1025, { packets: 2 }));
	const unshifted: number[] = [];
	await noPriming.stream({ chunkFrames: 127, onChunk(channels) { unshifted.push(...channels[0]!); } });
	assert.deepEqual(unshifted, Array.from({ length: 1025 }, (_value, index) => index));
});

test('AAC source metadata cannot hide excessive encoded delay, forged geometry, or discontinuity', async () => {
	for (const options of [
		{ packets: 4 },
		{ metadata: 'SoundscaperAAC1:44100:2:1025' },
		{ metadata: 'SoundscaperAAC1:48000:1:1025' },
		{ metadata: 'SoundscaperAAC1:48000:2:172800001' },
		{ offset: 1024 },
	]) {
		decodedPackets = 0;
		await assert.rejects(prepareStreamedAudioImport(await encodedFixture(1025, options)), /AAC source geometry/u);
		assert.equal(decodedPackets, 0);
	}
});

test('tagged AAC rejects a negative edited packet timeline rather than trimming priming twice', async () => {
	const blob = await negativeEditList(await encodedFixture(1025));
	const input = new Input({ source: new BufferSource(new Uint8Array(await blob.arrayBuffer())), formats: [MP4] });
	try {
		const track = await input.getPrimaryAudioTrack();
		assert.ok(track);
		assert.equal(await track.getFirstTimestamp(), -1024 / 48_000);
	} finally { input.dispose(); }
	decodedPackets = 0;
	await assert.rejects(prepareStreamedAudioImport(blob), /AAC source geometry/u);
	assert.equal(decodedPackets, 0);
});
