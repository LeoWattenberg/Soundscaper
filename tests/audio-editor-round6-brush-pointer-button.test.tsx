/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SpectralBrushOverlay } from '../src/common/editor/ui/timeline/SpectralBrushOverlay.jsx';
import { SpectralSelectionOverlay } from '../src/common/editor/ui/timeline/SpectralSelectionOverlay.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const button of [0, 1, 2]) test(`spectral brush pointer start owns only a primary button: ${button}`, async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const commits: unknown[] = [];
	try {
		await act(async () => root.render(<SpectralBrushOverlay
			track={{ spectrogram: { scale: 'linear', minimumFrequency: 0, maximumFrequency: 24_000 } }}
			displayMode="spectrogram" trackHeight={100} windowWidth={400} overscanStartFrame={0}
			pixelsPerSecond={100} sampleRate={48_000} disabled={false} copy={{ spectralBrush: 'Spectral brush' }}
			onCommit={(value: unknown) => commits.push(value)} />));
		const brush = dom.one('[data-spectral-brush]');
		let captured = false;
		let prevented = false;
		Object.defineProperty(brush, 'setPointerCapture', { configurable: true, value: () => { captured = true; } });
		const event = { currentTarget: brush, pointerId: 1, button, clientX: 40, clientY: 30,
			preventDefault: () => { prevented = true; }, stopPropagation() {} };
		await act(async () => { reactProps(brush).onPointerDown?.(event); });
		assert.equal(captured, button === 0);
		assert.equal(prevented, button === 0);
		await act(async () => { reactProps(brush).onPointerMove?.({ ...event, clientX: 60 }); });
		await act(async () => { reactProps(brush).onPointerUp?.({ ...event, clientX: 60 }); });
		assert.equal(commits.length, button === 0 ? 1 : 0);
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});

for (const button of [0, 1, 2]) test(`spectral band pointer start owns only a primary button: ${button}`, async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const commits: unknown[] = [];
	try {
		await act(async () => root.render(<div className="audio-editor-track-window" data-track-lane>
			<SpectralSelectionOverlay selection={{ startFrame: 0, endFrame: 24_000, frequencyRange: { minimumFrequency: 2_000, maximumFrequency: 12_000 } }}
				track={{ spectrogram: { scale: 'linear' } }} displayMode="spectrogram" trackHeight={100}
				windowWidth={400} overscanStartFrame={0} pixelsPerSecond={100} sampleRate={48_000}
				maximumFrame={48_000} disabled={false} copy={{ spectralMaximumHandle: 'Maximum' }}
				onCommit={(value: unknown) => commits.push(value)} /></div>));
		const handle = dom.one('.audio-editor-spectral-selection__handle--frequency-maximum');
		let captured = false;
		Object.defineProperty(handle, 'setPointerCapture', { configurable: true, value: () => { captured = true; } });
		const event = { currentTarget: handle, pointerId: 1, button, clientX: 40, clientY: 50,
			preventDefault() {}, stopPropagation() {} };
		await act(async () => { reactProps(handle).onPointerDown?.(event); });
		assert.equal(captured, button === 0);
		await act(async () => { reactProps(handle).onPointerMove?.({ ...event, clientY: 30 }); });
		await act(async () => { reactProps(handle).onPointerUp?.(event); });
		assert.equal(commits.length, button === 0 ? 1 : 0);
		if (button === 0) assert.notEqual(handle.getAttribute('aria-valuenow'), '12000');
		else assert.equal(handle.getAttribute('aria-valuenow'), '12000');
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
