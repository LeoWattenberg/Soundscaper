/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SpectralBrushOverlay } from '../src/common/editor/ui/timeline/SpectralBrushOverlay.jsx';
import { audioEditorClipBodyGeometry } from '../src/common/editor/ui/timeline/geometry.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const ratio of [.5, .3]) void test(`stereo spectral brush uses each displayed channel at ratio ${ratio}`, async () => {
	const fixture = await mountBrush(2, ratio);
	try {
		await fixture.click(fixture.height * ratio / 2);
		await fixture.click(fixture.height * (ratio + (1 - ratio) / 2));
		assert.equal(fixture.commits[0]?.centerFrequency, 12_000);
		assert.equal(fixture.commits[1]?.centerFrequency, 12_000);
		assert.equal(fixture.commits[0]?.centerFrame, fixture.commits[1]?.centerFrame);
	} finally { await fixture.cleanup(); }
});

void test('ordinary mono spectral brush retains its displayed frequency center', async () => {
	const fixture = await mountBrush(1, .5);
	try {
		await fixture.click(fixture.height / 2);
		assert.equal(fixture.commits[0]?.centerFrequency, 12_000);
	} finally { await fixture.cleanup(); }
});

async function mountBrush(channelCount: number, channelHeightRatio: number) {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const commits: { centerFrequency: number; centerFrame: number }[] = [];
	const props = { track: { spectrogram: { scale: 'linear', minimumFrequency: 0, maximumFrequency: 24_000 } },
		displayMode: 'spectrogram', trackHeight: 200, channelCount, channelHeightRatio,
		windowWidth: 400, overscanStartFrame: 0, pixelsPerSecond: 100, sampleRate: 48_000,
		disabled: false, copy: { spectralBrush: 'Spectral brush' }, onCommit: (value: typeof commits[number]) => commits.push(value) };
	await act(async () => root.render(<SpectralBrushOverlay {...props} />));
	const brush = dom.one('[data-spectral-brush]');
	const height = audioEditorClipBodyGeometry(props.trackHeight).height;
	Object.defineProperty(brush, 'getBoundingClientRect', { configurable: true, value: () => ({ left: 0, top: 0, width: 400, height }) });
	const event = (y: number) => ({ currentTarget: brush, pointerId: 1, button: 0, isPrimary: true,
		clientX: 80, clientY: y, preventDefault() {}, stopPropagation() {} });
	return { commits, height,
		async click(y: number) {
			await act(async () => { reactProps(brush).onPointerDown?.(event(y)); });
			await act(async () => { reactProps(brush).onPointerUp?.(event(y)); });
		},
		async cleanup() {
			await act(async () => root.unmount());
			globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
			if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		},
	};
}
