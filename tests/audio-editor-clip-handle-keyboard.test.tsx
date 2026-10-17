/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installReactTestDom } from './helpers/react-test-dom.ts';
import { routeClipHandleKeyboard, clipInteractionOwnsKey } from '../src/common/editor/ui/timeline/clip-handle-keyboard.ts';

type Ports = Parameters<typeof routeClipHandleKeyboard>[1];
type Event = Parameters<typeof routeClipHandleKeyboard>[0];
const clip = { id: 'one', kind: 'audio', timelineStartFrame: 0, durationFrames: 48_000, fadeInFrames: 12_000, fadeOutFrames: 0, fadeInShape: 2 };

async function mounted(check: (dom: ReturnType<typeof installReactTestDom>, ports: Ports, calls: unknown[]) => void): Promise<void> {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const calls: unknown[] = [];
	const ports: Ports = { clips: [clip, { ...clip, id: 'two', timelineStartFrame: 96_000 }], sampleRate: 48_000,
		blocked: false, selectedIds: ['one'], playheadFrame: 36_000,
		updateFade: (id, changes) => calls.push({ id, changes }),
		trim: (id, edge, seconds) => calls.push({ id, edge, seconds, kind: 'trim' }),
		stretch: (id, edge, seconds) => calls.push({ id, edge, seconds, kind: 'stretch' }),
		seek: frame => calls.push({ seek: frame }), openFades: id => calls.push({ dialog: id }),
	};
	try {
		await act(async () => root.render(<div data-clip-id="one" tabIndex={0}>
			<button data-clip-indicator="pitch" />
			<button data-clip-fade-handle="in" tabIndex={-1} /><button data-clip-fade-handle="out" tabIndex={-1} />
			{(['trim', 'stretch'] as const).flatMap(kind => (['left', 'right'] as const).map(edge => <button key={`${kind}-${edge}`} tabIndex={-1} className={`clip-display__handle clip-display__handle--${kind}-${edge}`} />))}
			<input />
		</div>));
		await act(async () => check(dom, ports, calls));
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = previous;
		dom.restore();
	}
}

function key(target: EventTarget, key: string, changes: Partial<Event> = {}): Event {
	return { target, key, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
		preventDefault() {}, stopPropagation() {}, ...changes };
}

test('F starts at the fade nearest the playhead, cycles the other edge, then returns to the clip', async () => {
	await mounted((dom, ports, calls) => {
		const clipElement = dom.one('[data-clip-id]');
		assert.equal(routeClipHandleKeyboard(key(clipElement as unknown as EventTarget, 'f'), ports), true);
		assert.equal(dom.container.ownerDocument.activeElement, dom.one('[data-clip-fade-handle="out"]'));
		routeClipHandleKeyboard(key(dom.container.ownerDocument.activeElement as unknown as EventTarget, 'f'), ports);
		assert.equal(dom.container.ownerDocument.activeElement, dom.one('[data-clip-fade-handle="in"]'));
		routeClipHandleKeyboard(key(dom.container.ownerDocument.activeElement as unknown as EventTarget, 'f'), ports);
		assert.equal(dom.container.ownerDocument.activeElement, clipElement);
		assert.deepEqual(calls, []);
	});
});

test('handle arrows edit their named edge and Delete removes a fade without deleting the clip', async () => {
	await mounted((dom, ports, calls) => {
		const target = dom.one('[data-clip-fade-handle="in"]') as unknown as EventTarget;
		routeClipHandleKeyboard(key(target, 'ArrowRight'), ports);
		assert.deepEqual(calls.pop(), { id: 'one', changes: { fadeInFrames: 16_800 } });
		routeClipHandleKeyboard(key(target, 'Delete'), ports);
		assert.deepEqual(calls.pop(), { id: 'one', changes: { fadeInFrames: 0 } });
		routeClipHandleKeyboard(key(target, 't'), ports);
		assert.equal(dom.container.ownerDocument.activeElement, dom.one('.clip-display__handle--trim-left'));
		routeClipHandleKeyboard(key(dom.container.ownerDocument.activeElement as unknown as EventTarget, 'ArrowRight', { shiftKey: true }), ports);
		assert.deepEqual(calls.pop(), { id: 'one', edge: 'left', seconds: 1, kind: 'trim' });
	});
});

test('cursor edits target the clip under the cursor and direct clip shortcuts seek the focused clip', async () => {
	await mounted((dom, ports, calls) => {
		const target = dom.one('[data-clip-id]') as unknown as EventTarget;
		routeClipHandleKeyboard(key(target, 't', { altKey: true }), { ...ports, playheadFrame: 108_000 });
		assert.deepEqual(calls.pop(), { id: 'two', edge: 'left', seconds: 0.25, kind: 'trim' });
		routeClipHandleKeyboard(key(target, 'f', { altKey: true, shiftKey: true }), ports);
		assert.deepEqual(calls.pop(), { dialog: 'one' });
		routeClipHandleKeyboard(key(target, ']', { ctrlKey: true }), ports);
		assert.deepEqual(calls.pop(), { seek: 48_000 });
		routeClipHandleKeyboard(key(target, 'Enter'), ports);
		assert.deepEqual(calls.pop(), { seek: 0 });
	});
});

test('Enter leaves clip indicator buttons available for their native activation', async () => {
	await mounted((dom, ports, calls) => {
		const target = dom.one('[data-clip-indicator]') as unknown as EventTarget;
		let prevented = false;
		assert.equal(routeClipHandleKeyboard(key(target, 'Enter', { preventDefault: () => { prevented = true; } }), ports), false);
		assert.equal(prevented, false);
		assert.deepEqual(calls, []);
	});
});

test('IME, editable inputs, modified keys and locked clips retain their owning behavior', async () => {
	await mounted((dom, ports, calls) => {
		const target = dom.one('[data-clip-id]') as unknown as EventTarget;
		assert.equal(routeClipHandleKeyboard(key(target, 'f', { isComposing: true }), ports), false);
		assert.equal(routeClipHandleKeyboard(key(dom.one('input') as unknown as EventTarget, 'f'), ports), false);
		assert.equal(clipInteractionOwnsKey(key(target, 's')), true);
		assert.equal(clipInteractionOwnsKey(key(target, 's', { shiftKey: true })), false);
		routeClipHandleKeyboard(key(target, 'f'), { ...ports, blocked: true });
		assert.deepEqual(calls, []);
	});
});


test('F skips a fade edge owned by an automatic crossfade and returns to the clip', async () => {
	await mounted((dom, ports) => {
		const clipElement = dom.one('[data-clip-id]');
		const outgoing = dom.one('[data-clip-fade-handle="out"]') as unknown as HTMLButtonElement;
		outgoing.disabled = true;
		assert.equal(routeClipHandleKeyboard(key(clipElement as unknown as EventTarget, 'f'), ports), true);
		assert.equal(dom.container.ownerDocument.activeElement, dom.one('[data-clip-fade-handle="in"]'));
		routeClipHandleKeyboard(key(dom.container.ownerDocument.activeElement as unknown as EventTarget, 'f'), ports);
		assert.equal(dom.container.ownerDocument.activeElement, clipElement);
	});
});
