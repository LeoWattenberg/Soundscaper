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
			assert.deepEqual(seen.chunks, Array.from({ length: 6 }, () => 1_024));
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

test('native AAC export gives each WebKit access unit its own complete PCM timing', async () => {
	await withNativeAacFixture(0, async (seen) => {
		const frameCount = 5_123;
		const blob = await encodeFixture(frameCount);
		assert.deepEqual(seen.chunks, Array.from({ length: 6 }, () => 1_024));
		assert.equal(seen.closed, 1);
		await validateStreamedAudioOutput(blob, { format: 'aac-m4a', sampleRate: 48_000, channelCount: 2, frameCount });
	}, { reuseInputTiming: true });
});

test('native streamed AAC cancellation settles while its capability probe is pending', async () => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'AudioEncoder');
	Object.defineProperty(globalThis, 'AudioEncoder', { configurable: true, value: {
		isConfigSupported: () => new Promise(() => undefined),
	} });
	const controller = new AbortController();
	const reason = new DOMException('Cancelled during native AAC probe.', 'AbortError');
	try {
		const encoding = encodeFixture(1_024, undefined, controller.signal);
		controller.abort(reason);
		assert.equal(await outcomeBeforeDeadline(encoding), reason);
	} finally {
		if (previous) Object.defineProperty(globalThis, 'AudioEncoder', previous);
		else Reflect.deleteProperty(globalThis, 'AudioEncoder');
	}
});

test('native streamed AAC cancellation settles and closes an encoder awaiting dequeue', async () => {
	const controller = new AbortController();
	const reason = new DOMException('Cancelled during native AAC dequeue.', 'AbortError');
	await withNativeAacFixture(0, async (seen) => {
		assert.equal(await outcomeBeforeDeadline(encodeFixture(1_024, undefined, controller.signal)), reason);
		assert.equal(seen.closed, 1);
	}, { stallQueue: true, onEncode: () => { queueMicrotask(() => controller.abort(reason)); } });
});

test('native AAC preserves source PCM across arbitrary reader chunks and pads only the final unit', async () => {
	await withNativeAacFixture(0, async (seen) => {
		await encodeFixture(5_123, undefined, undefined, { chunkFrames: 137, pcmFill: 63 });
		assert.equal(seen.data.length, 6);
		for (const bytes of seen.data.slice(0, -1)) assert.ok(bytes.every((byte) => byte === 63));
		const final = seen.data.at(-1)!;
		assert.ok(final.subarray(0, 3 * 8).every((byte) => byte === 63));
		assert.ok(final.subarray(3 * 8).every((byte) => byte === 0));
	}, { reuseInputTiming: true });
});

test('native streamed AAC cancellation during a stuck flush settles and closes resources', async () => {
	const controller = new AbortController();
	const reason = new DOMException('Cancelled during native AAC flush.', 'AbortError');
	await withNativeAacFixture(0, async (seen) => {
		assert.equal(await outcomeBeforeDeadline(encodeFixture(1_024, undefined, controller.signal)), reason);
		assert.equal(seen.closed, 1);
	}, { stallFlush: true, onFlush: () => { queueMicrotask(() => controller.abort(reason)); } });
});

test('native streamed AAC cancellation while mux finalization is blocked settles after native resources close', async () => {
	const controller = new AbortController();
	const reason = new DOMException('Cancelled during AAC mux finalization.', 'AbortError');
	let unblock!: () => void;
	const blocked = new Promise<void>((resolve) => { unblock = resolve; });
	let started!: () => void;
	const writing = new Promise<void>((resolve) => { started = resolve; });
	let writes = 0;
	await withNativeAacFixture(0, async (seen) => {
		const encoding = encodeFixture(1_024, undefined, controller.signal, { async write() {
			if (++writes === 2) { started(); await blocked; }
		} });
		try {
			await writing;
			assert.equal(seen.closed, 1);
			controller.abort(reason);
			assert.equal(await outcomeBeforeDeadline(encoding), reason);
			assert.equal(seen.closed, 1);
		} finally { unblock(); }
	});
	assert.equal(writes, 2);
});

test('native AAC failure while a fragment write is blocked rejects without awaiting storage or writing later fragments', async () => {
	const reason = new Error('Native AAC failed during a blocked fragment write.');
	let unblock!: () => void;
	const blocked = new Promise<void>((resolve) => { unblock = resolve; });
	let started!: () => void;
	const writing = new Promise<void>((resolve) => { started = resolve; });
	let writes = 0;
	await withNativeAacFixture(0, async (seen) => {
		const encoding = encodeFixture(96_000, undefined, undefined, { async write() {
			if (++writes === 2) { started(); await blocked; }
		} });
		try {
			await writing;
			seen.fail(reason);
			assert.equal(await outcomeBeforeDeadline(encoding), reason);
			assert.equal(seen.closed, 1);
		} finally { unblock(); }
	});
	assert.equal(writes, 2);
});

async function outcomeBeforeDeadline(operation: Promise<unknown>): Promise<unknown> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([operation.then(() => 'completed', (error: unknown) => error),
			new Promise((resolve) => { timer = setTimeout(() => resolve('pending after cancellation'), 100); })]);
	} finally { clearTimeout(timer); }
}

async function encodeFixture(frameCount: number, offsets?: readonly number[], signal?: AbortSignal, options: { chunkFrames?: number; pcmFill?: number; write?(bytes: Uint8Array): Promise<void> } = {}): Promise<Blob> {
	const parts: Uint8Array<ArrayBuffer>[] = [];
	await encodeBrowserAacStreamed({
		sampleRate: 48_000, channelCount: 2, bitrate: 192_000, frameCount, metadata: { title: 'Exact source duration' }, ...(signal ? { signal } : {}),
		async readPcm(accept) {
			if (offsets) {
				for (const offset of offsets) await accept(new Uint8Array(2_048 * 8), 2_048, offset);
			} else {
				const chunkFrames = options.chunkFrames ?? 2_048;
				for (let offset = 0; offset < frameCount; offset += chunkFrames) {
					const count = Math.min(chunkFrames, frameCount - offset);
					await accept(new Uint8Array(count * 8).fill(options.pcmFill ?? 0), count, offset);
				}
			}
		},
		async write(bytes) { await options.write?.(bytes); parts.push(Uint8Array.from(bytes)); },
	});
	return new Blob(parts);
}

async function withNativeAacFixture(primingFrames: number, body: (seen: { encoders: number; chunks: number[]; closed: number; data: Uint8Array[]; fail(error: unknown): void }) => Promise<void>, options: { reuseInputTiming?: boolean; stallQueue?: boolean; stallFlush?: boolean; onEncode?: () => void; onFlush?: () => void } = {}): Promise<void> {
	const canary = new Input({ source: new BufferSource(aacLcM4a48_000Fixture()), formats: [MP4] });
	const track = await canary.getPrimaryAudioTrack();
	assert.ok(track);
	const packet = await new EncodedPacketSink(track).getFirstPacket();
	const config = await track.getDecoderConfig();
	assert.ok(packet && config);
	const seen = { encoders: 0, chunks: [] as number[], closed: 0, data: [] as Uint8Array[], fail: (_error: unknown): void => undefined };
	const previous = new Map(['AudioEncoder', 'AudioData', 'EncodedAudioChunk', 'EncodedVideoChunk'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
	class FixtureAudioData {
		readonly numberOfFrames: number;
		readonly timestamp: number;
		constructor(init: { numberOfFrames: number; timestamp: number; data: Uint8Array }) {
			this.numberOfFrames = init.numberOfFrames; this.timestamp = init.timestamp; seen.data.push(Uint8Array.from(init.data));
		}
		close(): void { /* The fixture does not retain PCM. */ }
	}
	class FixtureChunk {
		readonly type = 'key';
		readonly byteLength = packet!.data.length;
		readonly timestamp: number;
		readonly duration: number;
		constructor(timestamp: number, duration = 1_024 / 48_000 * 1e6) { this.timestamp = Math.round(timestamp); this.duration = Math.round(duration); }
		copyTo(destination: Uint8Array): void { destination.set(packet!.data); }
	}
	class FixtureEncoder extends EventTarget {
		get encodeQueueSize(): number { return options.stallQueue ? 4 : 0; }
		state = 'configured';
		private frames = 0;
		private emitted = 0;
		private currentInput: FixtureAudioData | null = null;
		private readonly output: (chunk: unknown, metadata: unknown) => void;
		constructor(init: { output: (chunk: unknown, metadata: unknown) => void; error(error: unknown): void }) {
			super(); this.output = init.output; seen.encoders++; seen.fail = init.error;
		}
		static async isConfigSupported(configuration: unknown): Promise<{ supported: boolean; config: unknown }> { return { supported: true, config: configuration }; }
		configure(): void { /* The exact tuple is covered by the profile probe tests. */ }
		encode(data: FixtureAudioData): void {
			seen.chunks.push(data.numberOfFrames); this.frames += data.numberOfFrames; this.currentInput = data;
			while (this.emitted + 1_024 <= this.frames) this.emit();
			options.onEncode?.();
		}
		async flush(): Promise<void> {
			options.onFlush?.();
			if (options.stallFlush) await new Promise(() => undefined);
			const finalFrames = Math.ceil(this.frames / 1_024) * 1_024 + primingFrames;
			while (this.emitted < finalFrames) this.emit();
		}
		close(): void { this.state = 'closed'; seen.closed++; }
		private emit(): void {
			const input = options.reuseInputTiming ? this.currentInput : null;
			this.output(new FixtureChunk(input?.timestamp ?? this.emitted / 48_000 * 1e6,
				input ? input.numberOfFrames / 48_000 * 1e6 : undefined), this.emitted === 0 ? { decoderConfig: config } : undefined);
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
