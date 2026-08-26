/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createTimelinePlaybackFrameLoop } from '../src/common/editor/ui/timeline/timeline-playback-frame-loop.ts';

test('timeline playback frame loop owns one cancellable request chain', () => {
	let nextId = 1;
	let position = 120;
	const pending = new Map<number, FrameRequestCallback>();
	const cancelled: number[] = [];
	const rendered: number[] = [];
	const loop = createTimelinePlaybackFrameLoop({
		requestFrame(callback) {
			const id = nextId++;
			pending.set(id, (time) => {
				pending.delete(id);
				callback(time);
			});
			return id;
		},
		cancelFrame(id) {
			cancelled.push(id);
			pending.delete(id);
		},
		readPosition: () => position,
		renderPosition: (frame) => rendered.push(frame),
	});

	loop.start();
	loop.start();
	assert.deepEqual([...pending.keys()], [1]);
	pending.get(1)?.(0);
	assert.deepEqual(rendered, [120]);
	assert.deepEqual([...pending.keys()], [2]);
	position = 240;
	pending.get(2)?.(16);
	assert.deepEqual(rendered, [120, 240]);
	assert.deepEqual([...pending.keys()], [3]);
	loop.stop();
	assert.deepEqual(cancelled, [3]);
	loop.stop();
	loop.start();
	assert.deepEqual([...pending.keys()], [4]);
	loop.dispose();
	assert.deepEqual(cancelled, [3, 4]);
	loop.start();
	assert.equal(nextId, 5, 'disposed loops cannot restart');
});

test('timeline visual playheads share the root projection variable and no leaf owns a RAF', async () => {
	const [workspace, overlays, outputs, tracksCss, outputCss] = await Promise.all([
		readFile(new URL('../src/common/editor/ui/timeline/TimelineWorkspaceView.jsx', import.meta.url), 'utf8'),
		readFile(new URL('../src/common/editor/ui/timeline/TimelineOverlayComponents.jsx', import.meta.url), 'utf8'),
		readFile(new URL('../src/common/editor/ui/timeline/OutputTrackRows.jsx', import.meta.url), 'utf8'),
		readFile(new URL('../src/common/editor/ui/audio-editor-design-system/08-timeline-clips-effects.css', import.meta.url), 'utf8'),
		readFile(new URL('../src/common/editor/ui/audio-editor-design-system/06-panels-mixer-output.css', import.meta.url), 'utf8'),
	]);

	assert.match(workspace, /<TimelinePlaybackProjection/u);
	assert.doesNotMatch(workspace, /PinnedPlayheadScroller/u);
	assert.doesNotMatch(overlays, /requestAnimationFrame/u);
	assert.doesNotMatch(outputs, /requestAnimationFrame/u);
	assert.match(tracksCss, /var\(--timeline-playhead-x/u);
	assert.match(outputCss, /var\(--timeline-playhead-x/u);
});
