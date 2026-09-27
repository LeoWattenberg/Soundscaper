/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createEffect } from '../src/common/editor/effects.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import EffectParameterEditor from '../src/common/editor/ui/inspector/EffectParameterEditor.jsx';

Object.defineProperty(globalThis, 'React', { configurable: true, value: React });

const PARAMETER_NAMES = [
	'lowCrossover', 'highCrossover',
	'lowThreshold', 'lowRatio', 'lowGain',
	'midThreshold', 'midRatio', 'midGain',
	'highThreshold', 'highRatio', 'highGain',
	'attack', 'release',
];

function render(live = true): string {
	return renderToStaticMarkup(<EffectParameterEditor
		effect={createEffect('multiband-compressor')}
		copy={ENGLISH_COPY}
		disabled={false}
		tracks={[]}
		targetTrackId="track-1"
		captureNoiseProfile={undefined}
		noiseProfileLabel=""
		onRackEffectGestureBegin={undefined}
		onRackEffectPreview={undefined}
		onRackEffectCommit={undefined}
		onRackEffectCancel={undefined}
		onParametricEqGestureBegin={undefined}
		onParametricEqPreview={undefined}
		onParametricEqCommit={undefined}
		onParametricEqCancel={undefined}
		onParametricEqAudition={undefined}
		readParametricEqSpectrum={undefined}
		readDynamicsAnalysis={live ? () => null : null}
		automationRuntime={undefined}
		automationProject={undefined}
		automationStrip={undefined}
		onChange={() => undefined}
	/>);
}

test('the realtime multiband compressor reuses the compressor input and output history', () => {
	const markup = render();
	assert.match(markup, /data-audacity-dynamics-layout/u);
	assert.match(markup, /data-dynamics-activity/u);
	assert.match(markup, /aria-label="Input, output and compression history"/u);
	for (const label of ['Input', 'Output', 'Compression']) {
		assert.match(markup, new RegExp(`aria-label="${label}"`, 'u'));
	}
	assert.ok(markup.indexOf('data-dynamics-activity') < markup.indexOf('data-audacity-parameter="lowCrossover"'));
});

test('the multiband dynamics layout keeps every control exactly once in named groups', () => {
	const markup = render();
	assert.doesNotMatch(markup, /audio-editor-audacity-layout__card/u);
	for (const group of ['crossovers', 'timing', 'low', 'mid', 'high']) {
		assert.match(markup, new RegExp(`data-multiband-compressor-group="${group}"`, 'u'));
	}
	for (const name of PARAMETER_NAMES) {
		assert.equal(markup.split(`data-audacity-parameter="${name}"`).length, 2, name);
	}
});

test('selection processing keeps the organized controls but omits an empty live graph', () => {
	const markup = render(false);
	assert.doesNotMatch(markup, /data-dynamics-activity/u);
	assert.match(markup, /data-multiband-compressor-group="low"/u);
});
