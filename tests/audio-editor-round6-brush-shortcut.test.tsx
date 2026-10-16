/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SpectralBrushOverlay } from '../src/common/editor/ui/timeline/SpectralBrushOverlay.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const ownership of ['ctrlKey', 'metaKey', 'altKey', 'defaultPrevented', 'plain', 'shiftKey'] as const) {
	test(`spectral brush activation preserves ${ownership} ownership`, async () => {
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean; React?: typeof React };
		const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
		globals.React = React;
		globals.IS_REACT_ACT_ENVIRONMENT = true;
		const root = createRoot(dom.container as unknown as Element);
		const commits: unknown[] = [];
		try {
			await act(async () => root.render(<SpectralBrushOverlay
				track={{ spectrogram: { scale: 'linear', minimumFrequency: 0, maximumFrequency: 24_000 } }}
				displayMode="spectrogram" trackHeight={100} windowWidth={400} overscanStartFrame={0}
				pixelsPerSecond={100} sampleRate={48_000} disabled={false} copy={{ spectralBrush: 'Spectral brush' }}
				onCommit={(value: unknown) => commits.push(value)} />));
			const brush = dom.one('[data-spectral-brush]');
			for (const key of ['Enter', ' ']) {
				let prevented = false;
				let stopped = false;
				await act(async () => { reactProps(brush).onKeyDown?.({ key,
					...(ownership === 'plain' ? {} : { [ownership]: true }),
					preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; },
				}); });
				const owned = ownership === 'plain' || ownership === 'shiftKey';
				assert.equal(prevented, owned, key);
				assert.equal(stopped, owned, key);
			}
			assert.equal(commits.length, ownership === 'plain' || ownership === 'shiftKey' ? 2 : 0);
		} finally {
			await act(async () => root.unmount());
			globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		}
	});
}
