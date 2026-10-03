/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
	DEFAULT_WAVEFORM_RULER_STATE,
	normalizeWaveformRulerFormat,
	type WaveformRulerFormat,
} from '../src/common/editor/ui/timeline/geometry.ts';
import { RulerFlyout } from '../vendor/audacity-design-system/components/src/RulerFlyout/RulerFlyout.tsx';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

test('waveform ruler menu offers logarithmic dB alongside both linear formats', () => {
	const markup = renderToStaticMarkup(<RulerFlyout
		isOpen onClose={() => undefined} x={0} y={0} mode="waveform"
		rulerFormat={DEFAULT_WAVEFORM_RULER_STATE.format}
	/>);
	assert.match(markup, /Linear \(amp\)/u);
	assert.match(markup, /Linear \(dB\)/u);
	assert.match(markup, /dB \(logarithmic\)/u);
	const radios = markup.match(/<div\b[^>]*\brole="radio"[^>]*>/gu) ?? [];
	assert.deepEqual(radios.map((radio) => radio.match(/\baria-label="([^"]*)"/u)?.[1]), [
		'Linear (amp)', 'Linear (dB)', 'dB (logarithmic)',
	]);
});

test('selecting logarithmic dB updates the controlled ruler menu and retains linear dB by default', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const selected: WaveformRulerFormat[] = [];
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	function ControlledRulerMenu() {
		const [format, setFormat] = useState<WaveformRulerFormat>(DEFAULT_WAVEFORM_RULER_STATE.format);
		return <RulerFlyout
			isOpen onClose={() => undefined} x={0} y={0} mode="waveform" rulerFormat={format}
			onRulerFormatChange={(value) => {
				const next = normalizeWaveformRulerFormat(value);
				selected.push(next);
				setFormat(next);
			}}
		/>;
	}
	try {
		await act(async () => root.render(<ControlledRulerMenu />));
		const inputs = dom.container.querySelectorAll('input');
		const linearInput = inputs.find((input) => input.value === 'linear-db');
		const logarithmicInput = inputs.find((input) => input.value === 'logarithmic-db');
		assert.ok(linearInput);
		assert.ok(logarithmicInput);
		assert.equal(linearInput.checked, true);
		assert.equal(logarithmicInput.checked, false);
		const logarithmicRadio = logarithmicInput.parentNode as ReactTestElement;
		await act(async () => reactProps(logarithmicRadio).onClick?.());
		assert.deepEqual(selected, ['logarithmic-db']);
		assert.equal(linearInput.checked, false);
		assert.equal(logarithmicInput.checked, true);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
