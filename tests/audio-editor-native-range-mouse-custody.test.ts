/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { retainNativeRangeMouseCustody } from '../src/common/editor/controller/effects/native-range-mouse-custody.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('native mouse custody detaches before reentrant completion and does not prevent input', () => {
	withDocument(f => {
		let completed = 0;
		const dispose = retainNativeRangeMouseCustody(document, 1, {
			finish: () => { completed++; f.emit('pointerup', 1, 'mouse', 0, 0); }, cancel: () => assert.fail('Unexpected cancellation'),
		});
		assert.equal(f.listenerCount(), 3);
		const event = f.emit('pointermove', 1, 'mouse', -1, 1);
		assert.equal(event.defaultPrevented, false); assert.equal(completed, 0);
		f.emit('pointerup', 2, 'mouse', 0, 0); f.emit('pointercancel', 1, 'touch', 0, 0);
		assert.equal(completed, 0);
		f.emit('pointerup', 1, 'mouse', 0, 0);
		assert.equal(completed, 1); assert.equal(f.listenerCount(), 0);
		dispose(); dispose(); assert.equal(completed, 1);
	});
});

test('native mouse custody can retain a stricter primary transition owner', () => {
	withDocument(f => {
		let completed = 0, canceled = 0;
		retainNativeRangeMouseCustody(document, 1, { finish: () => { completed++; }, cancel: () => { canceled++; },
			releasesPrimaryMove: event => event.button === 0 && (event.buttons & 1) === 0 });
		f.emit('pointermove', 1, 'mouse', -1, 4); assert.equal(completed, 0);
		f.emit('pointermove', 1, 'mouse', 0, 4); assert.equal(completed, 1);
		f.emit('pointercancel', 1, 'mouse', 0, 0); assert.equal(canceled, 0);
		assert.equal(f.listenerCount(), 0);
	});
});

test('native mouse custody cancellation and disposal retire only their own lease', () => {
	withDocument(f => {
		let canceled = 0;
		const first = retainNativeRangeMouseCustody(document, 1, { finish: () => assert.fail('Disposed lease published'), cancel: () => { canceled++; } });
		retainNativeRangeMouseCustody(document, 2, { finish: () => assert.fail('Cancel must not finish'), cancel: () => { canceled++; } });
		first(); first(); assert.equal(f.listenerCount(), 3);
		f.emit('pointerup', 1, 'mouse', 0, 0); assert.equal(canceled, 0);
		f.emit('pointercancel', 2, 'mouse', 0, 0);
		assert.equal(canceled, 1); assert.equal(f.listenerCount(), 0);
	});
});

function withDocument(run: (fixture: Readonly<{
	emit(kind: string, pointerId: number, pointerType: string, button: number, buttons: number): Event;
	listenerCount(): number;
}>) => void): void {
	const dom = installReactTestDom();
	const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
	Object.defineProperties(document, {
		addEventListener: { configurable: true, value: (kind: string, listener: EventListenerOrEventListenerObject, capture: boolean): void => {
			assert.equal(capture, true);
			const set = listeners.get(kind) ?? new Set(); set.add(listener); listeners.set(kind, set);
		} },
		removeEventListener: { configurable: true, value: (kind: string, listener: EventListenerOrEventListenerObject, capture: boolean): void => {
			assert.equal(capture, true); listeners.get(kind)?.delete(listener);
		} },
	});
	try {
		run({ listenerCount: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
			emit: (kind, pointerId, pointerType, button, buttons) => {
				const event = new Event(kind, { cancelable: true });
				Object.defineProperties(event, { pointerId: { value: pointerId }, pointerType: { value: pointerType }, button: { value: button }, buttons: { value: buttons } });
				for (const listener of [...(listeners.get(kind) ?? [])]) {
					if (typeof listener === 'function') listener(event); else listener.handleEvent(event);
				}
				return event;
			},
		});
	} finally { dom.restore(); }
}
