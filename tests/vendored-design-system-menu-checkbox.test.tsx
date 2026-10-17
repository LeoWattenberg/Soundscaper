/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button } from '../vendor/audacity-design-system/components/src/Button/Button.tsx';
import { ContextMenu } from '../vendor/audacity-design-system/components/src/ContextMenu/ContextMenu.tsx';
import { ContextMenuItem } from '../vendor/audacity-design-system/components/src/ContextMenuItem/ContextMenuItem.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('checkbox menu items expose their state and participate in initial focus and arrow navigation', async context => {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const listeners = new Set<EventListener>();
	const document = dom.container.ownerDocument as unknown as Document;
	document.addEventListener = (name: string, listener: EventListenerOrEventListenerObject | null) => { if (name === 'keydown' && typeof listener === 'function') listeners.add(listener); };
	document.removeEventListener = (name: string, listener: EventListenerOrEventListenerObject | null) => { if (name === 'keydown' && typeof listener === 'function') listeners.delete(listener); };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let toggles = 0;
	try {
		await act(async () => root.render(<ContextMenu isOpen x={0} y={0} ariaLabel="Settings" onClose={() => {}}>
			<ContextMenuItem label="Preserve formants" role="menuitemcheckbox" checked onClick={() => { toggles++; }} />
			<ContextMenuItem label="Resample" />
		</ContextMenu>));
		const checkbox = dom.one('[role="menuitemcheckbox"]');
		const normal = dom.one('[role="menuitem"]');
		assert.equal(checkbox.getAttribute('aria-checked'), 'true');
		const menu = dom.one('[role="menu"]');
		assert.equal(menu.getAttribute('aria-label'), 'Settings');
		menu.querySelectorAll = selector => selector.includes('menuitemcheckbox') ? [checkbox, normal] : [normal];
		await act(async () => context.mock.timers.tick(1));
		assert.equal(document.activeElement, checkbox);
		for (const [key, focused] of [['ArrowDown', normal], ['ArrowUp', checkbox]] as const) {
			await act(async () => {
				for (const listener of listeners) listener({ key, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} } as KeyboardEvent);
			});
			assert.equal(document.activeElement, focused);
		}
		await act(async () => reactProps(checkbox).onClick({ stopPropagation() {} }));
		assert.equal(toggles, 1);
	} finally {
		await act(async () => root.unmount());
		context.mock.timers.reset(); globals.IS_REACT_ACT_ENVIRONMENT = priorAct; dom.restore();
	}
});

test('Button retains its native menu attributes without feature-level DOM adaptation', () => {
	const markup = renderToStaticMarkup(<Button aria-haspopup="menu" aria-expanded={false} data-settings-trigger>Settings</Button>);
	assert.match(markup, /aria-haspopup="menu"/u);
	assert.match(markup, /aria-expanded="false"/u);
	assert.match(markup, /data-settings-trigger="true"/u);
});
