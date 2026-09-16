/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { BlobSource, BufferSource, EncodedPacketSink, Input, MP4 } from 'mediabunny';
import { encodeBrowserAacStreamed } from '../src/common/editor/browser-webcodecs-aac-stream.ts';
import { validateStreamedAudioOutput } from '../src/common/editor/browser-streamed-audio-output-validation.ts';
import { aacLcM4a48_000Fixture } from './helpers/os-audio-codec-fixtures.ts';

test('continuous native AAC export binds its exact source frames to the padded MP4 packets', async () => {
	await withNativeAacFixture(1_024, async (seen) => {
		const frameCount = 5_123;
		const blob = await encodeFixture(frameCount);
		const input = new Input({ source: new BlobSource(blob), formats: [MP4] });
		try {
			assert.equal((await input.getMetadataTags()).raw?.scaf, `SoundscaperAAC1:48000:2:${frameCount}`);
			assert.equal(seen.encoders, 1);
			assert.deepEqual(seen.chunks, [2_048, 2_048, 1_027]);
			const track = await input.getPrimaryAudioTrack();
			assert.ok(track);
			let frames = 0;
			for await (const packet of new EncodedPacketSink(track).packets()) frames += Math.round(packet.duration * 48_000);
			assert.equal(frames, 7_168);
			await validateStreamedAudioOutput(blob, { format: 'aac-m4a', sampleRate: 48_000, channelCount: 2, frameCount });
			await assert.rejects(validateStreamedAudioOutput(blob, { format: 'aac-m4a', sampleRate: 48_000, channelCount: 2, frameCount: frameCount - 1 }), /source|duration|geometry/iu);
		} finally { input.dispose(); }
	});
});

test('native AAC export refuses an encoder whose padding is outside the qualified profile', async () => {
	await withNativeAacFixture(3_072, async () => {
		await assert.rejects(encodeFixture(5_123), /padding|geometry|priming/iu);
	});
});

test('native AAC export refuses missing, overlapping, and excess source PCM before publication', async () => {
	await withNativeAacFixture(1_024, async () => {
		for (const offsets of [[0], [0, 0], [0, 2_048, 4_096]] as const) {
			await assert.rejects(encodeFixture(4_096, offsets), /PCM|source|geometry/iu);
		}
	});
});

async function encodeFixture(frameCount: number, offsets?: readonly number[]): Promise<Blob> {
	const parts: Uint8Array<ArrayBuffer>[] = [];
	await encodeBrowserAacStreamed({
		sampleRate: 48_000, channelCount: 2, bitrate: 192_000, frameCount, metadata: { title: 'Exact source duration' },
		async readPcm(accept) {
			if (offsets) {
				for (const offset of offsets) await accept(new Uint8Array(2_048 * 8), 2_048, offset);
			} else {
				for (let offset = 0; offset < frameCount; offset += 2_048) {
					const count = Math.min(2_048, frameCount - offset);
					await accept(new Uint8Array(count * 8), count, offset);
				}
			}
		},
		async write(bytes) { parts.push(Uint8Array.from(bytes)); },
	});
	return new Blob(parts);
}

async function withNativeAacFixture(primingFrames: number, body: (seen: { encoders: number; chunks: number[] }) => Promise<void>): Promise<void> {
	const canary = new Input({ source: new BufferSource(aacLcM4a48_000Fixture()), formats: [MP4] });
	const track = await canary.getPrimaryAudioTrack();
	assert.ok(track);
	const packet = await new EncodedPacketSink(track).getFirstPacket();
	const config = await track.getDecoderConfig();
	assert.ok(packet && config);
	const seen = { encoders: 0, chunks: [] as number[] };
	const previous = new Map(['AudioEncoder', 'AudioData', 'EncodedAudioChunk', 'EncodedVideoChunk'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
	class FixtureAudioData {
		readonly numberOfFrames: number;
		constructor(init: { numberOfFrames: number }) { this.numberOfFrames = init.numberOfFrames; }
		close(): void { /* The fixture does not retain PCM. */ }
	}
	class FixtureChunk {
		readonly type = 'key';
		readonly duration = 1_024 / 48_000 * 1e6;
		readonly byteLength = packet!.data.length;
		constructor(readonly timestamp: number) {}
		copyTo(destination: Uint8Array): void { destination.set(packet!.data); }
	}
	class FixtureEncoder {
		readonly encodeQueueSize = 0;
		state = 'configured';
		private frames = 0;
		private emitted = 0;
		private readonly output: (chunk: unknown, metadata: unknown) => void;
		constructor(init: { output: (chunk: unknown, metadata: unknown) => void }) { this.output = init.output; seen.encoders++; }
		static async isConfigSupported(configuration: unknown): Promise<{ supported: boolean; config: unknown }> { return { supported: true, config: configuration }; }
		configure(): void { /* The exact tuple is covered by the profile probe tests. */ }
		encode(data: FixtureAudioData): void {
			seen.chunks.push(data.numberOfFrames); this.frames += data.numberOfFrames;
			while (this.emitted + 1_024 <= this.frames) this.emit();
		}
		async flush(): Promise<void> {
			const finalFrames = Math.ceil(this.frames / 1_024) * 1_024 + primingFrames;
			while (this.emitted < finalFrames) this.emit();
		}
		close(): void { this.state = 'closed'; }
		private emit(): void {
			this.output(new FixtureChunk(this.emitted / 48_000 * 1e6), this.emitted === 0 ? { decoderConfig: config } : undefined);
			this.emitted += 1_024;
		}
	}
	Object.defineProperty(globalThis, 'AudioData', { configurable: true, value: FixtureAudioData });
	Object.defineProperty(globalThis, 'AudioEncoder', { configurable: true, value: FixtureEncoder });
	Object.defineProperty(globalThis, 'EncodedAudioChunk', { configurable: true, value: FixtureChunk });
	Object.defineProperty(globalThis, 'EncodedVideoChunk', { configurable: true, value: class {} });
	try { await body(seen); } finally {
		canary.dispose();
		for (const [name, descriptor] of previous) {
			if (descriptor) Object.defineProperty(globalThis, name, descriptor);
			else Reflect.deleteProperty(globalThis, name);
		}
	}
}
