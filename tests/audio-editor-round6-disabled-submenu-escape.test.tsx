/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import React, { act } from 'react';
import { ContextMenu } from '../vendor/audacity-design-system/components/src/ContextMenu/ContextMenu.tsx';
import { ContextMenuItem } from '../vendor/audacity-design-system/components/src/ContextMenuItem/ContextMenuItem.tsx';
import { useApplicationMenuKeyboard } from '../src/common/editor/ui/useApplicationMenuKeyboard.js';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

type Availability = 'writable' | 'locked' | 'leading-disabled';

for (const application of [false, true]) {
	test(`two native Escapes dismiss an all-disabled Paste submenu; application: ${application}`, async context => {
		const menu = await mount(context, application, 'locked');
		try {
			await menu.enter();
			assert.equal(menu.first().getAttribute('aria-disabled'), 'true');
			await menu.key('Escape');
			await menu.key('Escape');
			assert.equal(menu.rootMenu(), null);
			assert.equal(menu.focused(), menu.trigger);
		} finally { await menu.dispose(); }
	});

	test(`keyboard entry focuses the first enabled submenu child; application: ${application}`, async context => {
		const menu = await mount(context, application, 'leading-disabled');
		try {
			await menu.enter();
			assert.equal(menu.focused(), menu.last());
		} finally { await menu.dispose(); }
	});

	test(`all-disabled submenu entry retains its parent focus; application: ${application}`, async context => {
		const menu = await mount(context, application, 'locked');
		try {
			await menu.enter();
			assert.equal(menu.focused(), menu.parent);
		} finally { await menu.dispose(); }
	});
}

test('Escape returns from a focused submenu whose children became unavailable', async context => {
	const menu = await mount(context, true, 'writable');
	try {
		await menu.enter();
		assert.equal(menu.focused(), menu.first());
		await menu.availability('locked');
		await menu.key('Escape');
		assert.equal(menu.submenu(), null);
		assert.equal(menu.focused(), menu.parent);
		assert.ok(menu.rootMenu(), 'one Escape returns one level before the root closes');
		await menu.key('Escape');
		assert.equal(menu.rootMenu(), null);
	} finally { await menu.dispose(); }
});

for (const ownership of ['ctrlKey', 'altKey', 'metaKey', 'defaultPrevented'] as const) {
	test(`an unavailable submenu leaves ${ownership} Escape with its owner`, async context => {
		const menu = await mount(context, true, 'writable');
		try {
			await menu.enter();
			const child = menu.first();
			await menu.availability('locked');
			await menu.key('Escape', ownership);
			assert.ok(menu.submenu());
			assert.equal(menu.focused(), child);
		} finally { await menu.dispose(); }
	});
}

async function mount(context: TestContext, application: boolean, initialAvailability: Availability) {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const owner = dom.container.ownerDocument as unknown as Document;
	const windowListeners = new Set<EventListenerOrEventListenerObject>();
	const documentListeners = new Set<EventListenerOrEventListenerObject>();
	for (const [target, listeners] of [[window, windowListeners], [owner, documentListeners]] as const) {
		target.addEventListener = (kind: string, listener: EventListenerOrEventListenerObject | null) => {
			if (kind === 'keydown' && listener) listeners.add(listener);
		};
		target.removeEventListener = (kind: string, listener: EventListenerOrEventListenerObject | null) => {
			if (kind === 'keydown' && listener) listeners.delete(listener);
		};
	}
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let open = false;
	let availability = initialAvailability;
	const close = () => { open = false; dom.one('[data-trigger]').focus(); root.render(<Menu />); };
	function Menu() {
		useApplicationMenuKeyboard({ closeMenu: close, flatNavigation: true,
			focusMenuButton: () => undefined, horizontalRightDelta: 1, menuButtonsRef: { current: [] },
			menuCount: 1, openMenu: application && open ? { index: 0 } : null,
			setActiveIndex: () => undefined, setOpenMenu: () => undefined,
		});
		return <><button data-trigger>Edit</button>{open && <ContextMenu isOpen x={0} y={0}
			autoFocus={false} onClose={close} className="kw-audio-editor__application-menu">
			<ContextMenuItem label="Paste" hasSubmenu>
				<ContextMenuItem label="Paste" disabled={availability !== 'writable'} />
				<ContextMenuItem label="Insert" disabled={availability === 'locked'} />
			</ContextMenuItem>
		</ContextMenu>}</>;
	}
	await act(async () => root.render(<Menu />));
	const trigger = dom.one('[data-trigger]');
	trigger.focus();
	open = true;
	await act(async () => root.render(<Menu />));
	const parent = dom.one('[role="menuitem"]');
	const rootMenu = dom.one('[role="menu"]');
	const adapted = new WeakSet<ReactTestElement>();
	const adaptDirectItems = (menu: ReactTestElement) => {
		if (adapted.has(menu)) return;
		adapted.add(menu);
		const query = menu.querySelectorAll.bind(menu);
		menu.querySelectorAll = selector => selector.includes(':scope >')
			? menu.childNodes.filter((node): node is ReactTestElement => node instanceof HTMLElement
				&& ['menuitem', 'menuitemradio', 'menuitemcheckbox'].includes(node.getAttribute('role') ?? '')
				&& node.getAttribute('aria-disabled') !== 'true')
			: query(selector);
	};
	adaptDirectItems(rootMenu);
	const queryParent = parent.querySelector.bind(parent);
	parent.querySelector = selector => selector.includes(':scope > .context-menu-item-content')
		? queryParent('.context-menu-item-arrow')
		: selector === ':scope > .context-menu-submenu' ? dom.find('.context-menu-submenu') : queryParent(selector);
	const key = async (name: string, ownership?: 'ctrlKey' | 'altKey' | 'metaKey' | 'defaultPrevented') => {
		const target = dom.container.ownerDocument.activeElement;
		const event = Object.assign(new Event('keydown', { cancelable: true }), { key: name,
			ctrlKey: ownership === 'ctrlKey', altKey: ownership === 'altKey', metaKey: ownership === 'metaKey' });
		Object.defineProperty(event, 'target', { value: target });
		if (ownership === 'defaultPrevented') event.preventDefault();
		let stopped = false;
		event.stopPropagation = event.stopImmediatePropagation = () => { stopped = true; };
		await act(async () => {
			for (const listeners of [windowListeners, documentListeners]) for (const listener of [...listeners]) {
				if (stopped) break;
				if (typeof listener === 'function') listener(event);
				else listener.handleEvent(event);
			}
			if (!stopped && target) reactProps(target).onKeyDown?.(event);
		});
		const submenu = dom.find('.context-menu-submenu');
		if (submenu) adaptDirectItems(submenu);
	};
	return {
		trigger, parent, focused: () => owner.activeElement,
		rootMenu: () => dom.find('[role="menu"]'), submenu: () => dom.find('.context-menu-submenu'),
		first: () => dom.one('.context-menu-submenu').querySelectorAll('[role="menuitem"]')[0]!,
		last: () => dom.one('.context-menu-submenu').querySelectorAll('[role="menuitem"]')[1]!,
		key,
		enter: async () => { parent.focus(); await key('ArrowRight'); await act(async () => context.mock.timers.tick(10)); },
		availability: async (value: Availability) => { availability = value; await act(async () => root.render(<Menu />)); },
		dispose: async () => {
			await act(async () => root.unmount());
			context.mock.timers.reset();
			globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		},
	};
}
