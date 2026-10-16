/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import SoundscaperNativeServicesDialog from '../src/common/editor/ui/dialogs/SoundscaperNativeServicesDialog.tsx';
import { EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE,
	type SoundscaperNativeServicesDialogAction, type SoundscaperNativeServicesDialogState,
} from '../src/common/editor/ui/soundscaper-native-services-dialog-model.ts';
import type { SoundscaperNativeServicesBridge } from '../src/common/editor/ui/soundscaper-native-services-bridge.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('native route channels keep intermediate text outside the completed session request', async () => {
	const dom = installReactTestDom();
	const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = environment.IS_REACT_ACT_ENVIRONMENT;
	environment.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const state: SoundscaperNativeServicesDialogState = {
		...EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE,
		audio: { enabled: true, quarantined: false, payload: { status: 'available', reason: null, detail: '' }, backends: ['alsa'] },
		devices: { status: 'described', inventory: { backend: 'alsa', status: 'ready', detail: '',
			devices: [{ handle: 'studio-interface', label: 'Studio interface', direction: 'duplex', channelCount: 8 }] } },
	};
	const actions: SoundscaperNativeServicesDialogAction[] = [];
	const runtime = { getState: () => state, subscribe: () => () => undefined,
		perform: (action: SoundscaperNativeServicesDialogAction) => { actions.push(action); return Promise.resolve(state); } };
	// The workspace-owned runtime supplies the normal described device inventory.
	const bridge = {} as SoundscaperNativeServicesBridge;
	try {
		await act(async () => root.render(<SoundscaperNativeServicesDialog bridge={bridge}
			runtime={runtime} initialSurface="native-audio-device" onClose={() => undefined} />));
		const channels = dom.one('[data-native-audio-channel-count]');
		assert.equal(channels.value, '2');
		await act(async () => reactProps(channels).onChange({ currentTarget: { value: '' } }));
		assert.equal(channels.value, '', 'empty replacement text must not become an authored one-channel request');
		await act(async () => reactProps(channels).onChange({ currentTarget: { value: '5' } }));
		await act(async () => reactProps(channels).onBlur());
		assert.equal(channels.value, '5');
		await act(async () => reactProps(dom.one('[data-native-audio-open]')).onClick());
		const request = actions.find(action => action.type === 'open-audio-session');
		assert.ok(request?.type === 'open-audio-session');
		assert.equal(request.request.channelCount, 5, 'only the completed valid count reaches native session admission');
		await act(async () => reactProps(channels).onChange({ currentTarget: { value: '' } }));
		await act(async () => reactProps(channels).onBlur());
		assert.equal(channels.value, '5', 'an omitted completed count restores its existing native setting');
	} finally {
		await act(async () => root.unmount());
		environment.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
