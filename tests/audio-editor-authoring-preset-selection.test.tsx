/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { useAvailableAuthoringPreset } from '../src/common/editor/ui/dialogs/useAvailableAuthoringPreset.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

Reflect.set(globalThis, 'React', React);

function Picker({ presets }: Readonly<{ presets: readonly Readonly<{ id: string }>[] }>) {
	const [id, setId] = useAvailableAuthoringPreset(presets);
	return <div><input value={id} onChange={(event) => setId(event.currentTarget.value)} />
		<button disabled={!id}>Apply selected preset</button></div>;
}

test('removing an authoring preset chooses a surviving target and clears an empty inventory', async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	try {
		await act(async () => { root.render(<Picker presets={[{ id: 'first' }, { id: 'second' }]} />); });
		const input = dom.container.querySelectorAll('input')[0];
		await act(async () => { reactProps(input).onChange({ currentTarget: { value: 'second' } }); });
		await act(async () => { root.render(<Picker presets={[{ id: 'first' }, { id: 'second' }, { id: 'third' }]} />); });
		assert.equal(input.value, 'second', 'unrelated inventory changes preserve a surviving selection');
		await act(async () => { root.render(<Picker presets={[{ id: 'first' }, { id: 'third' }]} />); });
		assert.equal(input.value, 'first');
		await act(async () => { root.render(<Picker presets={[]} />); });
		assert.equal(input.value, '');
		assert.equal(reactProps(dom.container.querySelectorAll('button')[0]).disabled, true);
	} finally {
		await act(async () => { root.unmount(); });
		dom.restore();
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});
