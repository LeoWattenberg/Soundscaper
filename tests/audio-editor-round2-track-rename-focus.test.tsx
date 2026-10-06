/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { TrackNameEditor } from '../src/common/editor/ui/timeline/TrackControls.jsx';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

for (const key of ['Enter', 'Escape']) test(`${key} closes inline track rename without losing track-control focus`, async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean; React?: typeof React };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	globals.React = React;
	Object.defineProperty(ReactTestElement.prototype, 'select', { configurable: true, value() {} });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const updates: unknown[] = [];
	function Fixture() {
		const [editing, setEditing] = useState(true);
		return <div data-track-header><div className="track-control-panel__header">
			<button className="ghost-button">Track menu</button></div>
			{editing && <TrackNameEditor track={{ id: 'track', name: 'Original' }} label="Track name" blocked={false}
				controller={{ actions: { track: { update: (...args: unknown[]) => updates.push(args) } } }}
				run={(operation: () => unknown) => operation()} onClose={() => setEditing(false)} />}</div>;
	}
	try {
		await act(async () => root.render(<Fixture />));
		const input = dom.one('input');
		const label = dom.one('[data-track-name]');
		Object.assign(input, { blur() { reactProps(label).onBlur?.({}); } });
		await act(async () => reactProps(input).onChange?.({ target: { value: 'Changed' } }));
		await act(async () => reactProps(label).onKeyDown?.({ key, currentTarget: label, preventDefault() {}, stopPropagation() {} }));
		assert.equal(dom.find('input'), null);
		assert.equal(dom.container.ownerDocument.activeElement, dom.one('.ghost-button'));
		assert.deepEqual(updates, key === 'Enter' ? [['track', { name: 'Changed' }]] : []);
	} finally {
		await act(async () => root.unmount());
		Reflect.deleteProperty(ReactTestElement.prototype, 'select');
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
