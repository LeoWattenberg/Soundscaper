/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAnimationFrameCoalescer } from '../src/common/editor/ui/timeline/animation-frame-coalescer.ts';

test('animation-frame coalescer keeps one pending draw and cancels it on disposal', () => {
	let nextId = 1;
	const pending = new Map<number, FrameRequestCallback>();
	const cancelled: number[] = [];
	let draws = 0;
	const scheduler = createAnimationFrameCoalescer(
		(callback) => {
			const id = nextId++;
			pending.set(id, (time) => {
				pending.delete(id);
				callback(time);
			});
			return id;
		},
		(id) => {
			cancelled.push(id);
			pending.delete(id);
		},
		() => { draws += 1; },
	);

	scheduler.schedule();
	scheduler.schedule();
	scheduler.schedule();
	assert.deepEqual([...pending.keys()], [1]);
	pending.get(1)?.(10);
	assert.equal(draws, 1);

	scheduler.schedule();
	assert.deepEqual([...pending.keys()], [2]);
	scheduler.dispose();
	assert.deepEqual(cancelled, [2]);
	pending.get(2)?.(20);
	assert.equal(draws, 1);
	scheduler.schedule();
	assert.equal(nextId, 3, 'disposed schedulers ignore future notifications');
});

test('latest frame tasks collapse inputs and flush the final input before pointer ownership ends', async () => {
	const { createLatestFrameTask } = await import('../src/common/editor/ui/timeline/animation-frame-coalescer.ts');
	let callback: FrameRequestCallback | null = null;
	const outputs: number[] = [];
	let requests = 0;
	const task = createLatestFrameTask<number>(value => { callback = value; return ++requests; },
		() => { callback = null; }, value => outputs.push(value));
	task.schedule(1); task.schedule(2); task.schedule(3);
	assert.equal(requests, 1);
	task.flush();
	assert.deepEqual(outputs, [3]);
	assert.equal(callback, null);
	task.schedule(4); task.flush(true);
	assert.deepEqual(outputs, [3]);
	task.schedule(5); task.dispose(); task.schedule(6);
	assert.equal(callback, null);
	assert.deepEqual(outputs, [3]);
});
