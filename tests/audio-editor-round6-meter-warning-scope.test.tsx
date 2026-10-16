/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { AudacityAudioMeter } from '../src/common/editor/ui/toolbar/AudioEditorMeters.jsx';
import { DEFAULT_PLAYBACK_METER_SETTINGS, type MeterSettings } from '../src/common/editor/ui/meter-settings.ts';

function renderMeter(type: MeterSettings['type'], maximumTruePeakDbtp: number, clipped = false): string {
	const prior = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	try {
		return renderToStaticMarkup(React.createElement(AudacityAudioMeter, {
			copy: ENGLISH_COPY, meter: { peak: .9, rms: .6, dbfs: 20 * Math.log10(.9),
				loudness: { maximumTruePeakDbtp, momentaryLufs: -20 } },
			settings: { ...DEFAULT_PLAYBACK_METER_SETTINGS, type }, orientation: 'vertical',
			clipped, slider: null, meterLabel: undefined, dataMeterAttribute: undefined,
		}));
	} finally {
		if (prior) Object.defineProperty(globalThis, 'React', prior);
		else Reflect.deleteProperty(globalThis, 'React');
	}
}

for (const type of ['db-log', 'db-linear', 'amplitude'] as const) {
	test(`${type} retains full-scale clipping without borrowing the EBU headroom threshold`, () => {
		assert.doesNotMatch(renderMeter(type, -.5), /class="kw-audio-editor__playback-meter-clipped"/u);
		assert.match(renderMeter(type, -.5, true), /class="kw-audio-editor__playback-meter-clipped"/u);
	});
}

test('EBU retains its separate programme-headroom warning and exact threshold', () => {
	assert.match(renderMeter('ebu-r128', -.5), /class="kw-audio-editor__playback-meter-clipped"/u);
	assert.doesNotMatch(renderMeter('ebu-r128', -1), /class="kw-audio-editor__playback-meter-clipped"/u);
	assert.match(renderMeter('ebu-r128', -6, true), /class="kw-audio-editor__playback-meter-clipped"/u);
});

test('ordinary safe programme readings retain their existing display', () => {
	assert.doesNotMatch(renderMeter('db-log', -6), /class="kw-audio-editor__playback-meter-clipped"/u);
});
