/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import { NumberStepper } from '../vendor/audacity-design-system/components/src/NumberStepper/NumberStepper.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

type KeyOptions = Partial<Pick<React.KeyboardEvent<HTMLInputElement>,
	'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'defaultPrevented'>> & { isComposing?: boolean };

async function withStepper(run: (key: (name: string, options?: KeyOptions) => Promise<boolean>,
	value: () => string, editing: () => boolean) => Promise<void>): Promise<void> {
	const dom = installReactTestDom();
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	try {
		await act(async () => { root.render(<NumberStepper defaultValue="1000" />); });
		const input = dom.one('.number-stepper__input');
		await act(async () => { reactProps(input).onClick(); });
		await run(async (name, options = {}) => {
			let prevented = false;
			await act(async () => { reactProps(input).onKeyDown({ key: name, ctrlKey: false,
				metaKey: false, altKey: false, shiftKey: false, defaultPrevented: false, ...options,
				nativeEvent: { isComposing: options.isComposing ?? false },
				preventDefault: () => { prevented = true; } }); });
			return prevented;
		}, () => input.value, () => dom.one('.number-stepper').getAttribute('class')?.includes('number-stepper--editing') === true);
	} finally {
		await act(async () => { root.unmount(); });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
}

const ownedKeys: readonly [string, string, KeyOptions][] = [
	['Ctrl arrow', 'ArrowUp', { ctrlKey: true }],
	['Meta arrow', 'ArrowDown', { metaKey: true }],
	['Alt Enter', 'Enter', { altKey: true }],
	['composing arrow', 'ArrowUp', { isComposing: true }],
	['composing Enter', 'Enter', { isComposing: true }],
	['composing Escape', 'Escape', { isComposing: true }],
	['already handled arrow', 'ArrowUp', { defaultPrevented: true }],
];
for (const [name, keyName, options] of ownedKeys) test(`shared number stepper releases ${name}`, async () => {
	await withStepper(async (key, value, editing) => {
		assert.equal(await key('ArrowUp'), true);
		assert.equal(value(), '1001');
		assert.equal(await key(keyName, options), false);
		assert.equal(value(), '1001');
		assert.equal(editing(), true);
		assert.equal(await key('ArrowDown'), true);
		assert.equal(value(), '1000');
	});
});

test('shared number stepper retains plain and Shift edits and completed mode keys', async () => {
	await withStepper(async (key, value, editing) => {
		assert.equal(await key('ArrowUp', { shiftKey: true }), true);
		assert.equal(value(), '1001');
		assert.equal(await key('Escape'), true);
		assert.equal(editing(), false);
		assert.equal(await key('ArrowDown'), false);
		assert.equal(value(), '1001');
		assert.equal(await key('Enter'), true);
		assert.equal(editing(), true);
		assert.equal(await key('ArrowDown'), true);
		assert.equal(value(), '1000');
	});
});
