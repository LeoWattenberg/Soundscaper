/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import MacroScriptEditor from '../src/common/editor/ui/inspector/MacroScriptEditor.jsx';
import { resolveMacroManagerCopy } from '../src/common/editor/ui/inspector/macro-manager-copy.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const key of ['Escape', 'Tab'] as const) test(`Program returns composing ${key} to its native input method`, async () => {
	const dom = installReactTestDom();
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = environment.IS_REACT_ACT_ENVIRONMENT;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	environment.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const changes: string[] = [];
	interface Script { id: string; name: string; source: string }
	function Control() {
		const [script, setScript] = useState<Script>({ id: 'authored', name: 'Program', source: '// とう' });
		return <MacroScriptEditor script={script} onChange={(next: Script) => {
			changes.push(next.source); setScript(next);
		}} log={[]} failure={null} copy={resolveMacroManagerCopy('en')} running={false} blocked={false}
			onRun={() => undefined} onCancel={() => undefined} onTrust={() => undefined} />;
	}
	try {
		await act(async () => root.render(<Control />));
		const field = dom.one('textarea');
		// The lightweight DOM does not seed a textarea value from its initial text node.
		field.value = '// とう';
		field.focus();
		let prevented = false;
		let stopped = false;
		await act(async () => reactProps(field).onKeyDown({
			key, nativeEvent: { isComposing: true }, currentTarget: {
				value: field.value, selectionStart: field.value.length, selectionEnd: field.value.length,
			}, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; },
		}));
		assert.equal(prevented, false, 'composition does not enter the application Tab or Escape owner');
		assert.equal(stopped, false);
		assert.deepEqual(changes, []);
		await act(async () => reactProps(field).onKeyDown({
			key: 'Tab', nativeEvent: { isComposing: false }, currentTarget: {
				value: field.value, selectionStart: field.value.length, selectionEnd: field.value.length,
			}, preventDefault() { prevented = true; }, stopPropagation() {},
		}));
		assert.equal(prevented, true, 'completed native composition leaves ordinary Tab indentation enabled');
		assert.equal(field.value, '// とう  ');
	} finally {
		await act(async () => root.unmount());
		environment.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
