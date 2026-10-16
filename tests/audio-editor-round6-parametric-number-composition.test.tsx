/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ParametricEqNumericInput } from '../src/common/editor/ui/ParametricEqNumericInput.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const key of ['Enter', 'Escape']) {
	test(`the parametric equalizer's numeric draft releases composing ${key}`, async () => {
		const dom = installReactTestDom();
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		const root = createRoot(dom.container as unknown as Element);
		const writes: number[] = [];
		try {
			await act(async () => { root.render(<ParametricEqNumericInput value={3} min={-30} max={30}
				step={0.1} disabled={false} onCommit={(value: number) => { writes.push(value); }} />); });
			const input = dom.one('input');
			await act(async () => { reactProps(input).onFocus(); });
			await act(async () => { reactProps(input).onChange({ currentTarget: { value: '4' } }); });
			let prevented = false; let stopped = false;
			await act(async () => { reactProps(input).onKeyDown({ key, nativeEvent: { isComposing: true },
				currentTarget: { blur() { reactProps(input).onBlur(); } },
				preventDefault() { prevented = true; }, stopPropagation() { stopped = true; },
			}); });
			assert.deepEqual(writes, [], 'the native composition cannot publish an incomplete equalizer value');
			assert.equal(input.value, '4', 'native cancellation retains the application draft');
			assert.equal(prevented || stopped, false);
			await act(async () => { reactProps(input).onChange({ currentTarget: { value: '6' } }); });
			await act(async () => { reactProps(input).onKeyDown({ key: 'Enter', nativeEvent: { isComposing: false },
				currentTarget: { blur() { reactProps(input).onBlur(); } },
				preventDefault() { prevented = true; }, stopPropagation() { stopped = true; },
			}); });
			assert.deepEqual(writes, [6]);
		} finally {
			await act(async () => { root.unmount(); });
			dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		}
	});
}
