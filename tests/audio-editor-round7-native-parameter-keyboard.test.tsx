/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import NativePluginParameterControls, { type NativePluginParameterRuntime } from '../src/common/editor/ui/dialogs/NativePluginParameterControls.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const [minimumValue, maximumValue] of [[0, 1], [.2, .6]]) test(`installed native parameter keys adjust within ${String(minimumValue)}–${String(maximumValue)}`, async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as Element);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	let current: number = .3;
	const writes: number[] = [];
	const runtime: NativePluginParameterRuntime = {
		capabilities: async () => ({ parameterCount: 1, hasVendorUi: false }),
		describeParameters: async () => [{ index: 0, id: 'gain', name: 'Gain', label: '',
			minimumValue: minimumValue!, maximumValue: maximumValue!, defaultValue: .3, flags: 8 }],
		readParameter: async () => current,
		writeParameter: async (_id, _index, value) => { current = value; writes.push(value); return value; },
	};
	try {
		await act(async () => root.render(<NativePluginParameterControls instanceId="normal-installed-gain" runtime={runtime} />));
		const range = dom.one('[data-native-plugin-parameter="gain"]');
		await act(async () => reactProps(range).onChange({ currentTarget: { value: '.333333' } }));
		assert.equal(current, .333333, 'pointer editing retains its continuous value');
		const key = async (name: string): Promise<void> => {
			await act(async () => reactProps(range).onKeyDown?.({ key: name, currentTarget: range,
				preventDefault() {}, defaultPrevented: false, altKey: false, ctrlKey: false, metaKey: false }));
		};
		for (const name of ['ArrowRight', 'ArrowUp']) {
			const before: number = current;
			await key(name);
			assert.ok(Math.abs(current - before - (maximumValue! - minimumValue!) / 100) < 1e-12,
				'an ordinary arrow must deliver one percent of the declared range to the host');
		}
		for (const name of ['ArrowLeft', 'ArrowDown']) await key(name);
		assert.ok(Math.abs(current - .333333) < 1e-12);
		assert.equal(writes.length, 5);
		await act(async () => reactProps(range).onChange({ currentTarget: { value: String(maximumValue) } }));
		await key('ArrowRight');
		assert.equal(current, maximumValue, 'keyboard adjustments remain in the installed parameter range');
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
