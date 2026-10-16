/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { SpectralSelectionOverlay } from '../src/common/editor/ui/timeline/SpectralSelectionOverlay.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('existing spectral band cancellation restores its draft and cannot publish on release', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean; React?: typeof React };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	globals.React = React;
	const owner = dom.container.ownerDocument.defaultView as unknown as Window;
	const callbacks = new Set<EventListenerOrEventListenerObject>();
	owner.addEventListener = (type: string, callback: EventListenerOrEventListenerObject | null) => { if (type === 'keydown' && callback) callbacks.add(callback); };
	owner.removeEventListener = (type: string, callback: EventListenerOrEventListenerObject | null) => { if (type === 'keydown' && callback) callbacks.delete(callback); };
	const { createRoot } = await import('react-dom/client');
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
		const pointer = { currentTarget: handle, pointerId: 1, button: 0, clientX: 20, clientY: 50, preventDefault() {}, stopPropagation() {} };
		await act(async () => reactProps(handle).onPointerDown?.(pointer));
		await act(async () => reactProps(handle).onPointerMove?.({ ...pointer, clientY: 30 }));
		assert.notEqual(handle.getAttribute('aria-valuenow'), '12000');
		await act(async () => {
			const escape = { key: 'Escape', preventDefault() {}, stopPropagation() {} } as unknown as Event;
			for (const callback of callbacks) {
				if (typeof callback === 'function') callback(escape);
				else callback.handleEvent(escape);
			}
		});
		assert.equal(handle.getAttribute('aria-valuenow'), '12000');
		await act(async () => reactProps(handle).onPointerUp?.(pointer));
		assert.equal(commits.length, 0);
		await act(async () => reactProps(handle).onPointerDown?.(pointer));
		await act(async () => reactProps(handle).onPointerMove?.({ ...pointer, clientY: 30 }));
		await act(async () => reactProps(handle).onPointerUp?.(pointer));
		assert.equal(commits.length, 1);
	} finally {
		await act(async () => root.unmount());
		assert.equal(callbacks.size, 0);
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
