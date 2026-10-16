/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import MacroScriptEditor from '../src/common/editor/ui/inspector/MacroScriptEditor.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('a macro name keyboard draft cancels without a blur save and commits on Enter', async () => {
	const dom = installReactTestDom();
	const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const prior = environment.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	environment.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const changes: Array<{ name: string }> = [];
	function Control() {
		const [script, setScript] = useState({ id: 'program', name: 'Original', source: '' });
		return <MacroScriptEditor script={script}
			copy={{ programName: 'Program name' }} log={[]} running={false} blocked={false} failure={null}
			onChange={(value: typeof script) => { changes.push(value); setScript(value); }}
			onRun={() => undefined} onCancel={() => undefined} onTrust={() => undefined} />;
	}
	try {
		await act(async () => root.render(<Control />));
		const input = dom.one('input');
		const label = dom.container.querySelectorAll('label')[0]!;
		await act(async () => reactProps(input).onFocus());
		await act(async () => reactProps(input).onChange({ target: { value: 'Cancelled' } }));
		await act(async () => reactProps(label).onKeyDown({ key: 'Escape', target: { blur() {} }, preventDefault() {}, stopPropagation() {} }));
		await act(async () => reactProps(input).onBlur());
		assert.equal(input.value, 'Original');
		assert.equal(changes.length, 0);
		await act(async () => reactProps(input).onFocus());
		await act(async () => reactProps(input).onChange({ target: { value: 'Saved' } }));
		await act(async () => reactProps(label).onKeyDown({ key: 'Enter', target: { blur() {} }, preventDefault() {}, stopPropagation() {} }));
		await act(async () => reactProps(input).onBlur());
		assert.deepEqual(changes.map((value) => value.name), ['Saved']);
	} finally {
		await act(async () => root.unmount());
		environment.IS_REACT_ACT_ENVIRONMENT = prior;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
