/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import React, { act } from 'react';

import { ContextMenu } from '../vendor/audacity-design-system/components/src/ContextMenu/ContextMenu.tsx';
import { ContextMenuItem } from '../vendor/audacity-design-system/components/src/ContextMenuItem/ContextMenuItem.tsx';
import { installReactTestDom, type ReactTestElement } from './helpers/react-test-dom.ts';

test('Escape restores the menu trigger when focus has not moved elsewhere', async (context) => {
	const menu = await mountMenu(context);
	try {
		await menu.flushTimers();
		assert.equal(menu.focused(), menu.item);
		await menu.escape();
		await menu.flushTimers();
		assert.equal(menu.focused(), menu.trigger);
	} finally {
		await menu.dispose();
	}
});

test('Escape does not take focus back from the next menu trigger', async (context) => {
	const menu = await mountMenu(context);
	try {
		await menu.flushTimers();
		await menu.escape();
		menu.next.focus();
		await menu.flushTimers();
		assert.equal(menu.focused(), menu.next);
	} finally {
		await menu.dispose();
	}
});

test('Tab restores the trigger before letting the browser advance focus', async (context) => {
	const menu = await mountMenu(context);
	try {
		await menu.flushTimers();
		assert.equal(menu.focused(), menu.item);
		assert.equal(await menu.tab(), false, 'native Tab must remain available');
		assert.equal(menu.focused(), menu.trigger);
	} finally {
		await menu.dispose();
	}
});

test('closing a menu cancels its pending initial autofocus', async (context) => {
	const menu = await mountMenu(context);
	let focusCalls = 0;
	const focus = menu.item.focus.bind(menu.item);
	menu.item.focus = () => { focusCalls += 1; focus(); };
	try {
		await menu.close();
		menu.next.focus();
		await menu.flushTimers();
		assert.equal(focusCalls, 0);
		assert.equal(menu.focused(), menu.next);
	} finally {
		await menu.dispose();
	}
});

test('pending initial autofocus respects a newly focused control', async (context) => {
	const menu = await mountMenu(context);
	try {
		menu.next.focus();
		await menu.flushTimers();
		assert.equal(menu.focused(), menu.next);
	} finally {
		await menu.dispose();
	}
});

for (const role of ['menuitem', 'menuitemradio'] as const) test(`initial focus skips an unavailable leading ${role} and preserves Escape`, async context => {
	const menu = await mountMenu(context, role);
	try {
		await menu.flushTimers();
		assert.equal(menu.focused(), menu.item);
		await menu.escape();
		await menu.flushTimers();
		assert.equal(menu.focused(), menu.trigger);
	} finally {
		await menu.dispose();
	}
});

async function mountMenu(context: TestContext, disabledFirst?: 'menuitem' | 'menuitemradio'): Promise<{
	trigger: ReactTestElement;
	next: ReactTestElement;
	item: ReactTestElement;
	focused(): Element | null;
	close(): Promise<void>;
	escape(): Promise<void>;
	tab(): Promise<boolean>;
	flushTimers(): Promise<void>;
	dispose(): Promise<void>;
}> {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const ownerDocument = dom.container.ownerDocument as unknown as Document;
	const keyListeners = new Set<EventListenerOrEventListenerObject>();
	ownerDocument.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => {
		if (type === 'keydown' && listener) keyListeners.add(listener);
	};
	ownerDocument.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => {
		if (type === 'keydown' && listener) keyListeners.delete(listener);
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let open = false;
	const close = () => { open = false; root.render(render()); };
	const render = () => <>
		<button data-trigger="true">View</button>
		<button data-next="true">Panel menu</button>
		{open && <ContextMenu isOpen x={0} y={0} onClose={close}>
			{disabledFirst && <ContextMenuItem label="Unavailable" role={disabledFirst} disabled />}
			<button role="menuitem" data-enabled-item="true">Close</button>
		</ContextMenu>}
	</>;
	await act(async () => root.render(render()));
	const trigger = dom.one('[data-trigger="true"]');
	const next = dom.one('[data-next="true"]');
	trigger.focus();
	open = true;
	await act(async () => root.render(render()));
	const item = dom.one('[data-enabled-item="true"]');
	// The minimal DOM has attribute selectors; supply the menu's direct-child
	// selector so the real document keyboard listener can handle Escape.
	const menu = dom.one('[role="menu"]');
	menu.querySelectorAll = () => [item];
	return {
		trigger, next, item,
		focused: () => ownerDocument.activeElement,
		close: () => act(async () => close()),
		tab: async () => {
			let prevented = false;
			await act(async () => {
				const event = { key: 'Tab', preventDefault() { prevented = true; },
					stopPropagation() {}, stopImmediatePropagation() {} } as KeyboardEvent;
				for (const listener of [...keyListeners]) {
					if (typeof listener === 'function') listener(event);
					else listener.handleEvent(event);
				}
			});
			return prevented;
		},
		escape: () => act(async () => {
			const event = {
				key: 'Escape', preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {},
			} as KeyboardEvent;
			for (const listener of [...keyListeners]) {
				if (typeof listener === 'function') listener(event);
				else listener.handleEvent(event);
			}
		}),
		flushTimers: () => act(async () => context.mock.timers.tick(1)),
		dispose: async () => {
			await act(async () => root.unmount());
			context.mock.timers.reset();
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		},
	};
}
