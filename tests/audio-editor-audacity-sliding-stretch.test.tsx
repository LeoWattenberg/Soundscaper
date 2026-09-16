/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import EffectParameterEditor from '../src/common/editor/ui/inspector/EffectParameterEditor.jsx';
import { audacityEffectDefaults } from '../src/common/editor/audacity-effects/manifest.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

Object.defineProperty(globalThis, 'React', { configurable: true, value: React });

test('sliding stretch matches its four Qt cards with tempo sliders and linked pitch percentages', () => {
	const markup = renderToStaticMarkup(<EffectParameterEditor
		effect={{ id: 'sliding', type: 'audacity-sliding-stretch', enabled: true,
			params: { ...audacityEffectDefaults('audacity-sliding-stretch'), startPitchSemitones: -12, endPitchSemitones: 12 } }}
		copy={ENGLISH_COPY} disabled={false} tracks={[]} targetTrackId="track-1"
		captureNoiseProfile={undefined} noiseProfileLabel=""
		onRackEffectGestureBegin={undefined} onRackEffectPreview={undefined}
		onRackEffectCommit={undefined} onRackEffectCancel={undefined}
		onParametricEqGestureBegin={undefined} onParametricEqPreview={undefined}
		onParametricEqCommit={undefined} onParametricEqCancel={undefined}
		onParametricEqAudition={undefined} readParametricEqSpectrum={undefined}
		automationRuntime={undefined} automationProject={undefined} automationStrip={undefined}
		onChange={() => undefined}
	/>);
	for (const card of ['initial-tempo', 'final-tempo', 'initial-pitch', 'final-pitch']) {
		assert.match(markup, new RegExp(`data-audacity-port-section="${card}"`, 'u'));
	}
	assert.equal(markup.match(/<span>Semitones \(-12 → 12\)<\/span>/gu)?.length, 2);
	assert.equal(markup.match(/<span>Percentage change<\/span>/gu)?.length, 2);
	assert.doesNotMatch(markup, /<span>Initial pitch shift<\/span>|<span>Final pitch shift<\/span>/u);
	for (const [name, percent] of [['startPitchSemitonesPercent', '-50'], ['endPitchSemitonesPercent', '100']]) {
		const parameter = markup.split(`data-effect-param="${name}"`)[1]?.split('data-effect-param=')[0];
		assert.ok(parameter);
		assert.match(parameter, new RegExp(`value="${percent}"`, 'u'));
		assert.match(parameter, /type="range"/u);
	}
	for (const name of ['startTempoPercent', 'endTempoPercent']) {
		const parameter = markup.split(`data-effect-param="${name}"`)[1]?.split('data-effect-param=')[0];
		assert.ok(parameter);
		assert.match(parameter, /type="range"/u);
	}
});
