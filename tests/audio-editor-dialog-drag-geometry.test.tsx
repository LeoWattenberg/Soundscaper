/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import AudioEditorDialogShell from '../src/common/editor/ui/AudioEditorDialogShell.tsx';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

test('a mounted moving dialog clamps against the body geometry that actually settled', async () => {
	const fixture = await mount();
	try {
		await fixture.start(); await fixture.move(1, 1);
		assert.equal(fixture.header.getBoundingClientRect().top, 8);
		await fixture.settleBody(); // Suspense changes the centered panel before the next mouse event.
		await fixture.move(1, 1);
		fixture.assertReachable();
	} finally { await fixture.close(); }
});

test('late suspended content cannot hide the header after its drag already finished', async () => {
	const fixture = await mount();
	try {
		await fixture.start(); await fixture.move(1, 1); await fixture.finish();
		await fixture.settleBody(); await fixture.notifyResize();
		fixture.assertReachable();
	} finally { await fixture.close(); }
});

test('a dragged mounted header remains reachable when the viewport shrinks', async () => {
	const fixture = await mount();
	try {
		await fixture.settleBody(); await fixture.start(); await fixture.move(10_000, 1); await fixture.finish();
		await fixture.resizeViewport(900, 400);
		fixture.assertReachable();
	} finally { await fixture.close(); }
});

test('geometry reconciliation preserves Escape restoration and releases stale observer work', async () => {
	const fixture = await mount();
	try {
		await fixture.start(); await fixture.move(1, 1); await fixture.settleBody(); await fixture.notifyResize();
		await fixture.escape();
		assert.deepEqual(fixture.position(), { x: 0, y: 0 });
		assert.equal(fixture.dismissals(), 0);
		await fixture.move(1000, 1000); await fixture.finish();
		assert.deepEqual(fixture.position(), { x: 0, y: 0 });
		await fixture.escape(); assert.equal(fixture.dismissals(), 1);
		await fixture.close();
		const settled = fixture.position();
		await fixture.notifyResize(); await fixture.resizeViewport(900, 400); await fixture.move(1, 1);
		assert.deepEqual(fixture.position(), settled);
	} finally { await fixture.close(); }
});

/** The maintained DOM has no layout. Derive the header's box from the actual
 * mounted Suspense content, viewport and rendered transform, as centered CSS
 * grid layout does. Events drive the real shell; no expected clamp is mocked. */
async function mount() {
	const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
	const documentEvents = new EventTarget(), windowEvents = new EventTarget();
	Object.assign(document, { addEventListener: documentEvents.addEventListener.bind(documentEvents),
		removeEventListener: documentEvents.removeEventListener.bind(documentEvents) });
	const viewport = window;
	Object.assign(viewport, { innerWidth: 1280, innerHeight: 720,
		addEventListener: windowEvents.addEventListener.bind(windowEvents), removeEventListener: windowEvents.removeEventListener.bind(windowEvents) });
	const priorBox = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getBoundingClientRect')!;
	Object.defineProperty(ReactTestElement.prototype, 'getBoundingClientRect', { configurable: true,
		value(this: ReactTestElement) {
			const panel = this.closest('.audio-editor-controlled-dialog');
			if (!panel || !this.getAttribute('class')?.split(' ').includes('dialog-header')) return Reflect.apply(priorBox.value as (this: ReactTestElement) => object, this, []);
			const body = panel.querySelector('[data-layout-height]');
			const height = 28 + Number(body?.getAttribute('data-layout-height') ?? 0);
			const offset = position(panel), width = 620;
			const left = (window.innerWidth - width) / 2 + offset.x, top = (window.innerHeight - height) / 2 + offset.y;
			return { x: left, y: top, left, right: left + width, top, bottom: top + 28, width, height: 28 };
		} });
	const callbacks: ResizeObserverCallback[] = [];
	const priorObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
	class GeometryObserver {
		constructor(callback: ResizeObserverCallback) { callbacks.push(callback); }
		observe() {} unobserve() {} disconnect() {}
	}
	Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: GeometryObserver });
	Object.assign(window, { ResizeObserver: GeometryObserver });
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT; actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	let resolveBody!: (value: { default: () => React.JSX.Element }) => void;
	const Body = lazy(() => new Promise<{ default: () => React.JSX.Element }>(resolve => { resolveBody = resolve; }));
	let dismissals = 0, closed = false;
	await act(async () => root.render(<AudioEditorDialogShell title="Reverb" draggable modal={false} onClose={() => { dismissals++; }}>
		<Suspense fallback={<div data-layout-height="100">Loading</div>}><Body /></Suspense>
	</AudioEditorDialogShell>));
	const header = dom.one('.dialog-header'), panel = dom.one('[role="dialog"]');
	return {
		header, position: () => position(panel), dismissals: () => dismissals,
		async start() { const box = header.getBoundingClientRect(); await act(async () => reactProps(header).onMouseDown({
			button: 0, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2,
			target: header, currentTarget: header, preventDefault() {},
		})); },
		async move(clientX: number, clientY: number) { await act(async () => { windowEvents.dispatchEvent(Object.assign(new Event('mousemove'), { clientX, clientY })); }); },
		async finish() { await act(async () => { windowEvents.dispatchEvent(new Event('mouseup')); }); },
		async escape() { await act(async () => { documentEvents.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' })); }); },
		async settleBody() { await act(async () => { resolveBody({ default: () => <div data-layout-height="160">Actual effect controls</div> }); }); },
		async notifyResize() { await act(async () => { for (const callback of callbacks) callback([], {} as ResizeObserver); }); },
		async resizeViewport(width: number, height: number) { Object.assign(viewport, { innerWidth: width, innerHeight: height });
			await act(async () => { windowEvents.dispatchEvent(new Event('resize')); }); },
		assertReachable() {
			const box = header.getBoundingClientRect();
			assert.ok(box.top >= 8, `Header top ${box.top} is outside the viewport.`);
			assert.ok(box.bottom <= window.innerHeight - 8);
			assert.ok(box.left >= 8); assert.ok(box.right <= window.innerWidth - 8);
		},
		async close() {
			if (closed) return; closed = true;
			await act(async () => { root.unmount(); });
			Object.defineProperty(ReactTestElement.prototype, 'getBoundingClientRect', priorBox);
			if (priorObserver) Object.defineProperty(globalThis, 'ResizeObserver', priorObserver); else Reflect.deleteProperty(globalThis, 'ResizeObserver');
			dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		},
	};
}

function position(panel: ReactTestElement) {
	const match = /^translate\(([-\d.]+)px, ([-\d.]+)px\)$/u.exec((panel.style as unknown as { transform: string }).transform);
	assert.ok(match, 'Mounted shell has no drag transform.');
	return { x: Number(match[1]), y: Number(match[2]) };
}
