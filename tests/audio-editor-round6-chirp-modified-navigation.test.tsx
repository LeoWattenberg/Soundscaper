/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { GeneratorRadioGroup } from '../src/common/editor/ui/dialogs/GeneratorDialogFields.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const ownership of ['ctrlKey', 'altKey', 'metaKey', 'defaultPrevented'] as const) {
	test(`Chirp radio navigation respects ${ownership} ownership`, async () => {
		const dom = installReactTestDom();
		const root = createRoot(dom.container as unknown as Element);
		const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		const selections: string[] = [];
		let prevented = 0;
		function Interpolation() {
			const [value, setValue] = useState('linear');
			return <GeneratorRadioGroup label="Interpolation" value={value}
				options={[[ 'linear', 'Linear' ], [ 'logarithmic', 'Logarithmic' ]]}
				onChange={(next: string) => { selections.push(next); setValue(next); }} />;
		}
		try {
			await act(async () => { root.render(<Interpolation />); });
			const group = dom.one('[role="radiogroup"]');
			const linear = dom.one('[aria-label="Linear"]');
			linear.focus();
			const event = {
				key: 'ArrowRight', ctrlKey: false, altKey: false, metaKey: false,
				defaultPrevented: false, [ownership]: true,
				preventDefault: () => { prevented += 1; },
			};
			await act(async () => { reactProps(group).onKeyDown?.(event); });
			assert.deepEqual(selections, []);
			assert.equal(prevented, 0);
			assert.equal(linear.getAttribute('aria-checked'), 'true');
			assert.equal(linear.ownerDocument.activeElement, linear);
			await act(async () => { reactProps(group).onKeyDown?.({ ...event, [ownership]: false }); });
			const logarithmic = dom.one('[aria-label="Logarithmic"]');
			assert.deepEqual(selections, ['logarithmic']);
			assert.equal(prevented, 1);
			assert.equal(logarithmic.getAttribute('aria-checked'), 'true');
		} finally {
			await act(async () => { root.unmount(); });
			actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		}
	});
}
