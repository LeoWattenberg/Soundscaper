/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createMotionAudioPreview, type MotionAudioPlaybackOutput } from '../src/common/editor/controller/track-audio/motion-audio-preview.ts';
import { createMotionscaperRevision } from '../src/common/editor/motion-project-revision.ts';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import type { MotionAudioBlockRequest, MotionAudioMixBlock, MotionAudioMixer } from '../src/common/editor/motion-audio-contract.ts';
import { normalizeRational } from '../src/common/editor/timeline-time.ts';
const revision = createMotionscaperRevision(createMotionscaperProject({ id: 'audio', title: 'Audio', compositionId: 'main', sampleRate: 8000 }));
const range = { compositionId: 'main', startTime: { num: 1, den: 16000 }, endTime: { num: 1, den: 1 } };
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixtures(decode?: (request: MotionAudioBlockRequest, signal?: AbortSignal) => Promise<MotionAudioMixBlock>) {
	let time = 10; let closed = false; const requests: MotionAudioBlockRequest[] = [];
	const scheduled: Array<{ when: number; block: MotionAudioMixBlock; ended(): void; stopped: boolean }> = [];
	const mixer: MotionAudioMixer = { revision, mixBlock(request, signal) { requests.push(request); return decode ? decode(request, signal) : Promise.resolve(block(request)); },
		dispose() {}, snapshot: () => ({ cacheBytes: 0, cacheWindows: 0, rendering: false, disposed: false }) };
	const output: MotionAudioPlaybackOutput = { sampleRate: 8000, get currentTime() { return time; }, resume: () => Promise.resolve(), close: () => { closed = true; return Promise.resolve(); },
		schedule(value, when, ended) { const item = { when, block: value, ended, stopped: false }; scheduled.push(item); return { stop() { item.stopped = true; } }; } };
	return { mixer, output, scheduled, requests, setTime(value: number) { time = value; }, closed: () => closed };
}
function block(request: MotionAudioBlockRequest): MotionAudioMixBlock { return { ...request, startSample: normalizeRational(request.startSample), interleaved: new Float32Array(request.sampleCount * request.channels), projectId: revision.projectId, revision: revision.revision, revisionDigest: revision.digest }; }

function installAudioContext(t: TestContext, create: () => AudioContext): void {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
	Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: function () { return create(); } });
	t.after(() => { if (previous) Object.defineProperty(globalThis, 'AudioContext', previous); else Reflect.deleteProperty(globalThis, 'AudioContext'); });
}
function webContext(sampleRate = 11025) {
	let time = 10, resumes = 0, closes = 0;
	const starts: number[] = [], buffers: Array<{ channels: number; count: number; rate: number }> = [];
	const context = { sampleRate, get currentTime() { return time; }, destination: {},
		resume() { resumes++; return Promise.resolve(); }, close() { closes++; return Promise.resolve(); },
		createBuffer(channels: number, count: number, rate: number) {
			buffers.push({ channels, count, rate }); const data = Array.from({ length: channels }, () => new Float32Array(count));
			return { getChannelData: (channel: number) => data[channel]! };
		},
		createBufferSource() { return { buffer: null, onended: null, connect() {}, disconnect() {}, start(when: number) { starts.push(when); }, stop() {} }; },
	} as unknown as AudioContext;
	return { context, starts, buffers, setTime(value: number) { time = value; }, resumes: () => resumes, closes: () => closes };
}

test('M05 visual-only preview clock, pause and disposal never construct a default AudioContext', async (t) => {
	let constructions = 0;
	installAudioContext(t, () => { constructions++; throw new Error('Visual preview must not open audio output.'); });
	const fixture = fixtures(); const preview = createMotionAudioPreview({ mixer: fixture.mixer });
	assert.equal(preview.clock.now(), 0); assert.deepEqual(preview.snapshot(), { status: 'paused', position: { num: 0, den: 1 }, queuedBlocks: 0, underruns: 0, error: null });
	preview.pause(); assert.equal(preview.clock.now(), 0);
	await assert.rejects(preview.play({ ...range, compositionId: 'missing' }), /missing/u);
	await assert.rejects(preview.play({ ...range, startTime: 2, endTime: 1 }), /range/u);
	preview.dispose(); preview.dispose();
	assert.equal(constructions, 0); assert.equal(fixture.requests.length, 0); assert.equal(preview.snapshot().status, 'disposed'); assert.equal(preview.clock.now(), 0);
});

test('M05 first valid play opens and resumes once before yielding, using the actual context sample rate', async (t) => {
	const audio = webContext(); let constructions = 0;
	installAudioContext(t, () => { constructions++; return audio.context; });
	const fixture = fixtures(); const preview = createMotionAudioPreview({ mixer: fixture.mixer, blockSamples: 256, maximumQueuedBlocks: 2 });
	assert.equal(constructions, 0);
	const request = { compositionId: 'main', startTime: { num: 1, den: 3 }, endTime: { num: 2, den: 3 } };
	const playing = preview.play(request); assert.equal(constructions, 1); assert.equal(audio.resumes(), 1);
	await playing;
	assert.deepEqual(fixture.requests.map((value) => ({ rate: value.sampleRate, start: value.startSample })), [{ rate: 11025, start: { num: 3675, den: 1 } }, { rate: 11025, start: { num: 3931, den: 1 } }]);
	assert.deepEqual(audio.buffers, [{ channels: 2, count: 256, rate: 11025 }, { channels: 2, count: 256, rate: 11025 }]);
	audio.setTime(audio.starts[0]! + 176 / 11025);
	assert.equal(preview.clock.now(), 176 / 11025 * 1000); assert.deepEqual(preview.snapshot().position, { num: 3851, den: 11025 });
	preview.pause(); const held = preview.clock.now(); audio.setTime(20); assert.equal(preview.clock.now(), held);
	await preview.play(request); assert.equal(constructions, 1); assert.equal(audio.resumes(), 2);
	preview.dispose(); preview.dispose(); assert.equal(audio.closes(), 1);
});

test('M05 unavailable default audio output fails at Play, preserves the error and can retry', async (t) => {
	const unavailable = new Error('Audio output unavailable'), failures: Error[] = []; const audio = webContext(); let constructions = 0;
	installAudioContext(t, () => { if (++constructions === 1) throw unavailable; return audio.context; });
	const fixture = fixtures(); const preview = createMotionAudioPreview({ mixer: fixture.mixer, onError: (error) => failures.push(error) });
	await assert.rejects(preview.play(range), (error: unknown) => error === unavailable);
	assert.deepEqual(failures, [unavailable]); assert.equal(preview.snapshot().status, 'error'); assert.equal(preview.snapshot().error, unavailable.message);
	assert.equal(fixture.requests.length, 0); assert.equal(audio.closes(), 0);
	await preview.play(range); assert.equal(constructions, 2); assert.equal(preview.snapshot().status, 'playing'); assert.equal(preview.snapshot().error, null);
	preview.dispose(); assert.equal(audio.closes(), 1);
});

test('M05 supplied output stays owned before Play and a supplied context is never closed', async (t) => {
	installAudioContext(t, () => { throw new Error('Supplied resources must not construct default output.'); });
	const fixture = fixtures(); const unplayed = createMotionAudioPreview({ mixer: fixture.mixer, output: fixture.output });
	unplayed.dispose(); assert.equal(fixture.closed(), true);
	const audio = webContext(); const preview = createMotionAudioPreview({ mixer: fixture.mixer, context: audio.context });
	assert.equal(preview.clock.now(), 0); await preview.play(range); preview.dispose(); assert.equal(audio.resumes(), 1); assert.equal(audio.closes(), 0);
});

test('M05 preview primes a bounded queue before starting and its video clock follows only the audio sample clock', async () => {
	const fixture = fixtures(); const preview = createMotionAudioPreview({ mixer: fixture.mixer, output: fixture.output, blockSamples: 256, maximumQueuedBlocks: 3 });
	await preview.play(range); assert.equal(fixture.scheduled.length, 3); assert.equal(preview.clock.now(), 0);
	assert.deepEqual(fixture.requests.map((request) => request.startSample), [{ num: 1, den: 2 }, { num: 513, den: 2 }, { num: 1025, den: 2 }]);
	const first = fixture.scheduled[0]!; fixture.setTime(first.when + 0.016); assert.ok(Math.abs(preview.clock.now() - 16) < 0.13);
	fixture.setTime(first.when + 0.032); first.ended(); await turn(); assert.equal(preview.snapshot().queuedBlocks, 3); assert.equal(fixture.scheduled.length, 4);
	preview.pause(); const position = preview.clock.now(); fixture.setTime(20); assert.equal(preview.clock.now(), position); assert.ok(fixture.scheduled.every((item) => item.stopped));
	preview.dispose(); assert.equal(fixture.closed(), true);
});

test('M05 audio starvation freezes the shared clock and resumes from the next exact sample without dropping sound', async () => {
	let release!: (value: MotionAudioMixBlock) => void; let held: MotionAudioBlockRequest | undefined; let calls = 0;
	const fixture = fixtures((request) => { calls++; if (calls <= 2) return Promise.resolve(block(request)); held = request; return new Promise((resolve) => { release = resolve; }); });
	const preview = createMotionAudioPreview({ mixer: fixture.mixer, output: fixture.output, blockSamples: 256, maximumQueuedBlocks: 2 }); await preview.play(range);
	fixture.setTime(fixture.scheduled[0]!.when + 0.033); fixture.scheduled[0]!.ended(); await turn();
	fixture.setTime(20); fixture.scheduled[1]!.ended(); assert.equal(preview.clock.now(), 64);
	fixture.setTime(30); assert.equal(preview.clock.now(), 64); release(block(held!)); await turn();
	assert.equal(preview.snapshot().underruns, 1); assert.deepEqual(fixture.scheduled[2]!.block.startSample, { num: 1025, den: 2 });
	fixture.setTime(fixture.scheduled[2]!.when + 0.016); assert.ok(Math.abs(preview.clock.now() - 80) < 0.13); preview.dispose();
});

test('M05 closing while priming aborts decoding and never schedules a late audio block', async () => {
	let started!: () => void; const loading = new Promise<void>((resolve) => { started = resolve; });
	const fixture = fixtures((_request, signal) => { started(); return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true })); });
	const preview = createMotionAudioPreview({ mixer: fixture.mixer, output: fixture.output }); const playing = preview.play(range); await loading;
	preview.dispose(); await playing; assert.equal(fixture.scheduled.length, 0); assert.equal(preview.snapshot().status, 'disposed');
});

test('M05 replacing a priming playback waits for cancelled decoding and starts the new exact range', async () => {
	let started!: () => void; const loading = new Promise<void>((resolve) => { started = resolve; }); let first = true;
	const fixture = fixtures((request, signal) => {
		if (!first) return Promise.resolve(block(request)); first = false; started();
		return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }));
	});
	const preview = createMotionAudioPreview({ mixer: fixture.mixer, output: fixture.output, blockSamples: 256 });
	const previous = preview.play(range); await loading;
	await preview.play({ ...range, startTime: { num: 1, den: 2 } }); await previous;
	assert.equal(fixture.scheduled.length, 3); assert.deepEqual(fixture.scheduled[0]!.block.startSample, { num: 4000, den: 1 }); preview.dispose();
});
