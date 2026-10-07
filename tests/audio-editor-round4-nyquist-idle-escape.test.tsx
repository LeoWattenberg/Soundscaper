/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import NyquistNumberInput from '../src/common/editor/ui/dialogs/NyquistNumberInput.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const completion of ['cancel', 'commit'] as const) {
	test(`Nyquist idle Escape remains unconsumed after ${completion}`, async () => {
		const dom = installReactTestDom();
		const root = createRoot(dom.container as unknown as HTMLElement);
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		let value = 0.8;
		const render = (): void => { root.render(<NyquistNumberInput value={value} minimum={0} maximum={1}
			integer={false} disabled={false} onChange={next => { value = next; render(); }} />); };
		let prevented = 0, stopped = 0;
		const key = async (name: string): Promise<void> => {
			await act(async () => { reactProps(dom.one('input')).onKeyDown?.({ key: name,
				preventDefault() { prevented += 1; }, stopPropagation() { stopped += 1; } }); });
		};
		try {
			await act(async () => { render(); });
			await act(async () => { reactProps(dom.one('input')).onFocus?.(); });
			await act(async () => { reactProps(dom.one('input')).onChange?.({ currentTarget: { value: '0.5', valueAsNumber: 0.5 } }); });
			await key(completion === 'cancel' ? 'Escape' : 'Enter');
			assert.equal(value, completion === 'cancel' ? 0.8 : 0.5);
			assert.equal(prevented, 1);
			const previousStopped = stopped;
			await key('Escape');
			assert.equal(prevented, 1);
			assert.equal(stopped, previousStopped);
			await act(async () => { reactProps(dom.one('input')).onBlur?.(); });
			assert.equal(value, completion === 'cancel' ? 0.8 : 0.5);
		} finally {
			await act(async () => { root.unmount(); });
			dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		}
	});
}
