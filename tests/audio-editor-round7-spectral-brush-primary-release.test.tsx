/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SpectralBrushOverlay } from '../src/common/editor/ui/timeline/SpectralBrushOverlay.jsx';
import type { SpectralBrushSelectionRequest } from '../src/common/editor/ui/timeline/spectral-brush-model.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const buttons of [4, 2]) for (const phase of ['release', 'auxiliary', 'foreign', 'pen', 'touch'] as const) {
	test(`spectral brush preserves ${phase} ownership with buttons ${String(buttons)}`, async () => {
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
		globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
		const root = createRoot(dom.container as unknown as Element);
		const commits: SpectralBrushSelectionRequest[] = [];
		try {
			await act(async () => root.render(<SpectralBrushOverlay
				track={{ spectrogram: { scale: 'linear', minimumFrequency: 0, maximumFrequency: 24_000 } }}
				displayMode="spectrogram" trackHeight={100} windowWidth={400} overscanStartFrame={0}
				pixelsPerSecond={100} sampleRate={48_000} disabled={false} copy={{ spectralBrush: 'Spectral brush' }}
				onCommit={(value: SpectralBrushSelectionRequest) => commits.push(value)} />));
			const brush = dom.one('[data-spectral-brush]');
			Object.assign(brush, { setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 100 }) });
			const pointer = (clientX: number, pointerId = 1) => ({ currentTarget: brush, target: brush,
				pointerId, isPrimary: pointerId !== 2, button: 0, buttons: 1, clientX, clientY: 30,
				pointerType: phase === 'pen' || phase === 'touch' ? phase : 'mouse', preventDefault() {}, stopPropagation() {} });
			await act(async () => reactProps(brush).onPointerDown(pointer(80)));
			await act(async () => reactProps(brush).onPointerMove(pointer(92)));
			await act(async () => reactProps(brush).onPointerMove({ ...pointer(92, phase === 'foreign' ? 2 : 1),
				button: phase === 'auxiliary' ? 1 : 0, buttons }));
			if (phase !== 'release') {
				assert.equal(commits.length, 0, 'unrelated state changes do not finish the owner');
				await act(async () => reactProps(brush).onPointerUp(pointer(92)));
			}
			assert.equal(commits.length, 1, 'primary completion publishes exactly once');
			assert.equal(commits[0]?.radiusFrames, 5_760, 'the authored radius uses the primary release position');
			const healthy = commits[0];
			await act(async () => reactProps(brush).onPointerMove({ ...pointer(104), button: -1, buttons }));
			await act(async () => reactProps(brush).onPointerUp(pointer(104)));
			assert.deepEqual(commits, [healthy], 'later motion/release does not enlarge the saved band');
			await act(async () => reactProps(brush).onPointerDown(pointer(140, 3)));
			await act(async () => reactProps(brush).onPointerUp(pointer(152, 3)));
			assert.equal(commits.length, 2, 'a later ordinary stroke remains available');
			assert.equal(commits[1]?.radiusFrames, 5_760);
		} finally {
			await act(async () => root.unmount());
			globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
			if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		}
	});
}
