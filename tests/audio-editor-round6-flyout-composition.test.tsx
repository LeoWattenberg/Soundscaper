/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import React, { act, useRef, useState } from 'react';

import { Flyout } from '../vendor/audacity-design-system/components/src/Flyout/Flyout.tsx';
import { installReactTestDom, type ReactTestDom } from './helpers/react-test-dom.ts';

interface Fixture {
	readonly dom: ReactTestDom;
	readonly listeners: Set<EventListenerOrEventListenerObject>;
	readonly closed: () => number;
	readonly key: (name: string, isComposing: boolean) => Promise<number>;
}

async function withFlyout(context: TestContext, closeOnEscape: boolean,
	run: (fixture: Fixture) => Promise<void>): Promise<void> {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	const dom = installReactTestDom();
	Object.assign(window, { innerWidth: 1024, innerHeight: 768 });
	const owner = dom.container.ownerDocument as unknown as Document;
	const listeners = new Set<EventListenerOrEventListenerObject>();
	owner.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => { if (type === 'keydown' && listener) listeners.add(listener); };
	owner.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => { if (type === 'keydown' && listener) listeners.delete(listener); };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	let closes = 0;
	function Control() {
		const [open, setOpen] = useState(true);
		const triggerRef = useRef<HTMLButtonElement>(null);
		return <><button ref={triggerRef} data-trigger>Open</button>
			<Flyout isOpen={open} x={100} y={100} closeOnOutsideClick={false}
				closeOnEscape={closeOnEscape} triggerRef={triggerRef as React.RefObject<HTMLElement>}
				onClose={() => { closes += 1; setOpen(false); }}>
				<input type="search" defaultValue="とう" data-search />
			</Flyout></>;
	}
	try {
		await act(async () => { root.render(<Control />); });
		dom.one('[data-search]').focus();
		await run({ dom, listeners, closed: () => closes, key: async (name, isComposing) => {
			let stopped = 0;
			const event = { key: name, isComposing, stopPropagation: () => { stopped += 1; } } as KeyboardEvent;
			await act(async () => {
				for (const listener of [...listeners]) {
					if (typeof listener === 'function') listener(event);
					else listener.handleEvent(event);
				}
				context.mock.timers.runAll();
			});
			return stopped;
		} });
	} finally {
		await act(async () => { root.unmount(); });
		assert.equal(listeners.size, 0);
		context.mock.timers.reset();
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
}

test('shared flyout leaves native composing Escape with the unfinished search', async context => {
	await withFlyout(context, true, async ({ dom, key, closed }) => {
		const search = dom.one('[data-search]');
		assert.equal(await key('Escape', true), 0);
		assert.equal(closed(), 0);
		assert.equal(search.isConnected, true);
		assert.equal(search.value, 'とう');
		assert.equal(search.ownerDocument.activeElement === search, true);
	});
});

test('shared flyout retains completed Escape, trigger focus and listener cleanup', async context => {
	await withFlyout(context, true, async ({ dom, listeners, key, closed }) => {
		const search = dom.one('[data-search]');
		assert.equal(await key('Escape', false), 1);
		assert.equal(closed(), 1);
		assert.equal(search.isConnected, false);
		assert.equal(listeners.size, 0);
		assert.equal(dom.container.ownerDocument.activeElement === dom.one('[data-trigger]'), true);
	});
});

test('shared flyout retains unrelated keys and disabled Escape dismissal', async context => {
	await withFlyout(context, true, async ({ key, closed }) => {
		assert.equal(await key('Enter', false), 0);
		assert.equal(closed(), 0);
	});
	await withFlyout(context, false, async ({ listeners, key, closed }) => {
		assert.equal(listeners.size, 0);
		assert.equal(await key('Escape', false), 0);
		assert.equal(closed(), 0);
	});
});
