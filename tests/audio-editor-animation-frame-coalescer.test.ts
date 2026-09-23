/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

test('waveform canvas drawing observes only the track root and relies on React for child changes', async () => {
	const source = await readFile(new URL(
		'../src/common/editor/ui/timeline/TimelineCanvasRenderer.jsx',
		import.meta.url,
	), 'utf8');

	assert.match(source, /resizeObserver\?\.observe\(root\);/u);
	assert.doesNotMatch(source, /resizeObserver\?\.observe\(canvas\)/u);
	assert.doesNotMatch(source, /new MutationObserver/u);
	assert.doesNotMatch(source, /cancelAnimationFrame\(animationFrame\)/u);
});
