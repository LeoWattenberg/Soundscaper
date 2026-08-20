/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperBrowserVideoRecorder,
} from '../src/common/editor/controller/framescaper-browser-video-recorder.ts';

class FakeMediaRecorder {
	static isTypeSupported(): boolean { return true; }
	readonly stream: unknown;
	readonly mimeType: string;
	state = 'inactive';
	ondataavailable: ((event: Readonly<{ data: Blob; timecode?: number }>) => void) | null = null;
	onerror: ((event: Readonly<{ error?: unknown }>) => void) | null = null;
	onstop: (() => void) | null = null;
	startTimeslice: number | null = null;
	requestDataCalls = 0;

	constructor(stream: unknown, options?: Readonly<{ mimeType?: string }>) {
		this.stream = stream;
		this.mimeType = options?.mimeType || 'video/webm;codecs=vp8';
	}

	start(timeslice: number): void { this.startTimeslice = timeslice; this.state = 'recording'; }
	pause(): void { this.state = 'paused'; }
	resume(): void { this.state = 'recording'; }
	requestData(): void { this.requestDataCalls += 1; }
	stop(): void { this.state = 'inactive'; queueMicrotask(() => this.onstop?.()); }
	emit(data: Blob, timecode: number): void { this.ondataavailable?.({ data, timecode }); }
}

test('video recorder retains actual MIME and timestamps bounded logical events', async () => {
	const packets: Array<Readonly<{ sequence: number; bytes: Uint8Array; presentationTimeUs: number; durationUs: number; mimeType: string }>> = [];
	const recorder = createFramescaperBrowserVideoRecorder({
		MediaRecorder: FakeMediaRecorder,
		stream: { id: 'camera-stream' },
		sessionId: 'session-1',
		streamId: 'camera-1',
		role: 'camera',
		selectedMimeType: '',
		maximumPacketBytes: 8,
		timesliceMs: 1_000,
		receiptTime: () => 10,
		onPacket: async (packet) => { packets.push(packet); },
	});
	assert.equal(recorder.mimeType, 'video/webm;codecs=vp8');
	recorder.start(250_000);
	assert.equal(recorder.state, 'recording');
	assert.equal(recorder.mediaRecorder.startTimeslice, 1_000);
	recorder.mediaRecorder.emit(new Blob([new Uint8Array([1, 2, 3, 4, 5, 6])]), 1_000);
	recorder.mediaRecorder.emit(new Blob([new Uint8Array([7, 8])]), 2_000);
	await recorder.stop();

	assert.deepEqual(packets.map(({ sequence, bytes, presentationTimeUs, durationUs, mimeType }) => ({
		sequence, bytes: [...bytes], presentationTimeUs, durationUs, mimeType,
	})), [
		{ sequence: 0, bytes: [1, 2, 3, 4, 5, 6], presentationTimeUs: 250_000, durationUs: 1_000_000, mimeType: 'video/webm;codecs=vp8' },
		{ sequence: 1, bytes: [7, 8], presentationTimeUs: 1_250_000, durationUs: 1_000_000, mimeType: 'video/webm;codecs=vp8' },
	]);
	assert.equal(recorder.state, 'stopped');
	assert.equal(recorder.mediaRecorder.requestDataCalls, 1);
});

test('video recorder excludes a declared pause from its shared presentation range', async () => {
	const packets: Array<Readonly<{ presentationTimeUs: number; durationUs: number }>> = [];
	const recorder = createFramescaperBrowserVideoRecorder({
		MediaRecorder: FakeMediaRecorder,
		stream: {}, sessionId: 'session-1', streamId: 'camera-1', role: 'camera',
		selectedMimeType: 'video/webm', timesliceMs: 1_000,
		onPacket: (packet) => { packets.push(packet); },
	});
	recorder.start(400_000);
	recorder.mediaRecorder.emit(new Blob([Uint8Array.of(1)]), 1_000);
	assert.equal(recorder.pause(), true);
	assert.equal(recorder.resume(5_000_000), true);
	recorder.mediaRecorder.emit(new Blob([Uint8Array.of(2)]), 7_000);
	await recorder.stop();
	assert.deepEqual(packets.map(({ presentationTimeUs, durationUs }) => ({ presentationTimeUs, durationUs })), [
		{ presentationTimeUs: 400_000, durationUs: 1_000_000 },
		{ presentationTimeUs: 1_400_000, durationUs: 1_000_000 },
	]);
});

test('pause, resume, stop, and dispose are idempotent', async () => {
	const recorder = createFramescaperBrowserVideoRecorder({
		MediaRecorder: FakeMediaRecorder,
		stream: {}, sessionId: 'session-1', streamId: 'display-1', role: 'display',
		selectedMimeType: 'video/webm', onPacket: async () => {},
	});
	assert.equal(recorder.pause(), false);
	recorder.start();
	assert.equal(recorder.pause(), true);
	assert.equal(recorder.pause(), false);
	assert.equal(recorder.resume(), true);
	const first = recorder.stop();
	const second = recorder.stop();
	assert.equal(first, second);
	await first;
	await recorder.dispose();
	await recorder.dispose();
	assert.equal(recorder.state, 'disposed');
});

test('queue pressure pauses the recorder and reports one bounded backpressure event', async () => {
	let releaseFirst!: () => void;
	const firstWrite = new Promise<void>((resolve) => { releaseFirst = resolve; });
	const pressure: number[] = [];
	let writes = 0;
	const recorder = createFramescaperBrowserVideoRecorder({
		MediaRecorder: FakeMediaRecorder,
		stream: {}, sessionId: 'session-1', streamId: 'camera-1', role: 'camera',
		selectedMimeType: 'video/webm', maximumPendingEvents: 1,
		onPacket: async () => { writes += 1; if (writes === 1) await firstWrite; },
		onBackpressure: (pending) => { pressure.push(pending); },
	});
	recorder.start();
	recorder.mediaRecorder.emit(new Blob([new Uint8Array([1])]), 1);
	recorder.mediaRecorder.emit(new Blob([new Uint8Array([2])]), 2);
	assert.equal(recorder.mediaRecorder.state, 'paused');
	assert.deepEqual(pressure, [2]);
	releaseFirst();
	await recorder.stop();
	assert.equal(writes, 2);
});

test('packet write failure rejects stop and reports the encoder failure', async () => {
	const failure = new Error('storage failed');
	const errors: unknown[] = [];
	const recorder = createFramescaperBrowserVideoRecorder({
		MediaRecorder: FakeMediaRecorder,
		stream: {}, sessionId: 'session-1', streamId: 'camera-1', role: 'camera',
		selectedMimeType: 'video/webm',
		onPacket: async () => { throw failure; },
		onError: (error) => { errors.push(error); },
	});
	recorder.start();
	recorder.mediaRecorder.emit(new Blob([new Uint8Array([1])]), 1);
	await assert.rejects(recorder.stop(), failure);
	assert.deepEqual(errors, [failure]);
});
