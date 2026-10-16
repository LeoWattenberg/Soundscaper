/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import MacroScriptEditor from '../src/common/editor/ui/inspector/MacroScriptEditor.jsx';
import { resolveMacroManagerCopy } from '../src/common/editor/ui/inspector/macro-manager-copy.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const key of ['Enter', 'Escape'] as const) test(`program name preserves its composing ${key} draft without publication`, async () => {
	const dom = installReactTestDom();
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const committed: string[] = [];
	try {
		await act(async () => { root.render(<MacroScriptEditor copy={resolveMacroManagerCopy('en')}
			script={{ id: 'program', name: 'Original', source: 'await sound.select.all();', trust: 'authored' }}
			log={[]} failure={null} running={false} blocked={false}
			onChange={(next: { name: string }) => { committed.push(next.name); }}
			onRun={() => undefined} onCancel={() => undefined} onTrust={() => undefined} />); });
		const input = dom.one('.text-input__field');
		Object.defineProperty(input, 'blur', { configurable: true, value: () => {
			input.ownerDocument.activeElement = input.ownerDocument.body;
			reactProps(input).onBlur();
		} });
		const label = input.closest('label');
		assert.ok(label);
		input.focus();
		await act(async () => { reactProps(input).onFocus(); reactProps(input).onChange({ target: { value: 'とう' } }); });
		let consumed = false;
		await act(async () => { reactProps(label).onKeyDown({ key, target: input,
			nativeEvent: { isComposing: true }, preventDefault: () => { consumed = true; },
			stopPropagation: () => { consumed = true; } }); });
		assert.deepEqual(committed, [], 'IME confirmation does not save an unfinished name');
		assert.equal(consumed, false, 'the input method owns its composing key');
		assert.equal(input.value, 'とう');
		assert.equal(input.ownerDocument.activeElement, input);
		await act(async () => { reactProps(input).onChange({ target: { value: '東京の作業' } }); });
		await act(async () => { reactProps(label).onKeyDown({ key: 'Enter', target: input,
			nativeEvent: { isComposing: false }, preventDefault: () => undefined, stopPropagation: () => undefined }); });
		assert.deepEqual(committed, ['東京の作業']);
	} finally {
		await act(async () => { root.unmount(); });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
