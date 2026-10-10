/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ParametricEqOutputRange } from '../src/common/editor/ui/ParametricEqOutputRange.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

interface Fixture {
	send(handler: string, event?: Readonly<Record<string, unknown>>): Promise<void>;
	documentEvent(kind: string, event?: Readonly<Record<string, unknown>>): Promise<void>;
	unmount(): Promise<void>;
	readonly captures: number[];
	readonly commits: number[];
	readonly cancellations: number[];
	value(): number;
}

test('Parametric native mouse range leaves the browser thumb uncaptured', async () => {
	await withRange(async f => {
		await begin(f);
		assert.deepEqual(f.captures, [], 'DOM capture prevents WebKit from producing native range input.');
		await change(f, 6);
		await f.send('onPointerUp', { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 0 });
		assert.deepEqual(f.commits, [6]);
	});
});

for (const kind of ['pointerup', 'pointermove'] as const) test(`Parametric native mouse range completes outside at ${kind}`, async () => {
	await withRange(async f => {
		await begin(f); await change(f, 6);
		await f.documentEvent(kind, { pointerId: 1, pointerType: 'mouse', button: 0, buttons: kind === 'pointermove' ? 4 : 0 });
		assert.deepEqual(f.commits, [6]);
		await f.documentEvent('pointermove', { pointerId: 1, pointerType: 'mouse', button: -1, buttons: 4 });
		await f.documentEvent('pointerup', { pointerId: 1, pointerType: 'mouse', button: 1, buttons: 0 });
		assert.deepEqual(f.commits, [6], 'Later auxiliary events cannot publish again.');
		assert.deepEqual(f.cancellations, []);
		await begin(f, 2); await change(f, 8);
		await f.documentEvent('pointerup', { pointerId: 2, pointerType: 'mouse', button: 0, buttons: 0 });
		assert.deepEqual(f.commits, [6, 8], 'The next normal gesture remains available.');
	});
});

test('Parametric mouse custody ignores other contacts and held primary motion', async () => {
	await withRange(async f => {
		await begin(f); await change(f, 4);
		await f.documentEvent('pointermove', { pointerId: 1, pointerType: 'mouse', button: -1, buttons: 5 });
		await f.documentEvent('pointerup', { pointerId: 2, pointerType: 'mouse', button: 0, buttons: 0 });
		await f.documentEvent('pointercancel', { pointerId: 2, pointerType: 'touch', buttons: 0 });
		assert.deepEqual(f.commits, []); assert.deepEqual(f.cancellations, []);
		await change(f, 6);
		await f.documentEvent('pointerup', { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 0 });
		assert.deepEqual(f.commits, [6]);
	});
});

test('Parametric outside mouse cancellation restores the gesture start', async () => {
	await withRange(async f => {
		await begin(f); await change(f, 6);
		await f.documentEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', buttons: 0 });
		assert.deepEqual(f.cancellations, [0]); assert.equal(f.value(), 0);
		await f.documentEvent('pointerup', { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 0 });
		assert.deepEqual(f.commits, []);
	});
});

test('Parametric removed range retires outside mouse custody without publishing', async () => {
	await withRange(async f => {
		await begin(f); await change(f, 6); await f.unmount();
		await f.documentEvent('pointerup', { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 0 });
		await f.documentEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', buttons: 0 });
		assert.deepEqual(f.commits, []); assert.deepEqual(f.cancellations, []);
	});
});

test('Parametric touch keeps explicit capture and foreign cancellation protection', async () => {
	await withRange(async f => {
		await begin(f, 7, 'touch'); await change(f, 6);
		assert.deepEqual(f.captures, [7]);
		await f.send('onPointerCancel', { pointerId: 8, pointerType: 'touch' });
		await f.documentEvent('pointerup', { pointerId: 7, pointerType: 'touch', button: 0, buttons: 0 });
		assert.deepEqual(f.commits, []); assert.deepEqual(f.cancellations, []);
		await f.send('onPointerUp', { pointerId: 7, pointerType: 'touch', button: 0, buttons: 0 });
		assert.deepEqual(f.commits, [6]);
	});
});

test('Parametric keyboard accepted values finish once without mouse capture', async () => {
	await withRange(async f => {
		await f.send('onKeyDown', { key: 'ArrowRight' }); await change(f, .1);
		await f.send('onKeyUp', { key: 'ArrowRight' });
		await f.send('onBlur');
		assert.deepEqual(f.commits, [.1]); assert.deepEqual(f.captures, []);
	});
});

async function begin(f: Fixture, pointerId = 1, pointerType = 'mouse'): Promise<void> {
	await f.send('onPointerDown', { pointerId, pointerType, button: 0, buttons: 1, isPrimary: true, preventDefault() {} });
}
async function change(f: Fixture, value: number): Promise<void> {
	await f.send('onChange', { currentTarget: { value: String(value) } });
}

async function withRange(run: (fixture: Fixture) => Promise<void>): Promise<void> {
	const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
	const saved = new Map<string, PropertyDescriptor | undefined>();
	for (const [key, value] of Object.entries({ React, IS_REACT_ACT_ENVIRONMENT: true })) {
		saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
	}
	const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
	const documentProperties = new Map<string, PropertyDescriptor | undefined>();
	for (const [key, value] of Object.entries({
		addEventListener: (kind: string, listener: EventListenerOrEventListenerObject | null): void => {
			if (!listener) return;
			const set = listeners.get(kind) ?? new Set(); set.add(listener); listeners.set(kind, set);
		},
		removeEventListener: (kind: string, listener: EventListenerOrEventListenerObject | null): void => {
			if (listener) listeners.get(kind)?.delete(listener);
		},
	})) {
		documentProperties.set(key, Object.getOwnPropertyDescriptor(document, key));
		Object.defineProperty(document, key, { configurable: true, value });
	}
	let value = 0, start: number | null = null, mounted = true;
	const captures: number[] = [], commits: number[] = [], cancellations: number[] = [];
	const render = (): void => root.render(<ParametricEqOutputRange disabled={false} value={value} minimum={-24} maximum={24}
		onBegin={() => { start ??= value; }} onValueChange={next => { value = next; render(); }}
		onFinish={() => { if (start !== null) { commits.push(value); start = null; } }}
		onCancel={() => { if (start !== null) { value = start; cancellations.push(start); start = null; render(); } }} onReset={() => undefined} />);
	try {
		await act(async () => render());
		const input = dom.one('input');
		Object.defineProperty(input, 'setPointerCapture', { value: (id: number): void => { captures.push(id); } });
		await run({ captures, commits, cancellations, value: () => value,
			send: async (handler, event = {}) => { await act(async () => reactProps(input)[handler]?.({ currentTarget: input, ...event })); },
			documentEvent: async (kind, fields = {}) => { await act(async () => {
				const event = new Event(kind); Object.defineProperties(event, Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, { value }])));
				for (const listener of [...(listeners.get(kind) ?? [])]) {
					if (typeof listener === 'function') listener(event); else listener.handleEvent(event);
				}
			}); },
			unmount: async () => { await act(async () => root.unmount()); mounted = false; },
		});
	} finally {
		if (mounted) await act(async () => root.unmount());
		for (const [key, descriptor] of documentProperties) {
			if (descriptor) Object.defineProperty(document, key, descriptor); else Reflect.deleteProperty(document, key);
		}
		for (const [key, descriptor] of saved) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
		}
		dom.restore();
	}
}
