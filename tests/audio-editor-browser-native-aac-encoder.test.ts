/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { awaitNativeAacAbort, createNativeAacEncoder, NATIVE_AAC_MAXIMUM_PENDING_BYTES, NATIVE_AAC_MAXIMUM_PENDING_PACKETS, type NativeAacAudioData, type NativeAacChunk, type NativeAacEncoder, type NativeAacResources } from '../src/common/editor/browser-native-aac-encoder.ts';

const geometry = { sampleRate: 48_000, channelCount: 2, bitrate: 192_000 };
const decoderConfig = { codec: 'mp4a.40.2', sampleRate: 48_000, numberOfChannels: 2, description: Uint8Array.of(17, 144) };
const unit = (): Uint8Array<ArrayBuffer> => new Uint8Array(1_024 * 8);
function deferred<Value = void>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<Value>((accept, refuse) => { resolve = accept; reject = refuse; });
	return { promise, resolve, reject };
}
function harness() {
	let callbacks!: Parameters<NativeAacResources['createEncoder']>[0];
	const seen = { created: 0, closed: 0, audioCreated: 0, audioClosed: 0, encoded: 0, copied: 0, configuration: undefined as unknown, listeners: 0 };
	let onEncode: (data: NativeAacAudioData) => void = () => undefined;
	let onConfigure: () => void = () => undefined;
	let onCreate: () => void = () => undefined;
	let flush: () => Promise<void> = () => Promise.resolve();
	class Encoder extends EventTarget implements NativeAacEncoder {
		state = 'unconfigured';
		encodeQueueSize = 0;
		configure(configuration: unknown): void { seen.configuration = configuration; this.state = 'configured'; onConfigure(); }
		encode(data: NativeAacAudioData): void { seen.encoded++; onEncode(data); }
		flush(): Promise<void> { return flush(); }
		close(): void { seen.closed++; this.state = 'closed'; }
		override addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean): void {
			if (type === 'dequeue') seen.listeners++;
			super.addEventListener(type, callback, options);
		}
		override removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean): void {
			if (type === 'dequeue') seen.listeners--;
			super.removeEventListener(type, callback, options);
		}
	}
	const encoder = new Encoder();
	const resources: NativeAacResources = {
		createEncoder(init) { callbacks = init; seen.created++; onCreate(); return encoder; },
		createAudioData() {
			seen.audioCreated++;
			let closed = false;
			return { close() { assert.equal(closed, false); closed = true; seen.audioClosed++; } };
		},
	};
	const emit = (frames: number, options: { duration?: number | null; timestamp?: number; metadata?: EncodedAudioChunkMetadata; bytes?: number } = {}): void => {
		const chunk: NativeAacChunk = {
			byteLength: options.bytes ?? 2, type: 'key', timestamp: options.timestamp ?? Math.round(frames / 48_000 * 1e6),
			duration: options.duration === undefined ? Math.round(1_024 / 48_000 * 1e6) : options.duration,
			copyTo(target) { seen.copied++; target.fill(1); },
		};
		callbacks.output(chunk, options.metadata ?? (frames === 0 ? { decoderConfig } : undefined));
	};
	return { resources, encoder, seen, emit, error: (error: unknown) => callbacks.error(error),
		setEncode: (callback: typeof onEncode) => { onEncode = callback; }, setConfigure: (callback: typeof onConfigure) => { onConfigure = callback; },
		setCreate: (callback: typeof onCreate) => { onCreate = callback; }, setFlush: (callback: typeof flush) => { flush = callback; } };
}

test('native AAC owns one persistent exact raw AAC-LC encoder and closes each audio resource once', async () => {
	const fixture = harness();
	const packets: number[] = [];
	fixture.setEncode(() => fixture.emit(packets.length * 1_024));
	const encoder = createNativeAacEncoder({ ...geometry, async acceptPacket(packet) { packets.push(packet.timestamp * 48_000); } }, fixture.resources);
	try {
		await encoder.add(unit(), 0);
		await encoder.add(unit(), 1_024);
		assert.equal(await encoder.flush(), 2_048);
		assert.deepEqual(packets, [0, 1_024]);
		assert.deepEqual(fixture.seen.configuration, { codec: 'mp4a.40.2', sampleRate: 48_000, numberOfChannels: 2, bitrate: 192_000, aac: { format: 'aac' } });
	} finally { encoder.dispose(); encoder.dispose(); }
	assert.deepEqual([fixture.seen.created, fixture.seen.closed, fixture.seen.audioCreated, fixture.seen.audioClosed], [1, 1, 2, 2]);
});

test('native AAC cancellation before construction creates no native resources', () => {
	const fixture = harness();
	const controller = new AbortController();
	const reason = new DOMException('Cancelled before native AAC start.', 'AbortError');
	controller.abort(reason);
	assert.throws(() => createNativeAacEncoder({ ...geometry, signal: controller.signal, async acceptPacket() {} }, fixture.resources), (error) => error === reason);
	assert.equal(fixture.seen.created, 0);
});

test('native AAC cancellation during injected construction closes the returned native resource', () => {
	const fixture = harness();
	const controller = new AbortController();
	const reason = new DOMException('Cancelled during native AAC start.', 'AbortError');
	fixture.setCreate(() => controller.abort(reason));
	assert.throws(() => createNativeAacEncoder({ ...geometry, signal: controller.signal, async acceptPacket() {} }, fixture.resources), (error) => error === reason);
	assert.equal(fixture.seen.closed, 1);
});

test('native AAC cancellation while awaiting dequeue closes resources and removes its wait listener', async () => {
	const fixture = harness();
	const controller = new AbortController();
	const reason = new DOMException('Cancelled native AAC dequeue.', 'AbortError');
	fixture.encoder.encodeQueueSize = 4;
	const encoder = createNativeAacEncoder({ ...geometry, signal: controller.signal, async acceptPacket() {} }, fixture.resources);
	const adding = encoder.add(unit(), 0);
	await Promise.resolve(); await Promise.resolve();
	controller.abort(reason);
	await assert.rejects(adding, (error) => error === reason);
	encoder.dispose();
	assert.deepEqual([fixture.seen.closed, fixture.seen.audioCreated, fixture.seen.audioClosed, fixture.seen.listeners], [1, 1, 1, 0]);
});

test('native AAC cancellation directly closes an encoder whose native flush never settles', async () => {
	const fixture = harness();
	fixture.setFlush(() => new Promise(() => undefined));
	const controller = new AbortController();
	const reason = new DOMException('Cancelled stuck native AAC flush.', 'AbortError');
	const encoder = createNativeAacEncoder({ ...geometry, signal: controller.signal, async acceptPacket() {} }, fixture.resources);
	await encoder.add(unit(), 0);
	const flushing = encoder.flush();
	controller.abort(reason);
	await assert.rejects(flushing, (error) => error === reason);
	encoder.dispose();
	assert.deepEqual([fixture.seen.closed, fixture.seen.audioCreated, fixture.seen.audioClosed], [1, 1, 1]);
});

test('native AAC native errors and flush rejection retain their cause and release the encoder once', async () => {
	for (const mode of ['callback', 'flush', 'encode', 'configure']) {
		const fixture = harness();
		const error = new Error(`Native AAC ${mode} failed.`);
		if (mode === 'configure') {
			fixture.setConfigure(() => { throw error; });
			assert.throws(() => createNativeAacEncoder({ ...geometry, async acceptPacket() {} }, fixture.resources), (failure) => failure === error);
		} else {
			const encoder = createNativeAacEncoder({ ...geometry, async acceptPacket() {} }, fixture.resources);
			try {
				if (mode === 'encode') {
					fixture.setEncode(() => { throw error; });
					await assert.rejects(encoder.add(unit(), 0), (failure) => failure === error);
				} else {
					fixture.setFlush(() => mode === 'flush' ? Promise.reject(error) : new Promise(() => undefined));
					const flushing = encoder.flush();
					if (mode === 'callback') fixture.error(error);
					await assert.rejects(flushing, (failure) => failure === error);
				}
			} finally { encoder.dispose(); }
		}
		assert.equal(fixture.seen.closed, 1);
		assert.equal(fixture.seen.audioCreated, fixture.seen.audioClosed);
	}
});

test('native AAC pauses PCM feeding behind a blocked async mux write and resumes in order', async () => {
	const fixture = harness();
	const blocked = deferred(); const started = deferred();
	const packets: number[] = [];
	fixture.setEncode(() => fixture.emit((fixture.seen.encoded - 1) * 1_024));
	const encoder = createNativeAacEncoder({ ...geometry, async acceptPacket(packet) {
		packets.push(packet.timestamp * 48_000);
		if (packets.length === 1) { started.resolve(); await blocked.promise; }
	} }, fixture.resources);
	try {
		const first = encoder.add(unit(), 0);
		await started.promise;
		assert.equal(fixture.seen.encoded, 1);
		blocked.resolve();
		await first;
		await encoder.add(unit(), 1_024);
		assert.equal(await encoder.flush(), 2_048);
		assert.deepEqual(packets, [0, 1_024]);
	} finally { blocked.resolve(); encoder.dispose(); }
});

test('native AAC abort and async write rejection settle pending writes without further encoding', async () => {
	for (const mode of ['abort', 'write']) {
		const fixture = harness();
		const controller = new AbortController();
		const started = deferred(); const blocked = deferred();
		const reason = new Error(`Native AAC blocked ${mode}.`);
		fixture.setEncode(() => fixture.emit(0));
		const encoder = createNativeAacEncoder({ ...geometry, signal: controller.signal, async acceptPacket() { started.resolve(); await blocked.promise; } }, fixture.resources);
		try {
			const adding = encoder.add(unit(), 0);
			await started.promise;
			if (mode === 'abort') controller.abort(reason); else blocked.reject(reason);
			await assert.rejects(adding, (error) => error === reason);
			await assert.rejects(encoder.add(unit(), 1_024), (error) => error === reason);
			assert.equal(fixture.seen.encoded, 1);
		} finally { blocked.resolve(); encoder.dispose(); }
		assert.deepEqual([fixture.seen.closed, fixture.seen.audioCreated, fixture.seen.audioClosed], [1, 1, 1]);
	}
});

test('native AAC rejects packet gaps, overlap, reused input duration and invalid AAC-LC descriptions', async () => {
	for (const options of [
		{ timestamp: 1_000 }, { duration: 42_667 }, { duration: -1 }, { bytes: 0 }, { bytes: 1024 ** 2 + 1 },
		{ metadata: { decoderConfig: { ...decoderConfig, codec: 'mp4a.40.5' } } },
		{ metadata: { decoderConfig: { ...decoderConfig, description: Uint8Array.of(0, 0) } } },
		{ metadata: { decoderConfig: { ...decoderConfig, description: Uint8Array.of(17, 148) } } },
		{ metadata: { decoderConfig: { ...decoderConfig, description: new Uint8Array(65) } } },
	]) {
		const fixture = harness();
		fixture.setEncode(() => fixture.emit(0, options));
		let accepted = 0;
		const encoder = createNativeAacEncoder({ ...geometry, async acceptPacket() { accepted++; } }, fixture.resources);
		try { await assert.rejects(encoder.add(unit(), 0), /qualified/iu); } finally { encoder.dispose(); }
		assert.equal(accepted, 0);
		assert.equal(fixture.seen.closed, 1);
	}
});

test('native AAC caps latent native output while keeping pending mux work bounded', async () => {
	const fixture = harness();
	const blocked = deferred();
	const encoder = createNativeAacEncoder({ ...geometry, async acceptPacket() { await blocked.promise; } }, fixture.resources);
	try {
		for (let index = 0; index < NATIVE_AAC_MAXIMUM_PENDING_PACKETS; index++) await encoder.add(unit(), index * 1_024);
		for (let index = 0; index <= NATIVE_AAC_MAXIMUM_PENDING_PACKETS; index++) fixture.emit(index * 1_024);
		await assert.rejects(encoder.wait(Promise.resolve()), /bounded streaming/iu);
		assert.equal(fixture.seen.closed, 1);
	} finally { blocked.resolve(); encoder.dispose(); }
});

test('native AAC observes late operation rejection even when abort or failure already won', async () => {
	const controller = new AbortController();
	const reason = new Error('Native AAC operation already cancelled.');
	controller.abort(reason);
	await assert.rejects(awaitNativeAacAbort(Promise.reject(new Error('Late mux rejection.')), controller.signal), (error) => error === reason);
	const fixture = harness();
	const encoder = createNativeAacEncoder({ ...geometry, async acceptPacket() {} }, fixture.resources);
	try {
		fixture.error(reason);
		await assert.rejects(encoder.wait(Promise.reject(new Error('Late native flush rejection.'))), (error) => error === reason);
		await setImmediate();
	} finally { encoder.dispose(); }
});

test('native AAC independently caps pending bytes before copying the next latent packet', async () => {
	const fixture = harness();
	const blocked = deferred();
	const packetBytes = 1024 ** 2;
	const admittedPackets = NATIVE_AAC_MAXIMUM_PENDING_BYTES / packetBytes;
	assert.ok(admittedPackets + 1 < NATIVE_AAC_MAXIMUM_PENDING_PACKETS);
	const encoder = createNativeAacEncoder({ ...geometry, async acceptPacket() { await blocked.promise; } }, fixture.resources);
	try {
		for (let index = 0; index < admittedPackets; index++) await encoder.add(unit(), index * 1_024);
		for (let index = 0; index <= admittedPackets; index++) fixture.emit(index * 1_024, { bytes: packetBytes });
		await assert.rejects(encoder.wait(Promise.resolve()), /bounded streaming/iu);
		assert.equal(fixture.seen.copied, admittedPackets);
	} finally { blocked.resolve(); encoder.dispose(); }
	assert.equal(fixture.seen.closed, 1);
});
