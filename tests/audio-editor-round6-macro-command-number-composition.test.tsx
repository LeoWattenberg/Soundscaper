/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import MacroCommandParameterEditor from '../src/common/editor/ui/inspector/MacroCommandParameterEditor.tsx';
import { createMacroCommandStep, type MacroCommandStep } from '../src/common/editor/macro-command-steps.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const key of ['Enter', 'Escape']) {
	test(`a macro command numeric draft releases native composing ${key}`, async () => {
		const dom = installReactTestDom();
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		const root = createRoot(dom.container as unknown as Element);
		let step = createMacroCommandStep('SelectTime', { params: { start: 0.1, end: 0.5 } });
		const writes: MacroCommandStep[] = [];
		const render = () => root.render(<MacroCommandParameterEditor step={step} onChange={next => {
			step = next; writes.push(next); render();
		}} />);
		try {
			await act(async () => { render(); });
			const input = dom.container.querySelectorAll('input')[0];
			assert.ok(input);
			await act(async () => { reactProps(input).onChange({ currentTarget: { value: '0.3' } }); });
			let prevented = false; let stopped = false;
			await act(async () => { reactProps(input).onKeyDown({ key, nativeEvent: { isComposing: true },
				currentTarget: { blur() { reactProps(input).onBlur(); } },
				preventDefault() { prevented = true; }, stopPropagation() { stopped = true; },
			}); });
			assert.equal(writes.length, 0, 'unfinished input-method text cannot replace the saved macro parameter');
			assert.equal(input.value, '0.3');
			assert.equal(prevented || stopped, false);
			await act(async () => { reactProps(input).onChange({ currentTarget: { value: '0.4' } }); });
			await act(async () => { reactProps(input).onKeyDown({ key: 'Enter', nativeEvent: { isComposing: false },
				currentTarget: { blur() { reactProps(input).onBlur(); } },
				preventDefault() { prevented = true; }, stopPropagation() { stopped = true; },
			}); });
			assert.equal(writes.length, 1);
			assert.deepEqual(step.params, { start: 0.4, end: 0.5 });
		} finally {
			await act(async () => { root.unmount(); });
			dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		}
	});
}
