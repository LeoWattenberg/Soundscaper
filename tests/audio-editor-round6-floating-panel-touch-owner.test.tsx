/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useRef } from 'react';
import { useFloatingWorkspacePanelMove } from '../src/common/editor/ui/workspace/useFloatingWorkspacePanelMove.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('a mounted floating move retains its first pointer and publishes its completed position', async () => {
	const dom = installReactTestDom();
	const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = environment.IS_REACT_ACT_ENVIRONMENT;
	environment.IS_REACT_ACT_ENVIRONMENT = true;
	const native = new EventTarget();
	window.addEventListener = native.addEventListener.bind(native);
	window.removeEventListener = native.removeEventListener.bind(native);
	const persisted: Readonly<{ x: number; y: number }>[] = [];
	const captures: number[] = [];
	function Harness() {
		const dockRef = useRef<HTMLDivElement>(null);
		const resizeSessionRef = useRef<unknown>(null);
		const begin = useFloatingWorkspacePanelMove({
			dock: 'floating', dockRef, resizeSessionRef,
			controller: { actions: { preferences: { setPanel(_id, coordinates) { persisted.push(coordinates); } } } },
			run: operation => operation(), setActiveFloatingPanelId() {},
			onPanelDragStart() {}, onPanelDragEnd() {}, onPanelMove() {},
		});
		return <div ref={dockRef} data-floating-dock><div data-workspace-panel="markers">
			<div data-floating-handle onPointerDown={event => begin(event, 'markers')}>Markers</div>
		</div></div>;
	}
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Harness />));
		const dock = dom.one('[data-floating-dock]');
		const panel = dom.one('[data-workspace-panel]');
		const handle = dom.one('[data-floating-handle]');
		const style = (panel as unknown as HTMLElement).style;
		style.left = '100px'; style.top = '100px';
		Object.defineProperty(dock, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 1000, height: 800 }) });
		Object.defineProperty(panel, 'getBoundingClientRect', { value: () => ({
			left: parseFloat(style.left), top: parseFloat(style.top), width: 300, height: 200,
		}) });
		Object.defineProperty(panel, 'classList', { value: { add() {}, remove() {} } });
		Object.defineProperty(handle, 'setPointerCapture', { value: (id: number) => captures.push(id) });
		const begin = async (pointerId: number, clientX: number, isPrimary: boolean) => {
			await act(async () => reactProps(handle).onPointerDown({
				button: 0, pointerId, clientX, clientY: 100, isPrimary,
				target: handle, currentTarget: handle, preventDefault() {},
			}));
		};
		const move = (type: string, pointerId: number, clientX: number) => {
			const event = new Event(type, { cancelable: true });
			Object.defineProperties(event, { pointerId: { value: pointerId }, clientX: { value: clientX }, clientY: { value: 100 } });
			native.dispatchEvent(event);
		};
		await begin(1, 100, true);
		move('pointermove', 1, 110);
		assert.equal(style.left, '110px', 'the first native pointer moves normally');
		await begin(2, 110, false);
		assert.deepEqual(captures, [1], 'a second touch cannot replace the owning pointer');
		assert.equal(style.left, '110px');
		move('pointermove', 1, 120);
		move('pointerup', 2, 110);
		assert.deepEqual(persisted, []);
		move('pointerup', 1, 120);
		assert.deepEqual(persisted, [{ x: 120, y: 100 }]);
		await begin(3, 120, true);
		move('pointermove', 3, 130); move('pointerup', 3, 130);
		assert.deepEqual(persisted, [{ x: 120, y: 100 }, { x: 130, y: 100 }]);
	} finally {
		await act(async () => root.unmount());
		environment.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
