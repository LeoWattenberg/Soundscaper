/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { SpectralSelectionOverlay } from '../src/common/editor/ui/timeline/SpectralSelectionOverlay.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const kind of ['time-start', 'time-end', 'frequency-minimum', 'frequency-maximum', 'frequency-center']) {
	test(`spectral ${kind} leaves modified and handled commands available`, async () => {
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean; React?: typeof React };
		const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
		const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		globals.IS_REACT_ACT_ENVIRONMENT = true;
		globals.React = React;
		const { createRoot } = await import('react-dom/client');
		const root = createRoot(dom.container as unknown as Element);
		const commits: unknown[] = [];
		try {
			await act(async () => root.render(<SpectralSelectionOverlay
				selection={{ startFrame: 4_800, endFrame: 24_000, frequencyRange: { minimumFrequency: 2_000, maximumFrequency: 12_000 } }}
				track={{ spectrogram: { scale: 'linear' } }} displayMode="spectrogram" trackHeight={100}
				windowWidth={400} overscanStartFrame={0} pixelsPerSecond={100} sampleRate={48_000}
				maximumFrame={48_000} disabled={false} copy={{}}
				onCommit={(value: unknown) => commits.push(value)} />));
			const handle = dom.one(`.audio-editor-spectral-selection__handle--${kind}`);
			const original = handle.getAttribute('aria-valuenow');
			for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'defaultPrevented']) {
				let consumed = false;
				await act(async () => reactProps(handle).onKeyDown?.({ key: 'ArrowRight', [modifier]: true,
					preventDefault() { consumed = true; }, stopPropagation() { consumed = true; } }));
				assert.equal(consumed, false, modifier);
				assert.equal(commits.length, 0, modifier);
				assert.equal(handle.getAttribute('aria-valuenow'), original, modifier);
			}
			let consumed = false;
			await act(async () => reactProps(handle).onKeyDown?.({ key: 'ArrowRight',
				preventDefault() { consumed = true; }, stopPropagation() { consumed = true; } }));
			assert.equal(consumed, true);
			assert.equal(commits.length, 1);
			assert.notEqual(handle.getAttribute('aria-valuenow'), original);
		} finally {
			await act(async () => root.unmount());
			globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		}
	});
}
