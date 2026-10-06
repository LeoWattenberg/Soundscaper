/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ContextMenu } from '../vendor/audacity-design-system/components/src/ContextMenu/ContextMenu.tsx';
import { ContextMenuItem } from '../vendor/audacity-design-system/components/src/ContextMenuItem/ContextMenuItem.tsx';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

test('radio menu items expose their checked state without changing ordinary menu items', () => {
	const selected = renderToStaticMarkup(<ContextMenuItem label="Linear" role="menuitemradio" checked />);
	const unselected = renderToStaticMarkup(<ContextMenuItem label="Logarithmic" role="menuitemradio" checked={false} />);
	const unspecified = renderToStaticMarkup(<ContextMenuItem label="Exponential" role="menuitemradio" />);
	const ordinary = renderToStaticMarkup(<ContextMenuItem label="Show fades" checked />);
	assert.match(selected, /role="menuitemradio"/u);
	assert.match(selected, /aria-checked="true"/u);
	assert.match(unselected, /aria-checked="false"/u);
	assert.match(unspecified, /aria-checked="false"/u);
	assert.match(ordinary, /role="menuitem"/u);
	assert.doesNotMatch(ordinary, /aria-checked/u);
});

test('radio menu items receive initial focus and Escape returns to the trigger', async (context) => {
	const menu = await mountMenu(context);
	try {
		await menu.flushTimers();
		assert.equal(menu.focused(), menu.first);
		await menu.key('Escape');
		await menu.flushTimers();
		assert.equal(menu.focused(), menu.trigger);
		assert.equal(menu.closeCount(), 1);
	} finally {
		await menu.dispose();
	}
});

test('keyboard navigation includes radios, skips disabled and nested items, and activates a preset', async (context) => {
	const menu = await mountMenu(context);
	try {
		await menu.flushTimers();
		await menu.key('ArrowDown');
		assert.equal(menu.focused(), menu.ordinary);
		await menu.key('ArrowDown');
		assert.equal(menu.focused(), menu.last);
		await menu.key('ArrowDown');
		assert.equal(menu.focused(), menu.first);
		await menu.key('ArrowUp');
		assert.equal(menu.focused(), menu.last);
		await menu.key('Home');
		assert.equal(menu.focused(), menu.first);
		await menu.key('End');
		assert.equal(menu.focused(), menu.last);
		await act(async () => {
			reactProps(menu.last).onKeyDown!({ key: 'Enter', preventDefault() {} });
		});
		assert.equal(menu.activationCount(), 1);
		assert.equal(menu.closeCount(), 1);
	} finally {
		await menu.dispose();
	}
});

async function mountMenu(context: TestContext): Promise<{
	trigger: ReactTestElement;
	first: ReactTestElement;
	ordinary: ReactTestElement;
	last: ReactTestElement;
	focused(): Element | null;
	activationCount(): number;
	closeCount(): number;
	key(key: string): Promise<void>;
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
	let activations = 0;
	let closes = 0;
	const close = () => { closes += 1; open = false; root.render(render()); };
	const render = () => <>
		<button data-trigger="true">Fade shape</button>
		{open && <ContextMenu isOpen x={0} y={0} onClose={close}>
			<ContextMenuItem label="Linear" role="menuitemradio" checked />
			<ContextMenuItem label="Unavailable" role="menuitemradio" disabled />
			<ContextMenuItem label="Reset" />
			<ContextMenuItem label="Exponential" role="menuitemradio" onClick={() => { activations += 1; }} onClose={close} />
			<div><ContextMenuItem label="Nested" role="menuitemradio" /></div>
		</ContextMenu>}
	</>;
	await act(async () => root.render(render()));
	const trigger = dom.one('[data-trigger="true"]');
	trigger.focus();
	open = true;
	await act(async () => root.render(render()));
	const menu = dom.one('[role="menu"]');
	const first = menu.querySelector('[role="menuitemradio"]')!;
	const ordinary = menu.querySelector('[role="menuitem"]')!;
	const last = menu.querySelectorAll('[role="menuitemradio"]')[2]!;
	// The test DOM supports selector lists but not :scope or :not. Supply
	// those two operations while deriving membership from the real selector.
	const querySelectorAll = menu.querySelectorAll.bind(menu);
	menu.querySelectorAll = (selector: string) => {
		if (!selector.includes(':scope')) return querySelectorAll(selector);
		const roles = [...selector.matchAll(/\[role="([^"]+)"\]/gu)].map((match) => match[1]);
		return menu.childNodes.filter((node): node is ReactTestElement => (
			'getAttribute' in node && roles.includes((node as ReactTestElement).getAttribute('role') ?? '')
			&& (node as ReactTestElement).getAttribute('aria-disabled') !== 'true'
		));
	};
	return {
		trigger, first, ordinary, last,
		focused: () => ownerDocument.activeElement,
		activationCount: () => activations,
		closeCount: () => closes,
		key: (key) => act(async () => {
			const event = {
				key, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {},
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
