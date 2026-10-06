/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FloatingWorkspacePanelMove,
	resolveFloatingPanelPointerDrop,
	type FloatingPanelPointerDropTarget,
} from '../src/common/editor/ui/workspace/floating-workspace-panel-move.ts';
import { retainFloatingPanelMoveLifecycle } from '../src/common/editor/ui/workspace/floating-panel-move-lifecycle.ts';

const bounds = { left: 100, top: 100, width: 200, height: 300 };

test('floating pointer drops append to an occupied dock without implicitly tabbing', () => {
	const targets: readonly FloatingPanelPointerDropTarget[] = [
		{ dock: 'right', bounds },
	];
	for (const y of [101, 250, 399]) {
		assert.deepEqual(resolveFloatingPanelPointerDrop({ x: 150, y }, targets), {
			kind: 'dock', dock: 'right', groupIndex: Number.MAX_SAFE_INTEGER,
		});
	}
	assert.equal(resolveFloatingPanelPointerDrop({ x: 350, y: 250 }, targets), null);
});

test('floating pointer drops dock into empty zones and dock gaps while internal floating movement stays free', () => {
	for (const dock of ['left', 'right', 'top', 'bottom']) {
		assert.deepEqual(resolveFloatingPanelPointerDrop({ x: 150, y: 200 }, [{ dock, bounds }]), {
			kind: 'dock', dock, groupIndex: Number.MAX_SAFE_INTEGER,
		});
	}
	for (const dock of ['floating', 'unsupported']) {
		assert.equal(resolveFloatingPanelPointerDrop({ x: 150, y: 200 }, [{ dock, bounds }]), null);
	}
	assert.equal(resolveFloatingPanelPointerDrop({ x: 150, y: 200 }, [
		{ dock: 'top', bounds: { ...bounds, width: 0 } },
	]), null, 'display:none targets must not accept a drop');
	assert.equal(resolveFloatingPanelPointerDrop({ x: Number.NaN, y: 200 }, [
		{ dock: 'top', bounds },
	]), null);
});

test('floating moves keep the captured callbacks through rerenders and persist free movement', () => {
	const fixture = moveFixture([]);
	fixture.callbacks.onDragEnd = () => { throw new Error('rerender callbacks must not replace the session'); };
	fixture.session.move(pointer(7, 232, 100));
	assert.equal(fixture.element.style.left, '232px');
	assert.equal(fixture.session.finish(pointer(8, 232, 100)), false, 'another pointer cannot finish the move');
	assert.equal(fixture.session.finish(pointer(7, 232, 100)), true);
	assert.deepEqual(fixture.calls, ['start', ['persist', { x: 232, y: 100 }], 'end']);
	assert.equal(fixture.classes.size, 0);
});

test('floating meter drops dock instead of persisting coordinates and cancellation clears drag state', () => {
	const fixture = moveFixture([{ dock: 'bottom', bounds }]);
	fixture.session.move(pointer(7, 150, 200));
	assert.equal(fixture.session.finish(pointer(7, 150, 200)), true);
	assert.deepEqual(fixture.calls, ['start', ['dock', { kind: 'dock', dock: 'bottom', groupIndex: Number.MAX_SAFE_INTEGER }], 'end']);
	const cancelled = moveFixture([]);
	cancelled.session.move(pointer(7, 232, 100));
	assert.equal(cancelled.session.cancel(pointer(8, 232, 100)), false);
	assert.equal(cancelled.session.cancel(pointer(7, 232, 100)), true);
	assert.equal(cancelled.element.style.left, '200px');
	assert.deepEqual(cancelled.calls, ['start', 'end']);
	assert.equal(cancelled.classes.size, 0);
	const unmounted = moveFixture([]);
	assert.equal(unmounted.session.cancel(), true, 'teardown releases the active drag without a pointer event');
	assert.equal(unmounted.session.cancel(), false, 'teardown settles the captured callbacks once');
	assert.deepEqual(unmounted.calls, ['start', 'end']);
});

function pointer(pointerId: number, clientX: number, clientY: number) {
	return { pointerId, clientX, clientY, preventDefault: () => undefined };
}

test('Escape cancels the live floating move and a later release cannot persist it', () => {
	const target = new EventTarget();
	const fixture = moveFixture([]);
	const ref: { current: FloatingWorkspacePanelMove | null } = { current: fixture.session };
	const release = retainFloatingPanelMoveLifecycle(target as unknown as Window, ref);
	const move = new Event('pointermove', { cancelable: true });
	Object.defineProperties(move, { pointerId: { value: 7 }, clientX: { value: 250 }, clientY: { value: 120 } });
	target.dispatchEvent(move);
	assert.equal(fixture.element.style.left, '250px');
	const escape = new Event('keydown', { cancelable: true });
	Object.defineProperty(escape, 'key', { value: 'Escape' });
	target.dispatchEvent(escape);
	assert.equal(escape.defaultPrevented, true);
	assert.equal(ref.current, null);
	assert.equal(fixture.element.style.left, '200px');
	const up = new Event('pointerup');
	Object.defineProperties(up, { pointerId: { value: 7 }, clientX: { value: 250 }, clientY: { value: 120 } });
	target.dispatchEvent(up);
	assert.deepEqual(fixture.calls, ['start', 'end']);
	release();
	const another = moveFixture([]);
	ref.current = another.session;
	const removed = new Event('keydown', { cancelable: true });
	Object.defineProperty(removed, 'key', { value: 'Escape' });
	target.dispatchEvent(removed);
	assert.equal(removed.defaultPrevented, false);
	assert.equal(ref.current, another.session);
	another.session.cancel();
});

function moveFixture(targets: readonly FloatingPanelPointerDropTarget[]) {
	const calls: unknown[] = [];
	const classes = new Set<string>();
	const element = {
		style: { left: '', top: '' },
		classList: { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name) },
	};
	const callbacks = {
		onDragStart: () => { calls.push('start'); },
		onDragEnd: () => { calls.push('end'); },
		onDock: (placement: unknown) => { calls.push(['dock', placement]); },
		getDropTargets: () => targets,
	};
	const session = new FloatingWorkspacePanelMove({
		panelId: 'playback-meter',
		element: element as unknown as HTMLElement,
		pointerId: 7,
		startClientX: 200,
		startClientY: 100,
		startGeometry: { x: 200, y: 100, width: 72, height: 520 },
		workspaceBounds: { width: 900, height: 800 },
		persist: (coordinates) => { calls.push(['persist', coordinates]); },
		docking: callbacks,
	});
	return { session, calls, classes, element, callbacks };
}
