/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ASSISTANCE_RUNTIME_FAMILY_IDLE_UNLOAD_MS,
	createAssistanceIdleUnloadScheduler,
} from '../desktop/assistance-runtime-family-idle-unload-v1.ts';

function fakeTimers() {
	const pending = new Map<number, { callback: () => void; delay: number }>();
	let next = 1;
	const setTimeoutImpl = ((callback: () => void, delay: number) => {
		const handle = next;
		next += 1;
		pending.set(handle, { callback, delay });
		return handle as unknown as ReturnType<typeof setTimeout>;
	}) as unknown as typeof setTimeout;
	const clearTimeoutImpl = ((handle: number) => {
		pending.delete(handle);
	}) as unknown as typeof clearTimeout;
	return {
		setTimeoutImpl,
		clearTimeoutImpl,
		get size(): number { return pending.size; },
		delays(): number[] { return [...pending.values()].map(({ delay }) => delay); },
		fireAll(): void {
			for (const [handle, entry] of [...pending]) {
				pending.delete(handle);
				entry.callback();
			}
		},
	};
}

test('a quiet family gives its memory back after the idle interval', () => {
	const timers = fakeTimers();
	const unloaded: string[] = [];
	const scheduler = createAssistanceIdleUnloadScheduler({
		idleUnloadMs: 120_000, ...timers,
	});
	scheduler.schedule('llama-cpp', () => unloaded.push('llama-cpp'));
	assert.deepEqual(timers.delays(), [120_000]);
	assert.deepEqual(unloaded, []);
	timers.fireAll();
	assert.deepEqual(unloaded, ['llama-cpp']);
});

test('a family that becomes busy again is never unloaded underneath its next job', () => {
	const timers = fakeTimers();
	const unloaded: string[] = [];
	const scheduler = createAssistanceIdleUnloadScheduler({ idleUnloadMs: 1_000, ...timers });
	scheduler.schedule('onnxruntime-node', () => unloaded.push('onnxruntime-node'));
	scheduler.cancel('onnxruntime-node');
	timers.fireAll();
	assert.deepEqual(unloaded, []);
	assert.equal(timers.size, 0);
});

test('rescheduling a family restarts its quiet period instead of stacking timers', () => {
	const timers = fakeTimers();
	const unloaded: string[] = [];
	const scheduler = createAssistanceIdleUnloadScheduler({ idleUnloadMs: 1_000, ...timers });
	scheduler.schedule('whisper-cpp', () => unloaded.push('first'));
	scheduler.schedule('whisper-cpp', () => unloaded.push('second'));
	assert.equal(timers.size, 1, 'a second schedule must replace the first, not add to it');
	timers.fireAll();
	assert.deepEqual(unloaded, ['second']);
});

test('each family keeps its own quiet period', () => {
	const timers = fakeTimers();
	const unloaded: string[] = [];
	const scheduler = createAssistanceIdleUnloadScheduler({ idleUnloadMs: 1_000, ...timers });
	scheduler.schedule('whisper-cpp', () => unloaded.push('whisper-cpp'));
	scheduler.schedule('llama-cpp', () => unloaded.push('llama-cpp'));
	scheduler.cancel('whisper-cpp');
	timers.fireAll();
	assert.deepEqual(unloaded, ['llama-cpp']);
});

test('cancelling an unscheduled family is a no-op rather than an error', () => {
	const timers = fakeTimers();
	const scheduler = createAssistanceIdleUnloadScheduler({ idleUnloadMs: 1_000, ...timers });
	scheduler.cancel('llama-cpp');
	assert.equal(timers.size, 0);
});

test('disposal cancels every pending unload without running any of them', () => {
	const timers = fakeTimers();
	const unloaded: string[] = [];
	const scheduler = createAssistanceIdleUnloadScheduler({ idleUnloadMs: 1_000, ...timers });
	scheduler.schedule('whisper-cpp', () => unloaded.push('whisper-cpp'));
	scheduler.schedule('llama-cpp', () => unloaded.push('llama-cpp'));
	scheduler.dispose();
	assert.equal(timers.size, 0);
	timers.fireAll();
	assert.deepEqual(unloaded, []);
});

test('the scheduler refuses an interval or request it cannot honour', () => {
	const timers = fakeTimers();
	assert.throws(() => createAssistanceIdleUnloadScheduler({ idleUnloadMs: 0, ...timers }), RangeError);
	assert.throws(() => createAssistanceIdleUnloadScheduler({ idleUnloadMs: 1.5, ...timers }), RangeError);
	assert.throws(() => createAssistanceIdleUnloadScheduler({
		idleUnloadMs: 3_600_001, ...timers,
	}), RangeError);
	const scheduler = createAssistanceIdleUnloadScheduler({ idleUnloadMs: 1_000, ...timers });
	assert.throws(() => scheduler.schedule('', () => {}), TypeError);
	assert.throws(() => scheduler.schedule('llama-cpp', null as unknown as () => void), TypeError);
});

test('the default quiet period is the registered two minutes', () => {
	const timers = fakeTimers();
	const scheduler = createAssistanceIdleUnloadScheduler({
		idleUnloadMs: ASSISTANCE_RUNTIME_FAMILY_IDLE_UNLOAD_MS, ...timers,
	});
	scheduler.schedule('llama-cpp', () => {});
	assert.deepEqual(timers.delays(), [120_000]);
});
