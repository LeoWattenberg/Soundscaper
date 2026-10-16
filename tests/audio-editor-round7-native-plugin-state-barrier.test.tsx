/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';

import NativePluginParameterControls, { type NativePluginParameterRuntime } from '../src/common/editor/ui/dialogs/NativePluginParameterControls.tsx';
import { createSoundscaperNativeServicesDialogRuntime, type SoundscaperNativeServicesDialogRuntime } from '../src/common/editor/ui/soundscaper-native-services-dialog-runtime.ts';
import type { SoundscaperNativeServicesBridge } from '../src/common/editor/ui/soundscaper-native-services-bridge.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

function Host({ parameters, runtime }: Readonly<{
	parameters: NativePluginParameterRuntime;
	runtime: SoundscaperNativeServicesDialogRuntime;
}>) {
	const state = useSyncExternalStore(runtime.subscribe, runtime.getState, runtime.getState);
	return <><NativePluginParameterControls instanceId="installed-gain" runtime={parameters} disabled={state.pending !== null} />
		<button disabled={state.pending !== null} onClick={() => {
			void runtime.perform({ type: 'persist-plugin-state', instanceId: 'installed-gain', generation: 1 });
		}}>Store state</button></>;
}

for (const outcome of ['applied', 'refused'] as const) test(`Store state waits for accepted native parameter positions before disabling and capturing them: ${outcome}`, async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as Element);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	let current = .25;
	const stored: number[] = [];
	const writes: { value: number; resolve(value: number): void; reject(error: Error): void }[] = [];
	const parameters: NativePluginParameterRuntime = {
		capabilities: async () => ({ parameterCount: 1, hasVendorUi: false }),
		describeParameters: async () => [{ index: 0, id: 'gain', name: 'Gain', label: '',
			minimumValue: 0, maximumValue: 1, defaultValue: .25, flags: 8 }],
		readParameter: async () => current,
		writeParameter: (_instanceId, _index, value) => new Promise<number>((resolve, reject) => {
			writes.push({ value, reject, resolve: (next) => { current = next; resolve(next); } });
		}),
	};
	const bridge = {
		persistNativePluginState: async () => {
			stored.push(current);
			return { outcome: { status: 'persisted' }, projectState: {
				stateBody: { kind: 'native-plugin-state', bodyId: 'saved-gain', sha256: '11'.repeat(32), byteLength: 1 },
			} };
		},
	} as unknown as SoundscaperNativeServicesBridge;
	const runtime = createSoundscaperNativeServicesDialogRuntime(bridge);
	try {
		await act(async () => root.render(<Host parameters={parameters} runtime={runtime} />));
		const range = dom.one('[data-native-plugin-parameter="gain"]');
		await act(async () => reactProps(range).onChange({ currentTarget: { value: '.4' } }));
		await act(async () => reactProps(range).onChange({ currentTarget: { value: '.9' } }));
		await act(async () => reactProps(dom.one('button')).onClick());
		assert.deepEqual(stored, [], 'Store state must not snapshot the old value while a write is pending');
		if (outcome === 'refused') {
			await act(async () => writes[0]!.reject(new Error('The host refused the parameter update.')));
			assert.deepEqual(stored, [], 'a refused edit must not be acknowledged by saving the old state');
			assert.match(runtime.getState().error, /host refused the parameter update/u);
			assert.equal(runtime.getState().pending, null);
			return;
		}
		await act(async () => writes[0]!.resolve(.4));
		assert.equal(writes[1]?.value, .9, 'Store state must retain the latest already accepted position');
		assert.deepEqual(stored, []);
		await act(async () => writes[1]!.resolve(.9));
		assert.deepEqual(stored, [.9]);
		assert.equal(runtime.getState().pending, null);
	} finally {
		for (const write of writes) write.resolve(write.value);
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
