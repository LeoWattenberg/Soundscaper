/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createToolbarDockingSession, type ToolbarDockingState } from '../src/common/editor/controller/composition/toolbar-docking-session.ts';

for (const button of [1, 2]) test(`toolbar docking keeps its primary drag through button ${button} release`, () => {
	let state: ToolbarDockingState = { dock: 'floating', x: 100, y: 100 };
	const writes: string[] = [];
	const previews: Array<Readonly<{ x: number; y: number }>> = [];
	const listeners = new Map<string, (event: MouseEvent | KeyboardEvent) => void>();
	const frames = new Map<number, () => void>();
	let identifier = 0;
	const bounds = () => ({ left: state.x, top: state.y, right: state.x + 600, bottom: state.y + 48 });
	const editor = { left: 0, top: 0, right: 1200, bottom: 800 };
	const session = createToolbarDockingSession({
		initialState: state, storageKey: 'toolbar',
		storage: { setItem: (_key, value) => { writes.push(value); } },
		onChange: next => { state = next; },
		onFloatingPreview: next => { previews.push(next); },
		getFloatingBounds: bounds,
		events: { subscribe: (type, callback) => {
			listeners.set(type, callback);
			return () => { listeners.delete(type); };
		} },
		requestFrame: callback => { const id = ++identifier; frames.set(id, callback); return id; },
		cancelFrame: id => { frames.delete(id); },
	});
	const flush = () => { for (const callback of frames.values()) callback(); frames.clear(); };
	const release = (releasedButton: number, buttons: number) => {
		listeners.get('mouseup')?.({ button: releasedButton, buttons } as MouseEvent);
	};
	try {
		// Ordinary primary movement and release still save exactly once.
		session.begin({ x: 110, y: 110 }, bounds(), editor);
		session.move({ x: 110, y: 150 }); flush();
		assert.deepEqual(previews.at(-1), { x: 100, y: 140 });
		release(0, 0);
		assert.equal(state.y, 140);
		assert.equal(writes.length, 1);

		session.begin({ x: 110, y: 150 }, bounds(), editor);
		session.move({ x: 110, y: 174 }); flush();
		assert.deepEqual(previews.at(-1), { x: 100, y: 164 });
		release(button, 1);
		assert.equal(writes.length, 1, 'releasing an auxiliary button cannot publish the still-held primary gesture');
		session.move({ x: 110, y: 210 }); flush();
		assert.deepEqual(previews.at(-1), { x: 100, y: 200 });
		release(0, 0);
		assert.equal(state.y, 200);
		assert.equal(writes.length, 2);
	} finally { session.dispose(); }
});
