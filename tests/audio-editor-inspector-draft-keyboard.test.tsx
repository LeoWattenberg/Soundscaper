/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { CommitField } from '../src/common/editor/ui/inspector/inspector-controls.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

(globalThis as unknown as { React: unknown }).React = React;

test('inspector draft keyboard submission commits once and Escape cancels the pending blur', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const committed: string[] = [];
	try {
		await act(async () => root.render(<CommitField label="Clip name" name="name" value="Tone"
			disabled={false} readOnly={false} multiline={false} onCommit={(_name: string, value: string) => { committed.push(value); }} />));
		const field = dom.one('input');
		const wrapper = dom.one('label');
		let blurCount = 0;
		const target = { blur() { blurCount += 1; reactProps(field).onBlur(); } };
		const keyboard = (key: string) => ({ key, target, preventDefault() {}, stopPropagation() {} });
		await act(async () => reactProps(field).onChange({ target: { value: 'Opening tone' } }));
		await act(async () => reactProps(wrapper).onKeyDown(keyboard('Enter')));
		assert.equal(blurCount, 1);
		assert.deepEqual(committed, ['Opening tone']);
		await act(async () => reactProps(field).onChange({ target: { value: 'Discard this title' } }));
		await act(async () => reactProps(wrapper).onKeyDown(keyboard('Escape')));
		assert.equal(field.value, 'Tone');
		assert.equal(blurCount, 2);
		assert.deepEqual(committed, ['Opening tone']);
		await act(async () => reactProps(field).onChange({ target: { value: 'Later title' } }));
		await act(async () => reactProps(field).onBlur());
		assert.deepEqual(committed, ['Opening tone', 'Later title']);
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
