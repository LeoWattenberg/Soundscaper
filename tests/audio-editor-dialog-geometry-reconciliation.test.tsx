/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, type MouseEvent as ReactMouseEvent } from 'react';
import { createRoot } from 'react-dom/client';
import AudioEditorDialogShell from '../src/common/editor/ui/AudioEditorDialogShell.tsx';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

interface GeometryFixture {
	readonly header: ReactTestElement;
	readonly windowEvents: EventTarget;
	readonly documentEvents: EventTarget;
	begin(): void;
	move(x: number, y: number): void;
	viewportHeight(height: number): void;
	bodyHeight(height: number): void;
	position(): Readonly<{ x: number; y: number }>;
}

async function withDialog(operation: (fixture: GeometryFixture) => Promise<void>): Promise<void> {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const originalBounds = ReactTestElement.prototype.getBoundingClientRect;
	const originalObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
	const windowEvents = new EventTarget(), documentEvents = new EventTarget();
	window.addEventListener = windowEvents.addEventListener.bind(windowEvents);
	window.removeEventListener = windowEvents.removeEventListener.bind(windowEvents);
	document.addEventListener = documentEvents.addEventListener.bind(documentEvents);
	document.removeEventListener = documentEvents.removeEventListener.bind(documentEvents);
	let viewportHeight = 720, bodyHeight = 219;
	Object.assign(window, { innerWidth: 1280, innerHeight: viewportHeight });
	const observers = new Set<() => void>();
	class Observer {
		constructor(private readonly callback: () => void) {}
		observe(): void { observers.add(this.callback); }
		disconnect(): void { observers.delete(this.callback); }
	}
	Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: Observer });
	ReactTestElement.prototype.getBoundingClientRect = function () {
		const panel = this.closest('[role="dialog"]');
		if (!panel) return originalBounds.call(this);
		const transform: unknown = Reflect.get(panel.style, 'transform');
		const offset = typeof transform === 'string' ? /translate\(([-\d.]+)px, ([-\d.]+)px\)/u.exec(transform) : null;
		const isHeader = this === panel.querySelector('.dialog-header');
		const x = 330 + Number(offset?.[1] ?? 0) + (isHeader ? 1 : 0);
		const y = (viewportHeight - bodyHeight) / 2 + Number(offset?.[2] ?? 0) + (isHeader ? 1 : 0);
		const width = isHeader ? 618 : 620, height = isHeader ? 28 : bodyHeight;
		return { x, y, left: x, right: x + width, top: y, bottom: y + height, width, height };
	};
	const root = createRoot(dom.container as unknown as HTMLElement);
	try {
		await act(async () => { root.render(<AudioEditorDialogShell title="Reverb" draggable modal={false}>
			<button type="button">Decay</button>
		</AudioEditorDialogShell>); });
		const header = dom.one('.dialog-header');
		await operation({ header, windowEvents, documentEvents,
			begin() {
				const bounds = header.getBoundingClientRect();
				reactProps(header).onMouseDown!({ button: 0, target: header, currentTarget: header,
					clientX: bounds.left! + bounds.width! / 2, clientY: bounds.top! + bounds.height! / 2,
					preventDefault() {},
				} as unknown as ReactMouseEvent<Element>);
			},
			move(x, y) { windowEvents.dispatchEvent(Object.assign(new Event('mousemove'), { clientX: x, clientY: y })); },
			viewportHeight(height) {
				viewportHeight = height; Object.assign(window, { innerHeight: height });
				windowEvents.dispatchEvent(new Event('resize'));
			},
			bodyHeight(height) { bodyHeight = height; observers.forEach(notify => { notify(); }); },
			position() { const bounds = header.getBoundingClientRect(); return { x: bounds.x!, y: bounds.y! }; },
		});
		await act(async () => { root.unmount(); });
		assert.equal(observers.size, 0, 'unmount releases the geometry observer');
	} finally {
		await act(async () => { root.unmount(); });
		ReactTestElement.prototype.getBoundingClientRect = originalBounds;
		if (originalObserver) Object.defineProperty(globalThis, 'ResizeObserver', originalObserver);
		else Reflect.deleteProperty(globalThis, 'ResizeObserver');
		dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
}

for (const change of ['browser viewport', 'dialog body'] as const) {
	test(`a completed dialog move keeps its header reachable after the ${change} changes`, async () => {
		await withDialog(async fixture => {
			if (change === 'dialog body') await act(async () => { fixture.bodyHeight(160); });
			await act(async () => { fixture.begin(); fixture.move(1, 1); });
			await act(async () => { fixture.windowEvents.dispatchEvent(new Event('mouseup')); });
			assert.deepEqual(fixture.position(), { x: 8, y: 8 });
			await act(async () => {
				if (change === 'browser viewport') fixture.viewportHeight(661);
				else fixture.bodyHeight(219);
			});
			assert.deepEqual(fixture.position(), { x: 8, y: 8 });
			await act(async () => { fixture.bodyHeight(219); });
			assert.deepEqual(fixture.position(), { x: 8, y: 8 }, 'repeated geometry publication must not overcorrect');
		});
	});
}

test('body growth during a title move preserves its pointer anchor and Escape restores the original offset', async () => {
	await withDialog(async fixture => {
		await act(async () => { fixture.begin(); fixture.move(640, 280); });
		assert.equal(fixture.position().y, 266);
		await act(async () => { fixture.bodyHeight(278); fixture.move(640, 300); });
		assert.equal(fixture.position().y, 286, 'the same title point remains under the pointer after body growth');
		await act(async () => { fixture.documentEvents.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' })); });
		assert.deepEqual(fixture.position(), { x: 331, y: 222 });
		await act(async () => { fixture.move(1, 1); fixture.windowEvents.dispatchEvent(new Event('mouseup')); });
		assert.deepEqual(fixture.position(), { x: 331, y: 222 }, 'release cannot finish a canceled drag');
	});
});
