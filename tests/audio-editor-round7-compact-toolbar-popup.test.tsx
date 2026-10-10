/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';

import WorkspaceChromeDrawer from '../src/common/editor/ui/workspace/WorkspaceChromeDrawer.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('the compact chrome drawer retains its own portalled popup and closes for outside focus', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean; React?: typeof React };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = globals.React;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	globals.React = React;
	const root = createRoot(dom.container as unknown as Element);
	const portal = dom.container.ownerDocument.createElement('div');
	dom.container.ownerDocument.body.appendChild(portal);
	let closed = 0;
	try {
		await act(async () => root.render(<WorkspaceChromeDrawer id="chrome" open
			onClose={() => { closed += 1; }} label="Menu" closeLabel="Close menu">
			<button aria-controls="toolbar-popup" aria-expanded="true">Musical timeline</button>
			<button data-other-inside>Other toolbar action</button>
			{createPortal(<div id="toolbar-popup" role="dialog"><select data-popup-control><option>Musical</option></select></div>, portal as unknown as Element)}
		</WorkspaceChromeDrawer>));
		const panel = dom.one('.kw-audio-editor__chrome-drawer-panel');
		const blur = (relatedTarget: unknown) => reactProps(panel).onBlur?.({ currentTarget: panel, relatedTarget });
		await act(async () => { blur(dom.one('[data-other-inside]')); });
		assert.equal(closed, 0, 'ordinary focus within the toolbar retains its drawer');
		const input = portal.querySelector('[data-popup-control]');
		assert.ok(input);
		assert.equal(panel.contains(input), false, 'the actual popup is mounted outside the drawer');
		await act(async () => { blur(input); });
		assert.equal(closed, 0, 'focus entering the drawer-owned popup must retain its reachable opener');
		await act(async () => { blur(portal); });
		assert.equal(closed, 1, 'unrelated outside focus still dismisses the drawer');
	} finally {
		await act(async () => root.unmount());
		portal.parentNode?.removeChild(portal);
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		globals.React = priorReact;
		dom.restore();
	}
});

test('Escape within a drawer-owned popup leaves its opener available until the popup closes', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean; React?: typeof React };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = globals.React;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	globals.React = React;
	const events = new EventTarget();
	document.addEventListener = events.addEventListener.bind(events);
	document.removeEventListener = events.removeEventListener.bind(events);
	const root = createRoot(dom.container as unknown as Element);
	const portal = dom.container.ownerDocument.createElement('div');
	dom.container.ownerDocument.body.appendChild(portal);
	let closed = 0;
	try {
		await act(async () => root.render(<WorkspaceChromeDrawer id="chrome" open
			onClose={() => { closed += 1; }} label="Menu" closeLabel="Close menu">
			<button data-opener aria-controls="toolbar-popup" aria-expanded="true">Musical timeline</button>
			{createPortal(<div id="toolbar-popup" role="dialog"><input data-popup-control /></div>, portal as unknown as Element)}
		</WorkspaceChromeDrawer>));
		const input = portal.querySelector('[data-popup-control]');
		assert.ok(input);
		input.focus();
		const escape = () => {
			const event = new Event('keydown', { cancelable: true });
			Object.defineProperty(event, 'key', { value: 'Escape' });
			events.dispatchEvent(event);
		};
		await act(async () => { escape(); });
		assert.equal(closed, 0, 'the popup owns its native Escape before the surrounding drawer');
		dom.one('[data-opener]').focus();
		await act(async () => { escape(); });
		assert.equal(closed, 1, 'ordinary Escape after returning to the toolbar dismisses its drawer');
	} finally {
		await act(async () => root.unmount());
		portal.parentNode?.removeChild(portal);
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		globals.React = priorReact;
		dom.restore();
	}
});
