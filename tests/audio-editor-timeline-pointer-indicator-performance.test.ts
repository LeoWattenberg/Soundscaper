/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createTimelinePointerIndicatorRuntime } from '../src/common/editor/ui/timeline/timeline-pointer-indicator-runtime.ts';

void test('hover indicators measure the latest pointer once per frame and skip repeated DOM writes', () => {
	const frames = new Map<number, FrameRequestCallback>();
	let next = 0; let measurements = 0; let writes = 0;
	const rectangle = { left: 10, right: 500, top: 10, bottom: 400 };
	const element = () => {
		let hidden = true; const values = { transform: '', top: '' };
		return { get hidden() { return hidden; }, set hidden(value: boolean) { writes++; hidden = value; },
			style: { get transform() { return values.transform; }, set transform(value: string) { writes++; values.transform = value; },
				get top() { return values.top; }, set top(value: string) { writes++; values.top = value; } },
			getBoundingClientRect() { measurements++; return rectangle; } };
	};
	const time = element(); const vertical = element(); const panel = element(); const ruler = element(); const scroll = { ...element(), querySelector: () => ruler };
	const runtime = createTimelinePointerIndicatorRuntime({ panelRef: { current: panel as unknown as HTMLElement }, scrollRef: { current: scroll as unknown as HTMLElement },
		timeIndicatorRef: { current: time as unknown as HTMLElement }, verticalIndicatorRef: { current: vertical as unknown as HTMLElement },
		request: callback => { frames.set(++next, callback); return next; }, cancel: id => { frames.delete(id); } });
	const flush = () => { const [id, callback] = [...frames][0]!; frames.delete(id); callback(0); };
	for (let clientX = 11; clientX <= 20; clientX++) runtime.update({ pointerType: 'mouse', clientX, clientY: 390 });
	assert.equal(measurements, 0); assert.equal(frames.size, 1);
	flush(); assert.equal(measurements, 2); assert.equal(time.style.transform, 'translateX(10px)');
	writes = 0; runtime.update({ pointerType: 'mouse', clientX: 20, clientY: 390 }); flush();
	assert.equal(writes, 0, 'unchanged indicator geometry and hidden state perform no DOM mutations');
	runtime.update({ pointerType: 'mouse', clientX: 30, clientY: 390 }); runtime.hide();
	assert.equal(frames.size, 0); assert.equal(time.hidden, true);
	runtime.dispose();
});
