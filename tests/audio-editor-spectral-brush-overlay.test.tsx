/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SpectralBrushOverlay } from '../src/common/editor/ui/timeline/SpectralBrushOverlay.jsx';
import { SpectralSelectionOverlay } from '../src/common/editor/ui/timeline/SpectralSelectionOverlay.jsx';
import { spectrogramFrequencyAtFraction } from '../src/common/editor/ui/timeline/geometry.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('spectral brush normalizes the persisted log scale before mapping frequency', async () => {
	const commits: Array<{ centerFrequency: number }> = [];
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const runtimeGlobal = globalThis as typeof globalThis & { React?: typeof React };
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	runtimeGlobal.React = React;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<SpectralBrushOverlay
			track={{ spectrogram: { scale: 'log', minimumFrequency: 0, maximumFrequency: 24_000 } }}
			displayMode="spectrogram"
			trackHeight={100}
			windowWidth={400}
			overscanStartFrame={0}
			pixelsPerSecond={100}
			sampleRate={48_000}
			disabled={false}
			copy={{ spectralBrush: 'Spectral brush' }}
			onCommit={(selection) => commits.push(selection)}
		/>));

		await act(async () => reactProps(dom.one('[data-spectral-brush]')).onKeyDown({
			key: 'Enter',
			preventDefault() {},
			stopPropagation() {},
		}));

		const brush = dom.one('[data-spectral-brush]');
		const brushStyle = brush.style as unknown as { top?: string; height?: string };
		assert.equal(brushStyle.top, '20px');
		assert.equal(brushStyle.height, '80px');
		assert.equal(commits.length, 1);
		assert.equal(
			commits[0]?.centerFrequency,
			Math.round(spectrogramFrequencyAtFraction(0.5, 'logarithmic', 0, 24_000)),
		);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});

test('spectral selection covers the clip body below its header', () => {
	const runtimeGlobal = globalThis as typeof globalThis & { React?: typeof React };
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	runtimeGlobal.React = React;
	try {
		const markup = renderToStaticMarkup(<SpectralSelectionOverlay
			selection={{
				startFrame: 0,
				endFrame: 48_000,
				frequencyRange: { minimumFrequency: 0, maximumFrequency: 24_000 },
			}}
			track={{ spectrogram: { scale: 'linear', minimumFrequency: 0, maximumFrequency: 24_000 } }}
			displayMode="spectrogram"
			trackHeight={120}
			windowWidth={400}
			overscanStartFrame={0}
			pixelsPerSecond={100}
			sampleRate={48_000}
			maximumFrame={48_000}
			disabled={false}
			copy={{}}
			onCommit={() => undefined}
		/>);

		assert.match(markup, /data-spectral-selection="true" style="[^"]*top:20px;[^"]*height:100px/);
	} finally {
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
	}
});
