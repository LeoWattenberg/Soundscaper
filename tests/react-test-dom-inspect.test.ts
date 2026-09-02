/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { inspect } from 'node:util';
import React, { act } from 'react';

import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

function Panel() {
	const [open, setOpen] = React.useState(false);
	return React.createElement('section', null,
		React.createElement('button', { type: 'button', 'aria-label': 'Panel menu', onClick: () => setOpen(true) }, 'Menu'),
		open ? React.createElement('div', { role: 'menu' }, React.createElement('div', { role: 'menuitem' }, 'Close')) : null,
	);
}

// A mounted node links into React's fiber graph through the __reactFiber$ and
// __reactProps$ records React stores on it. A failing assert.equal against
// such a node prints it with util.inspect at depth 1000 and once walked that
// graph until the process ran out of memory, so the records must stay hidden.
test('a failed assertion against a mounted fake node prints in bounded time', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(React.createElement(Panel)));
		const button = dom.one('button');
		await act(async () => reactProps(button).onClick({}));
		const menu = dom.one('[role="menu"]');
		const reactKeys = Reflect.ownKeys(button).filter((key) => typeof key === 'string' && key.startsWith('__react'));
		assert.ok(reactKeys.length >= 2, 'React attached its fiber and props records to the node');
		for (const key of reactKeys) {
			assert.equal(Object.getOwnPropertyDescriptor(button, key)?.enumerable, false, `${String(key)} stays hidden from inspect`);
		}
		assert.equal(inspect(button), '<button type="button" aria-label="Panel menu">');
		assert.equal(inspect(dom.container.ownerDocument.createTextNode('x')), '#text');

		const started = performance.now();
		let caught: unknown = null;
		try {
			assert.equal(menu, null);
		} catch (error) {
			caught = error;
		}
		const elapsed = performance.now() - started;
		assert.ok(caught instanceof assert.AssertionError, `assert.equal threw ${String(caught)}`);
		assert.ok(caught.message.length < 20_000, `the failure message stays small (${caught.message.length} characters)`);
		assert.ok(elapsed < 2_000, `the failure message is built without walking the fiber graph (${elapsed.toFixed(0)} ms)`);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
