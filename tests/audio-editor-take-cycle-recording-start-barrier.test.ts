/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { startTakeCycleRoutedPlayback } from '../src/common/editor/controller/recording/internal/take-cycle/take-cycle-routed-playback-start.ts';

function recorder(events: string[], name: string, confirmedFrame: number) {
	return {
		start(options?: Readonly<{ startFrame?: number }>) { events.push(`${name}:legacy:${String(options?.startFrame)}`); },
		async startConfirmed(options: Readonly<{ startFrame: number }>) {
			events.push(`${name}:confirm:${String(options.startFrame)}`);
			return { startFrame: confirmedFrame };
		},
		async rescheduleConfirmed(options: Readonly<{ startFrame: number }>) {
			events.push(`${name}:move:${String(options.startFrame)}`);
			return { startFrame: options.startFrame };
		},
		pause() { return false; }, resume() { return false; },
		async stop() {}, async dispose() {}, setMonitoring() {}, setInputGain() {},
	};
}

test('take cycle confirms its recorder before playback sources start and shifts the playback origin', async () => {
	const events: string[] = [];
	const context = { sampleRate: 48_000, currentTime: 1 };
	const requestedFrame = 62_528;
	const confirmedFrame = 63_000;
	let sourceStartTime = 0;
	const engine = {
		getPlaybackGraphLatencyFrames: () => 128,
		async playAt(_scheduledTime: number, _loopFrame: number, beforeStart?: (candidate: number) => Promise<number>) {
			assert.ok(beforeStart);
			sourceStartTime = await beforeStart(1.3);
			events.push('playback-source-start');
			return sourceStartTime;
		},
	};
	let acknowledge!: (result: { startFrame: number }) => void;
	const acknowledgement = new Promise<{ startFrame: number }>((resolve) => { acknowledge = resolve; });
	const source = { ...recorder(events, 'mic', confirmedFrame),
		startConfirmed(options: Readonly<{ startFrame: number }>) {
			events.push(`mic:confirm:${String(options.startFrame)}`);
			return acknowledgement;
		} };
	const starting = startTakeCycleRoutedPlayback({ context, engine, loopStartFrame: 100,
		sources: [{ kind: 'device', controller: source }], assertCurrent() {} });
	assert.deepEqual(events, [`mic:confirm:${String(requestedFrame)}`]);
	acknowledge({ startFrame: confirmedFrame });
	await starting;
	assert.deepEqual(events, [`mic:confirm:${String(requestedFrame)}`, 'playback-source-start']);
	assert.equal(Math.round((sourceStartTime + 128 / context.sampleRate) * context.sampleRate), confirmedFrame);
});

test('take cycle moves independently acknowledged inputs onto one future frame before playback', async () => {
	const events: string[] = [];
	const context = { sampleRate: 48_000, currentTime: 1 };
	let sourceStartTime = 0;
	const engine = {
		getPlaybackGraphLatencyFrames: () => 128,
		async playAt(_scheduledTime: number, _loopFrame: number, beforeStart?: (candidate: number) => Promise<number>) {
			assert.ok(beforeStart);
			sourceStartTime = await beforeStart(1.3);
			events.push('playback-source-start');
			return sourceStartTime;
		},
	};
	const first = recorder(events, 'mic-a', 62_528);
	const second = recorder(events, 'mic-b', 63_000);
	await startTakeCycleRoutedPlayback({ context, engine, loopStartFrame: 100,
		sources: [{ kind: 'device', controller: first }, { kind: 'device', controller: second }],
		assertCurrent() {},
	});
	assert.deepEqual(events, [
		'mic-a:confirm:62528', 'mic-b:confirm:62528', 'mic-a:move:63000', 'playback-source-start',
	]);
	assert.equal(Math.round((sourceStartTime + 128 / context.sampleRate) * context.sampleRate), 63_000);
});

test('take cycle refuses playback when a recorder cannot confirm its start', async () => {
	const events: string[] = [];
	const failure = new Error('worklet start failed');
	const engine = {
		async playAt(_scheduledTime: number, _loopFrame: number, beforeStart?: (candidate: number) => Promise<number>) {
			assert.ok(beforeStart);
			await beforeStart(1.3);
			events.push('playback-source-start');
			return 1.3;
		},
	};
	const source = { ...recorder(events, 'mic', 62_528),
		async startConfirmed() { events.push('mic:confirm-failed'); throw failure; } };
	await assert.rejects(startTakeCycleRoutedPlayback({
		context: { sampleRate: 48_000, currentTime: 1 }, engine, loopStartFrame: 100,
		sources: [{ kind: 'device', controller: source }], assertCurrent() {},
	}), failure);
	assert.deepEqual(events, ['mic:confirm-failed']);
});

test('take cycle aborts after acknowledgement if the start scope was cancelled', async () => {
	const events: string[] = [];
	const cancelled = new Error('recording start superseded');
	const engine = {
		async playAt(_scheduledTime: number, _loopFrame: number, beforeStart?: (candidate: number) => Promise<number>) {
			assert.ok(beforeStart);
			await beforeStart(1.3);
			events.push('playback-source-start');
			return 1.3;
		},
	};
	let current = true;
	const source = { ...recorder(events, 'mic', 62_400),
		async startConfirmed() {
			events.push('mic:confirmed');
			current = false;
			return { startFrame: 62_400 };
		} };
	await assert.rejects(startTakeCycleRoutedPlayback({
		context: { sampleRate: 48_000, currentTime: 1 }, engine, loopStartFrame: 100,
		sources: [{ kind: 'device', controller: source }],
		assertCurrent() { if (!current) throw cancelled; },
	}), cancelled);
	assert.deepEqual(events, ['mic:confirmed']);
});
