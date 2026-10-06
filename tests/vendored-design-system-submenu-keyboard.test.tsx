/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import React, { act } from 'react';
import { ContextMenu } from '../vendor/audacity-design-system/components/src/ContextMenu/ContextMenu.tsx';
import { ContextMenuItem } from '../vendor/audacity-design-system/components/src/ContextMenuItem/ContextMenuItem.tsx';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

test('keyboard entry enters a submenu already opened by a pointer click', async (context) => {
	const mounted = await mount(context);
	try {
		mounted.parent.focus();
		await act(async () => reactProps(mounted.parent).onClick({ stopPropagation() {} }));
		await mounted.enter();
		assert.equal(mounted.focused(), mounted.child());
	} finally { await mounted.dispose(); }
});

test('submenu Escape returns to its parent and Home and End stay inside its level', async (context) => {
	const mounted = await mount(context);
	try {
		mounted.parent.focus();
		await mounted.enter();
		await mounted.key('End');
		assert.equal(mounted.focused(), mounted.last());
		await mounted.key('Home');
		assert.equal(mounted.focused(), mounted.child());
		await mounted.key('Escape');
		assert.equal(mounted.focused(), mounted.parent);
		assert.equal(mounted.closed(), 0);
	} finally { await mounted.dispose(); }
});

async function mount(context: TestContext) {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const document = dom.container.ownerDocument as unknown as Document;
	const listeners = new Set<EventListenerOrEventListenerObject>();
	document.addEventListener = (type, listener) => {
		if (type === 'keydown' && listener) listeners.add(listener);
	};
	document.removeEventListener = (type, listener) => {
		if (type === 'keydown' && listener) listeners.delete(listener);
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let closed = 0;
	await act(async () => root.render(<ContextMenu isOpen x={0} y={0} autoFocus={false} onClose={() => { closed += 1; }}>
		<ContextMenuItem label="Parent" hasSubmenu>
			<ContextMenuItem label="Child" />
			<ContextMenuItem label="Last" />
		</ContextMenuItem>
		<ContextMenuItem label="Sibling" />
	</ContextMenu>));
	const menu = dom.one('[role="menu"]');
	const parent = menu.querySelector('[role="menuitem"]')!;
	const directItems = (element: ReactTestElement) => {
		const query = element.querySelectorAll.bind(element);
		element.querySelectorAll = (selector) => selector.includes(':scope')
			? element.childNodes.filter((node): node is ReactTestElement => 'getAttribute' in node
				&& ['menuitem', 'menuitemradio'].includes((node as ReactTestElement).getAttribute('role') ?? '')
				&& (node as ReactTestElement).getAttribute('aria-disabled') !== 'true')
			: query(selector);
	};
	directItems(menu);
	const submenu = () => dom.one('.context-menu-submenu');
	return {
		parent,
		focused: () => document.activeElement,
		child: () => submenu().querySelectorAll('[role="menuitem"]')[0],
		last: () => submenu().querySelectorAll('[role="menuitem"]')[1],
		closed: () => closed,
		enter: async () => {
			await act(async () => reactProps(parent).onKeyDown({ key: 'ArrowRight', preventDefault() {}, stopPropagation() {} }));
			directItems(submenu());
			await act(async () => context.mock.timers.tick(1));
		},
		key: async (key: string) => {
			await act(async () => {
				const event = { key, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} } as KeyboardEvent;
				for (const listener of [...listeners]) {
					if (typeof listener === 'function') listener(event);
					else listener.handleEvent(event);
				}
			});
		},
		dispose: async () => {
			await act(async () => root.unmount());
			context.mock.timers.reset();
			globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		},
	};
}
