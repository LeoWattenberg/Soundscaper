/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { ContextMenu } from '../vendor/audacity-design-system/components/src/ContextMenu/ContextMenu.tsx';
import { ContextMenuItem } from '../vendor/audacity-design-system/components/src/ContextMenuItem/ContextMenuItem.tsx';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

for (const ownership of ['ctrlKey', 'altKey', 'metaKey', 'defaultPrevented'] as const) {
	test(`context-menu navigation leaves ${ownership} events with their owner`, async context => {
		await withMenu(context, async (dom, dispatch) => {
			const menu = dom.one('[role="menu"]');
			const [first, last] = menu.querySelectorAll('[role="menuitem"]');
			assert.ok(first && last);
			first.focus();
			let prevented = 0;
			const event = {
				key: 'End', ctrlKey: false, metaKey: false, altKey: false, defaultPrevented: false,
				[ownership]: true, target: first,
				preventDefault: () => { prevented += 1; }, stopPropagation() {}, stopImmediatePropagation() {},
			};
			await dispatch(event);
			assert.equal(first.ownerDocument.activeElement, first);
			assert.equal(prevented, 0);
			await dispatch({ ...event, [ownership]: false });
			assert.equal(first.ownerDocument.activeElement, last);
			assert.equal(prevented, 1);
		});
	});

	test(`submenu entry leaves ${ownership} arrows with their owner`, async context => {
		await withMenu(context, async dom => {
			const parent = dom.one('[role="menuitem"]');
			parent.focus();
			let prevented = 0;
			const event = {
				key: 'ArrowRight', ctrlKey: false, metaKey: false, altKey: false, defaultPrevented: false,
				[ownership]: true, preventDefault: () => { prevented += 1; }, stopPropagation() {},
			};
			await act(async () => { reactProps(parent).onKeyDown?.(event); });
			assert.equal(dom.find('.context-menu-submenu'), null);
			assert.equal(prevented, 0);
			await act(async () => { reactProps(parent).onKeyDown?.({ ...event, [ownership]: false }); });
			assert.ok(dom.find('.context-menu-submenu'));
			assert.equal(prevented, 1);
		}, true);
	});
}

async function withMenu(
	context: TestContext,
	check: (dom: ReturnType<typeof installReactTestDom>, dispatch: (event: unknown) => Promise<void>) => Promise<void>,
	nested = false,
): Promise<void> {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as Element);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const listeners = new Set<EventListenerOrEventListenerObject>();
	const owner = dom.container.ownerDocument as unknown as Document;
	owner.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => {
		if (type === 'keydown' && listener) listeners.add(listener);
	};
	owner.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => {
		if (type === 'keydown' && listener) listeners.delete(listener);
	};
	try {
		await act(async () => { root.render(<ContextMenu isOpen x={0} y={0} autoFocus={false} onClose={() => undefined}>
			<ContextMenuItem label="First" hasSubmenu={nested}>{nested && <ContextMenuItem label="Child" />}</ContextMenuItem>
			<ContextMenuItem label="Last" />
		</ContextMenu>); });
		const menu = dom.one('[role="menu"]');
		const query = menu.querySelectorAll.bind(menu);
		menu.querySelectorAll = selector => selector.includes(':scope')
			? menu.childNodes.filter((node): node is ReactTestElement => 'getAttribute' in node
				&& (node as ReactTestElement).getAttribute('role') === 'menuitem'
				&& (node as ReactTestElement).getAttribute('aria-disabled') !== 'true')
			: query(selector);
		await check(dom, async event => {
			await act(async () => {
				for (const listener of [...listeners]) {
					if (typeof listener === 'function') listener(event as Event);
					else listener.handleEvent(event as Event);
				}
			});
		});
	} finally {
		await act(async () => { root.unmount(); });
		context.mock.timers.reset();
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
}
