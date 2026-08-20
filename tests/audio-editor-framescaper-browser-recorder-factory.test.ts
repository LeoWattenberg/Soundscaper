/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperBrowserRecorderFactory,
} from '../src/common/editor/controller/framescaper-browser-recorder-factory.ts';
import type { CapturePacket } from '../src/common/editor/framescaper-capture-domain.ts';

test('browser recorder factory retains the video encoder actual MIME type', async () => {
	const packets: CapturePacket[] = [];
	const createRecorder = createFramescaperBrowserRecorderFactory({
		MediaRecorder: FakeMediaRecorder,
		getAudioContext: () => ({ sampleRate: 48_000 }),
		receiptTime: () => 4,
	});
	const recorder = await createRecorder(request('camera', packets));
	assert.deepEqual(recorder.format, {
		kind: 'encoded-media', mimeType: 'video/webm;codecs=vp8',
	});
	recorder.start();
	FakeMediaRecorder.latest?.emit(new Blob([new Uint8Array([1, 2, 3])]), 10);
	await recorder.stop();
	assert.equal(packets.length, 1);
	assert.equal(packets[0]?.kind, 'encoded-video');
	assert.equal(packets[0]?.mimeType, 'video/webm;codecs=vp8');
});

test('browser recorder factory packetizes actual PCM and marks pause input gaps expected', async () => {
	const packets: CapturePacket[] = [];
	const processor = processorHarness();
	const createRecorder = createFramescaperBrowserRecorderFactory({
		MediaRecorder: null,
		MediaStreamTrackProcessor: processor.Processor,
		getAudioContext: () => ({ sampleRate: 48_000 }),
		receiptTime: () => 8,
	});
	const recorder = await createRecorder(request('microphone', packets));
	assert.deepEqual(recorder.format, {
		kind: 'raw-pcm', sampleRate: 48_000, channelCount: 1, chunkFrames: 4_096,
	});
	recorder.start();
	processor.push(audioData(0, [0.25, -0.5]));
	await eventually(() => packets.length === 1);
	assert.equal(await recorder.pause(), true);
	assert.equal(await recorder.resume(), true);
	processor.push(audioData(20, [0.75]));
	await eventually(() => packets.length === 2);
	await recorder.stop();
	assert.equal(packets[0]?.kind, 'pcm-audio');
	assert.equal(packets[1]?.droppedBefore.value, 0);
});

function request(role: 'camera' | 'microphone', packets: CapturePacket[]) {
	const track = role === 'microphone'
		? { kind: 'audio', stop() {}, getSettings: () => ({ sampleRate: 48_000, channelCount: 1 }) }
		: { kind: 'video', stop() {}, getSettings: () => ({ width: 640, height: 480 }) };
	const stream = { getTracks: () => [track], getAudioTracks: () => role === 'microphone' ? [track] : [], getVideoTracks: () => role === 'camera' ? [track] : [] };
	return {
		sessionId: 'session-a', streamId: 'stream-a', sourceId: 'source-a',
		source: { sourceId: 'picker-source', role, track, stream, settings: {}, capabilities: {} },
		monitoring: false, inputGain: 1,
		onPacket: async (packet: CapturePacket) => { packets.push(packet); },
		onError(error: unknown) { throw error; },
		onBackpressure() { throw new Error('unexpected pressure'); },
	};
}

class FakeMediaRecorder {
	static latest: FakeMediaRecorder | null = null;
	static isTypeSupported(value: string) { return value === 'video/webm;codecs=vp8'; }
	readonly mimeType = 'video/webm;codecs=vp8';
	state = 'inactive';
	ondataavailable: ((event: { data: Blob; timecode?: number }) => void) | null = null;
	onerror: ((event: { error?: unknown }) => void) | null = null;
	onstop: (() => void) | null = null;
	constructor(_stream: unknown, _options?: Readonly<{ mimeType?: string }>) { FakeMediaRecorder.latest = this; }
	start() { this.state = 'recording'; }
	pause() { this.state = 'paused'; }
	resume() { this.state = 'recording'; }
	requestData() {}
	stop() { this.state = 'inactive'; queueMicrotask(() => this.onstop?.()); }
	emit(data: Blob, timecode: number) { this.ondataavailable?.({ data, timecode }); }
}

function processorHarness() {
	type Result = Readonly<{ done: boolean; value?: ReturnType<typeof audioData> }>;
	const queued: Result[] = [];
	const waiting: ((value: Result) => void)[] = [];
	const reader = {
		read: () => queued.length ? Promise.resolve(queued.shift()!) : new Promise<Result>((resolve) => waiting.push(resolve)),
		cancel: () => { waiting.splice(0).forEach((resolve) => resolve({ done: true })); },
		releaseLock() {},
	};
	return {
		Processor: class { readonly readable = { getReader: () => reader }; },
		push(value: ReturnType<typeof audioData>) {
			const resolve = waiting.shift();
			if (resolve) resolve({ done: false, value });
			else queued.push({ done: false, value });
		},
	};
}

function audioData(frameStart: number, samples: readonly number[]) {
	return {
		numberOfFrames: samples.length, numberOfChannels: 1, sampleRate: 48_000,
		timestamp: frameStart,
		copyTo(destination: Float32Array) { destination.set(samples); },
		close() {},
	};
}

async function eventually(predicate: () => boolean) {
	for (let attempt = 0; attempt < 100 && !predicate(); attempt += 1) await new Promise(setImmediate);
	assert.equal(predicate(), true);
}
