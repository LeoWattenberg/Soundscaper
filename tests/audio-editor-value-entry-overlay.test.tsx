/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { useValueContextMenu } from '../vendor/audacity-design-system/components/src/hooks/useValueContextMenu.tsx';
import { ManualValueDialog } from '../vendor/audacity-design-system/components/src/ManualValueDialog/ManualValueDialog.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('numeric menus escape track stacking contexts and restore their control before opening entry', async context => {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let openerAtEntry: Element | null = null;
	function Control() {
		const valueMenu = useValueContextMenu({ onEnterValue() { openerAtEntry = document.activeElement; } });
		return <div data-control onContextMenu={valueMenu.onContextMenu}><input type="range" />{valueMenu.menu}</div>;
	}
	try {
		await act(async () => root.render(<div data-audio-editor><div data-track><Control /></div></div>));
		const control = dom.one('[data-control]');
		const input = dom.one('input');
		await act(async () => reactProps(control).onContextMenu?.({
			currentTarget: control, clientX: 30, clientY: 40, preventDefault() {}, stopPropagation() {},
		}));
		const menu = dom.one('[role="menu"]');
		assert.equal(menu.closest('[data-track]'), null, 'track stacking and clipping must not contain the menu');
		assert.equal(menu.closest('[data-audio-editor]'), dom.one('[data-audio-editor]'));
		await act(async () => context.mock.timers.tick(1));
		await act(async () => reactProps(dom.one('[role="menuitem"]')).onClick?.({ stopPropagation() {} }));
		assert.equal(openerAtEntry, input, 'the dialog must capture the numeric control as its opener');
		assert.equal(dom.find('[role="menu"]'), null);
	} finally {
		await act(async () => root.unmount());
		context.mock.timers.reset();
		globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});

test('manual numeric dialogs escape track stacking contexts and expose their title', async context => {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let open = false;
	const render = () => <div data-audio-editor><div data-track><button data-opener>Volume</button>
		<ManualValueDialog isOpen={open} title="Volume" value={25} onApply={() => {}}
			onClose={() => { open = false; root.render(render()); }} />
	</div></div>;
	try {
		await act(async () => root.render(render()));
		const opener = dom.one('[data-opener]');
		opener.focus();
		open = true;
		await act(async () => root.render(render()));
		const dialog = dom.one('[role="dialog"]');
		assert.equal(dialog.closest('[data-track]'), null, 'track stacking and clipping must not contain the dialog');
		assert.equal(dialog.closest('[data-audio-editor]'), dom.one('[data-audio-editor]'));
		assert.equal(dialog.getAttribute('aria-label'), 'Volume');
		assert.equal(dialog.querySelector('input')?.getAttribute('aria-label'), 'Value', 'stepper arrow labels must not change the field name');
		assert.equal(dialog.textContent.includes('px)'), false, 'implementation measurements do not belong in the title');
		await act(async () => context.mock.timers.tick(50));
		await act(async () => reactProps(dom.one('[data-manual-value-dialog]')).onKeyDown?.({
			key: 'Escape', preventDefault() {}, stopPropagation() {},
		}));
		assert.equal(document.activeElement, opener);
		assert.equal(dom.find('[role="dialog"]'), null);
	} finally {
		await act(async () => root.unmount());
		context.mock.timers.reset();
		globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});
