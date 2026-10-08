/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import MacroScriptEditor from '../src/common/editor/ui/inspector/MacroScriptEditor.jsx';
import { resolveMacroManagerCopy } from '../src/common/editor/ui/inspector/macro-manager-copy.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

interface Script { id: string; name: string; source: string; trust: string }

for (const completion of ['Enter', 'Escape', 'blur'] as const) {
	test(`program name ${completion} preserves its owned focus and draft lifecycle`, async () => {
		const dom = installReactTestDom();
		const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		const root = createRoot(dom.container as unknown as Element);
		const commits: string[] = [];
		function Control() {
			const [script, setScript] = useState<Script>({
				id: 'program', name: 'Original program', source: 'await sound.select.all();', trust: 'authored',
			});
			return <MacroScriptEditor copy={resolveMacroManagerCopy('en')} script={script}
				log={[]} failure={null} running={false} blocked={false}
				onChange={(next: Script) => { commits.push(next.name); setScript({ ...next, name: next.name.trim() }); }}
				onRun={() => undefined} onCancel={() => undefined} onTrust={() => undefined} />;
		}
		try {
			await act(async () => { root.render(<Control />); });
			const input = dom.one('.text-input__field');
			const owner = input.ownerDocument;
			const label = input.closest('label');
			assert.ok(label);
			Object.defineProperty(input, 'blur', { configurable: true, value: () => {
				owner.activeElement = owner.body;
				reactProps(input).onBlur();
			} });
			input.focus();
			await act(async () => {
				reactProps(input).onFocus();
				reactProps(input).onChange({ target: { value: 'Keyboard program' } });
			});
			const program = dom.one('[data-macro-script-source]');
			await act(async () => {
				if (completion === 'blur') {
					program.focus();
					reactProps(input).onBlur();
				} else reactProps(label).onKeyDown({
					key: completion, target: input, preventDefault: () => undefined, stopPropagation: () => undefined,
				});
			});
			assert.deepEqual(commits, completion === 'Escape' ? [] : ['Keyboard program']);
			assert.equal(input.value, completion === 'Escape' ? 'Original program' : 'Keyboard program');
			if (completion === 'Enter') {
				assert.equal(owner.activeElement, input, 'confirmation retains the name input for continued editing');
				await act(async () => {
					reactProps(input).onChange({ target: { value: 'Keyboard program encore' } });
				});
				await act(async () => {
					reactProps(label).onKeyDown({ key: 'Enter', target: input,
						preventDefault: () => undefined, stopPropagation: () => undefined });
				});
				assert.deepEqual(commits, ['Keyboard program', 'Keyboard program encore']);
				assert.equal(owner.activeElement, input);
				await act(async () => { program.focus(); reactProps(input).onBlur(); });
				assert.deepEqual(commits, ['Keyboard program', 'Keyboard program encore'],
					'a later native Tab blur does not publish the completed name twice');
				assert.equal(owner.activeElement, program);
			} else if (completion === 'blur') assert.equal(owner.activeElement, program);
		} finally {
			await act(async () => { root.unmount(); });
			actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		}
	});
}
