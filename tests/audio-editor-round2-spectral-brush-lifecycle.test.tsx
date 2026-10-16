/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { SpectralBrushOverlay } from '../src/common/editor/ui/timeline/SpectralBrushOverlay.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('Escape discards a spectral brush draft and pointer release cannot commit it', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean; React?: typeof React };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	actGlobal.React = React;
	const document = dom.container.ownerDocument.defaultView as unknown as Window;
	const callbacks = new Set<EventListenerOrEventListenerObject>();
	document.addEventListener = (type: string, callback: EventListenerOrEventListenerObject | null) => { if (type === 'keydown' && callback) callbacks.add(callback); };
	document.removeEventListener = (type: string, callback: EventListenerOrEventListenerObject | null) => { if (type === 'keydown' && callback) callbacks.delete(callback); };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const commits: unknown[] = [];
	try {
		await act(async () => root.render(<SpectralBrushOverlay
			track={{ spectrogram: { scale: 'linear', minimumFrequency: 0, maximumFrequency: 24_000 } }}
			displayMode="spectrogram" trackHeight={100} windowWidth={400}
			overscanStartFrame={0} pixelsPerSecond={100} sampleRate={48_000}
			disabled={false} copy={{ spectralBrush: 'Spectral brush' }}
			onCommit={(value: unknown) => commits.push(value)} />));
		const surface = dom.one('[data-spectral-brush]');
		const pointer = { currentTarget: surface, pointerId: 1, button: 0, clientX: 20, clientY: 30,
			preventDefault() {}, stopPropagation() {} };
		await act(async () => reactProps(surface).onPointerDown?.(pointer));
		await act(async () => reactProps(surface).onPointerMove?.({ ...pointer, clientX: 40 }));
		assert.ok(dom.find('.audio-editor-spectral-brush__preview'));
		await act(async () => {
			const escape = { key: 'Escape', preventDefault() {}, stopPropagation() {} } as unknown as Event;
			for (const callback of callbacks) {
				if (typeof callback === 'function') callback(escape);
				else callback.handleEvent(escape);
			}
		});
		assert.equal(dom.find('.audio-editor-spectral-brush__preview'), null);
		await act(async () => reactProps(surface).onPointerUp?.(pointer));
		assert.equal(commits.length, 0);
		await act(async () => reactProps(surface).onPointerDown?.(pointer));
		await act(async () => reactProps(surface).onPointerUp?.({ ...pointer, clientX: 40 }));
		assert.equal(commits.length, 1);
	} finally {
		await act(async () => root.unmount());
		assert.equal(callbacks.size, 0);
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
