/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import EffectParameterEditor from '../src/common/editor/ui/inspector/EffectParameterEditor.jsx';
import { AUDIO_EFFECT_DEFINITIONS } from '../src/common/editor/effects.js';
import { audacityEffectDefaults } from '../src/common/editor/audacity-effects/manifest.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

Object.defineProperty(globalThis, 'React', { configurable: true, value: React });

// Truncate Silence is a selection effect rather than a rack effect, so every
// subject here is built as the plain effect record the dialogs pass in instead
// of going through createEffect, which only knows the rack types.
function parameterMarkup(type: string, params: Readonly<Record<string, unknown>> = {}) {
	const defaults = AUDIO_EFFECT_DEFINITIONS[type as keyof typeof AUDIO_EFFECT_DEFINITIONS]?.defaults
		?? audacityEffectDefaults(type);
	const effect = {
		id: `${type}-time-controls`, type, enabled: true, params: { ...defaults, ...params },
	};
	// The editor is untyped JSX, so every prop it destructures without a default
	// has to be stated; the ones this subject does not use are stated as absent.
	const markup = renderToStaticMarkup(<EffectParameterEditor
		effect={effect}
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
		automationRuntime={undefined}
		automationProject={undefined}
		automationStrip={undefined}
		onChange={() => undefined}
	/>);
	return (name: string): string => {
		const start = markup.indexOf(`data-effect-param="${name}"`);
		assert.notEqual(start, -1, `${type}.${name} is not rendered`);
		const next = markup.indexOf('data-effect-param="', start + 1);
		return markup.slice(start, next === -1 ? undefined : next);
	};
}

test('bounded time parameters are knobs rather than timecode fields', () => {
	const cases: ReadonlyArray<readonly [string, readonly string[]]> = [
		['compressor', ['attack', 'release']],
		['limiter', ['lookahead', 'release']],
		['gate', ['attack', 'hold', 'release']],
		['reverb', ['decay', 'preDelay']],
		['delay', ['time']],
		['audacity-compressor', ['attackMs', 'releaseMs', 'lookaheadMs']],
		['audacity-legacy-compressor', ['attackSeconds', 'releaseSeconds']],
		['audacity-limiter', ['lookaheadMs', 'releaseMs']],
		['audacity-reverb', ['preDelay']],
		['audacity-auto-duck', ['innerFadeDown', 'innerFadeUp', 'outerFadeDown', 'outerFadeUp', 'maximumPause']],
		['audacity-echo', ['delaySeconds']],
	];
	for (const [type, names] of cases) {
		const parameter = parameterMarkup(type);
		for (const name of names) {
			const markup = parameter(name);
			assert.doesNotMatch(markup, /data-timecode-input/u, `${type}.${name}`);
			assert.match(markup, /class="knob/u, `${type}.${name}`);
			// One field beside the knob, so a control locator stays unambiguous.
			assert.equal(markup.match(/<input\b/gu)?.length, 1, `${type}.${name}`);
		}
	}
});

test('a time parameter with no real maximum keeps the timecode, so hours can be typed', () => {
	// Paulstretch is the one effect whose time value the editor leaves open; the
	// rack effects clamp theirs to a range a knob can be built on.
	const markup = parameterMarkup('audacity-paulstretch')('timeResolution');
	assert.match(markup, /data-timecode-input="seconds"/u);
	assert.match(markup, /data-unit="hours"/u);
	assert.doesNotMatch(markup, /class="knob/u);
});

test('durations that set how long the processed audio is keep the timecode component', () => {
	const parameter = parameterMarkup('audacity-truncate-silence', { action: 'truncate' });
	for (const name of ['minimumSilence', 'truncateTo']) {
		const markup = parameter(name);
		assert.match(markup, /data-timecode-input="seconds"/u, name);
		assert.doesNotMatch(markup, /class="knob/u, name);
	}
});
