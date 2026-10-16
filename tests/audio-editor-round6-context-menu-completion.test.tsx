/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { ContextMenu } from '../vendor/audacity-design-system/components/src/ContextMenu/ContextMenu.tsx';
import { ContextMenuItem } from '../vendor/audacity-design-system/components/src/ContextMenuItem/ContextMenuItem.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const key of ['Enter', ' '] as const) for (const focusAction of [false, true]) {
	test(`context-menu ${key} completion returns focus before its action; action takes focus: ${focusAction}`, async () => {
		const dom = installReactTestDom();
		const root = createRoot(dom.container as unknown as Element);
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		let open = false;
		let activeAtInvocation: unknown;
		const close = () => { open = false; root.render(render()); };
		const render = () => <><button data-menu-trigger>Track menu</button><button data-next-owner>Dialog</button>
			{open && <ContextMenu isOpen x={0} y={0} autoFocus={false} onClose={close}>
				<ContextMenuItem label="Choose action" onClose={close} onClick={() => {
					activeAtInvocation = dom.container.ownerDocument.activeElement;
					if (focusAction) dom.one('[data-next-owner]').focus();
				}} />
			</ContextMenu>}</>;
		try {
			await act(async () => { root.render(render()); });
			const trigger = dom.one('[data-menu-trigger]');
			const next = dom.one('[data-next-owner]');
			trigger.focus();
			open = true;
			await act(async () => { root.render(render()); });
			const item = dom.one('[role="menuitem"]');
			item.focus();
			await act(async () => { reactProps(item).onKeyDown?.({
				key, defaultPrevented: false, ctrlKey: false, altKey: false, metaKey: false,
				preventDefault() {}, stopPropagation() {},
			}); });
			assert.ok(activeAtInvocation === trigger, 'the action starts with its surviving trigger focused');
			assert.equal(dom.find('[role="menu"]'), null);
			assert.ok(dom.container.ownerDocument.activeElement === (focusAction ? next : trigger));
		} finally {
			await act(async () => { root.unmount(); });
			actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
			dom.restore();
		}
	});
}
