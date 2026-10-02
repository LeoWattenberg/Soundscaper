/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createToolbarDockingSession,
	loadToolbarDockingState,
	type ToolbarDockingState,
} from '../src/common/editor/controller/composition/toolbar-docking-session.ts';

const editorBounds = { left: 100, top: 80, right: 1_100, bottom: 780 };
const toolbarBounds = { left: 100, top: 130, right: 700, bottom: 178 };

function fixture(floatingBounds = toolbarBounds, initialState: ToolbarDockingState = { dock: 'top', x: 24, y: 104 }) {
	let state: ToolbarDockingState = initialState;
	const writes: string[] = [];
	const previews: Array<{ x: number; y: number }> = [];
	const listeners = new Map<string, (event: MouseEvent | KeyboardEvent) => void>();
	const frames = new Map<number, () => void>();
	let frameId = 0;
	const session = createToolbarDockingSession({
		initialState: state,
		storage: { setItem: (_key, value) => writes.push(value) },
		storageKey: 'test-toolbar',
		onChange: (next) => { state = next; },
		onFloatingPreview: (position) => previews.push(position),
		getFloatingBounds: () => floatingBounds,
		events: {
			subscribe: (type, handler) => {
				listeners.set(type, handler);
				return () => { listeners.delete(type); };
			},
		},
		requestFrame: (callback) => { const id = ++frameId; frames.set(id, callback); return id; },
		cancelFrame: (id) => { frames.delete(id); },
	});
	return { session, writes, previews, listeners, frames, state: () => state };
}

test('toolbar docks on all four edges and remembers the released placement', () => {
	for (const [dock, x, y] of [
		['left', 108, 400], ['right', 1_090, 400], ['top', 600, 90], ['bottom', 600, 770],
	] as const) {
		const f = fixture();
		f.session.begin({ x: 110, y: 140 }, toolbarBounds, editorBounds);
		f.session.move({ x, y });
		assert.equal(f.state().dock, dock);
		f.session.finish();
		assert.equal(JSON.parse(f.writes[0]!).dock, dock);
		f.session.dispose();
	}
});

test('floating drag previews are batched, clamped inside the editor, and committed on release', () => {
	const f = fixture();
	f.session.begin({ x: 110, y: 140 }, toolbarBounds, editorBounds);
	f.session.move({ x: 600, y: 400 });
	f.session.move({ x: 650, y: 430 });
	assert.equal(f.state().dock, 'floating');
	assert.equal(f.frames.size, 1);
	for (const callback of f.frames.values()) callback();
	assert.deepEqual(f.previews, [{ x: 400, y: 340 }]);
	f.session.finish();
	assert.deepEqual(f.state(), { dock: 'floating', x: 400, y: 340 });
	assert.equal(f.writes.length, 1);
});

test('a click does not move the toolbar and Escape restores the starting layout', () => {
	const f = fixture();
	f.session.begin({ x: 110, y: 140 }, toolbarBounds, editorBounds);
	f.session.move({ x: 112, y: 141 });
	f.session.finish();
	assert.equal(f.writes.length, 0);
	f.session.begin({ x: 110, y: 140 }, toolbarBounds, editorBounds);
	f.session.move({ x: 600, y: 400 });
	f.listeners.get('keydown')?.({ key: 'Escape', preventDefault() {} } as KeyboardEvent);
	assert.deepEqual(f.state(), { dock: 'top', x: 24, y: 104 });
	assert.equal(f.frames.size, 0);
	assert.equal(f.writes.length, 0);
});

test('menu placement persists and disposal releases listeners and pending frames idempotently', () => {
	const f = fixture();
	f.session.setDock('right');
	assert.equal(f.state().dock, 'right');
	assert.equal(f.writes.length, 1);
	f.session.begin({ x: 110, y: 140 }, toolbarBounds, editorBounds);
	f.session.move({ x: 600, y: 400 });
	f.session.dispose();
	f.session.dispose();
	assert.equal(f.listeners.size, 0);
	assert.equal(f.frames.size, 0);
});

test('stored layouts survive reload, malformed data and unavailable storage fall back safely', () => {
	assert.deepEqual(loadToolbarDockingState({ getItem: () => '{"dock":"left","x":42,"y":96}' }, 'test'), { dock: 'left', x: 42, y: 96 });
	for (const value of ['null', '{}', '{', '{"dock":"invalid"}', '{"dock":"floating","x":-3,"y":"wrong"}']) {
		const state = loadToolbarDockingState({ getItem: () => value }, 'test');
		assert.ok(['top', 'floating'].includes(state.dock));
		assert.ok(state.x >= 0 && state.y >= 0);
	}
	assert.equal(loadToolbarDockingState({ getItem: () => { throw new Error('disabled'); } }, 'test').dock, 'top');
});

test('cancelling a floating move restores the imperative preview as well as state', () => {
	const f = fixture();
	f.session.setDock('floating');
	f.session.begin({ x: 110, y: 140 }, toolbarBounds, editorBounds);
	f.session.move({ x: 600, y: 400 });
	for (const callback of f.frames.values()) callback();
	f.session.cancel();
	assert.deepEqual(f.previews.at(-1), { x: 24, y: 104 });
	assert.deepEqual(f.state(), { dock: 'floating', x: 24, y: 104 });
	assert.equal(f.writes.length, 1, 'cancel does not persist the preview');
});


test('a side toolbar uses the horizontal floating dimensions when clamping its preview', () => {
	const f = fixture({ left: 0, top: 0, right: 800, bottom: 48 });
	f.session.begin({ x: 110, y: 140 }, { left: 100, top: 130, right: 284, bottom: 780 }, editorBounds);
	f.session.move({ x: 650, y: 650 });
	for (const callback of f.frames.values()) callback();
	assert.deepEqual(f.previews.at(-1), { x: 200, y: 560 });
	f.session.finish();
	assert.deepEqual(f.state(), { dock: 'floating', x: 200, y: 560 });
});

test('restored floating toolbars remain reachable after the editor shrinks', () => {
	const f = fixture(toolbarBounds, { dock: 'floating', x: 5_000, y: 5_000 });
	f.session.reconcileFloatingBounds(editorBounds);
	assert.deepEqual(f.state(), { dock: 'floating', x: 400, y: 652 });
	f.session.reconcileFloatingBounds({ left: 0, top: 0, right: 720, bottom: 480 });
	assert.deepEqual(f.state(), { dock: 'floating', x: 120, y: 432 });
	assert.equal(f.writes.length, 2);
	f.session.reconcileFloatingBounds({ left: 0, top: 0, right: 720, bottom: 480 });
	assert.equal(f.writes.length, 2, 'unchanged bounds do not rewrite storage');
});

test('bounds reconciliation leaves docked toolbars and active drag previews alone', () => {
	const f = fixture();
	f.session.reconcileFloatingBounds(editorBounds);
	assert.equal(f.writes.length, 0);
	f.session.begin({ x: 110, y: 140 }, toolbarBounds, editorBounds);
	f.session.move({ x: 600, y: 400 });
	f.session.reconcileFloatingBounds({ left: 0, top: 0, right: 720, bottom: 480 });
	assert.equal(f.writes.length, 0);
	assert.deepEqual(f.state(), { dock: 'floating', x: 24, y: 104 });
});

test('a resize during a floating drag clamps its final position on release or cancellation', () => {
	const smallerEditor = { left: 0, top: 0, right: 720, bottom: 480 };
	const released = fixture();
	released.session.begin({ x: 110, y: 140 }, toolbarBounds, editorBounds);
	released.session.move({ x: 650, y: 650 });
	released.session.reconcileFloatingBounds(smallerEditor);
	released.session.finish();
	assert.deepEqual(released.state(), { dock: 'floating', x: 120, y: 432 });
	const cancelled = fixture(toolbarBounds, { dock: 'floating', x: 400, y: 600 });
	cancelled.session.begin({ x: 110, y: 140 }, toolbarBounds, editorBounds);
	cancelled.session.move({ x: 650, y: 650 });
	cancelled.session.reconcileFloatingBounds(smallerEditor);
	cancelled.session.cancel();
	assert.deepEqual(cancelled.state(), { dock: 'floating', x: 120, y: 432 });
	assert.deepEqual(cancelled.previews.at(-1), { x: 120, y: 432 });
	assert.equal(cancelled.writes.length, 1, 'the corrected saved position survives reload');
});

test('releasing the floating grip after a resize keeps it reachable without moving the pointer', () => {
	const f = fixture(toolbarBounds, { dock: 'floating', x: 400, y: 600 });
	f.session.begin({ x: 110, y: 140 }, toolbarBounds, editorBounds);
	f.session.reconcileFloatingBounds({ left: 0, top: 0, right: 720, bottom: 480 });
	f.session.finish();
	assert.deepEqual(f.state(), { dock: 'floating', x: 120, y: 432 });
	assert.equal(f.writes.length, 1);
});
