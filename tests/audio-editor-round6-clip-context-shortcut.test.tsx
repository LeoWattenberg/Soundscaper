/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TrackNew } from '../vendor/audacity-design-system/components/src/Track/TrackNew.tsx';
import { ThemeProvider } from '../vendor/audacity-design-system/components/src/ThemeProvider/ThemeProvider.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const owner of ['plain', 'ctrlKey', 'metaKey', 'altKey', 'defaultPrevented']) test(`native clip menu entry respects ${owner} ownership`, async () => {
	const dom = installReactTestDom();
	Object.defineProperty(window, 'getComputedStyle', { configurable: true, value: () => ({ display: 'block', visibility: 'visible' }) });
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	let opened = 0;
	let claimed = false;
	try {
		await act(async () => root.render(<ThemeProvider><TrackNew
			clips={[{ id: 'recording', name: 'Original', start: 0, duration: 1, selected: true, waveform: [] }]}
			trackIndex={0} width={800} onClipMenuClick={() => { opened += 1; }} /></ThemeProvider>));
		const clip = dom.one('[data-clip-id="recording"]');
		await act(async () => { reactProps(clip).onKeyDown?.({ key: 'F10', shiftKey: true,
			currentTarget: clip, target: clip, [owner]: owner !== 'plain',
			preventDefault: () => { claimed = true; }, stopPropagation() {} }); });
		assert.equal(opened, owner === 'plain' ? 1 : 0);
		assert.equal(claimed, owner === 'plain');
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
