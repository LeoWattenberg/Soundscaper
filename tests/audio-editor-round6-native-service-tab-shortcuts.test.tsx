/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import SoundscaperNativeServicesDialog from '../src/common/editor/ui/dialogs/SoundscaperNativeServicesDialog.tsx';
import { EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE } from '../src/common/editor/ui/soundscaper-native-services-dialog-model.ts';
import type { SoundscaperNativeServicesBridge } from '../src/common/editor/ui/soundscaper-native-services-bridge.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('native audio service tabs release claimed and modified navigation while keeping their plain endpoints', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const state = EMPTY_SOUNDSCAPER_NATIVE_SERVICES_DIALOG_STATE;
	const runtime = { getState: () => state, subscribe: () => () => undefined,
		perform: () => Promise.resolve(state) };
	// The workspace runtime owns this view; no native operation starts in a tab gesture.
	const bridge = {} as SoundscaperNativeServicesBridge;
	try {
		await act(async () => root.render(<SoundscaperNativeServicesDialog bridge={bridge}
			runtime={runtime} initialSurface="native-audio-preferences" onClose={() => undefined} />));
		const tabs = dom.container.querySelectorAll('[role="tab"]');
		const nativeAudio = tabs[1]!;
		for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'defaultPrevented']) {
			let prevented = false;
			await act(async () => reactProps(nativeAudio).onKeyDown({ key: 'Home', currentTarget: nativeAudio,
				[modifier]: true, preventDefault() { prevented = true; } }));
			assert.equal(prevented, false, `${modifier} keeps its original key ownership`);
			assert.equal(nativeAudio.getAttribute('aria-selected'), 'true');
		}
		let prevented = false;
		await act(async () => reactProps(nativeAudio).onKeyDown({ key: 'Home', currentTarget: nativeAudio,
			preventDefault() { prevented = true; } }));
		assert.equal(prevented, true);
		assert.equal(tabs[0]!.getAttribute('aria-selected'), 'true');
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});
