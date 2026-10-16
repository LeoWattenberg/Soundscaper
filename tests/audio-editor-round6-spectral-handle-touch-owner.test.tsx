/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SpectralSelectionOverlay } from '../src/common/editor/ui/timeline/SpectralSelectionOverlay.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const initial = { startFrame: 4_800, endFrame: 24_000, minimumFrequency: 2_000, maximumFrequency: 12_000 };
const handles = [
	['frequency-center', { minimumFrequency: 10_000, maximumFrequency: 20_000 }],
	['frequency-maximum', { maximumFrequency: 15_000 }],
	['frequency-minimum', { minimumFrequency: 11_999 }],
	['time-start', { startFrame: 18_240 }],
	['time-end', { endFrame: 18_240 }],
] as const;

for (const [kind, expected] of handles) for (const interrupted of [true, false]) {
	test(`${kind} ${interrupted ? 'retains its first touch owner' : 'completes a primary drag'}`, async () => {
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
		globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
		const commits: unknown[] = [], captures: number[] = [];
		const root = createRoot(dom.container as unknown as Element);
		try {
			await act(async () => root.render(<div className="audio-editor-track-window" data-track-lane>
				<SpectralSelectionOverlay selection={{ startFrame: initial.startFrame, endFrame: initial.endFrame,
					frequencyRange: { minimumFrequency: initial.minimumFrequency, maximumFrequency: initial.maximumFrequency } }}
					track={{ spectrogram: { scale: 'linear' } }} displayMode="spectrogram" trackHeight={100}
					windowWidth={400} overscanStartFrame={0} pixelsPerSecond={100} sampleRate={48_000}
					maximumFrame={48_000} disabled={false} copy={{ spectralMaximumHandle: 'Maximum' }}
					onCommit={(value: unknown) => commits.push(value)} /></div>));
			const handle = dom.one(`.audio-editor-spectral-selection__handle--${kind}`);
			Object.assign(handle, { setPointerCapture: (id: number) => captures.push(id) });
			const pointer = (clientX: number, clientY: number, pointerId = 1) => ({ currentTarget: handle,
				button: 0, pointerId, isPrimary: pointerId === 1, clientX, clientY, preventDefault() {}, stopPropagation() {} });
			await act(async () => reactProps(handle).onPointerDown(pointer(30, 75)));
			await act(async () => reactProps(handle).onPointerMove(pointer(40, 65)));
			if (interrupted) {
				await act(async () => reactProps(handle).onPointerDown(pointer(40, 65, 2)));
				await act(async () => reactProps(handle).onPointerMove(pointer(45, 60, 2)));
				await act(async () => reactProps(handle).onPointerUp(pointer(45, 60, 2)));
			}
			await act(async () => reactProps(handle).onPointerMove(pointer(50, 50)));
			await act(async () => reactProps(handle).onPointerUp(pointer(50, 50)));
			assert.deepEqual(commits, [{ ...initial, ...expected }]);
			assert.deepEqual(captures, [1]);
		} finally {
			await act(async () => root.unmount());
			globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		}
	});
}
