/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AudacityEffectLayout } from '../src/common/editor/ui/AudacityEffectLayout.jsx';
import { AUDACITY_EFFECT_DEFINITIONS } from '../src/common/editor/audacity-effects/manifest.js';

Object.defineProperty(globalThis, 'React', { configurable: true, value: React });

function portMarkup(effectType: keyof typeof AUDACITY_EFFECT_DEFINITIONS): string {
	return renderToStaticMarkup(<AudacityEffectLayout
		effectType={effectType}
		definition={AUDACITY_EFFECT_DEFINITIONS[effectType]}
		renderParameter={(name: string) => <span>{name}</span>}
		copy={{}}
	/>);
}

test('Reverb follows the pinned Qt large space knobs and unboxed smaller controls', () => {
	const markup = portMarkup('audacity-reverb');
	assert.doesNotMatch(markup, /<h3/u);
	const space = markup.split('data-audacity-port-section="space"')[1]?.split('</section>')[0];
	assert.ok(space);
	assert.match(space, /data-audacity-parameter="roomSize"[\s\S]*data-audacity-parameter="stereoWidth"[\s\S]*data-audacity-parameter="preDelay"/u);
	assert.doesNotMatch(space, /data-audacity-parameter="damping"/u);
	assert.match(markup, /data-audacity-port-section="tone"[\s\S]*data-audacity-parameter="damping"[\s\S]*data-audacity-parameter="reverberance"/u);
	assert.match(markup, /data-audacity-port-section="mix"[\s\S]*data-audacity-parameter="wetGainDb"[\s\S]*data-audacity-parameter="dryGainDb"[\s\S]*data-audacity-parameter="wetOnly"/u);
});

test('simple Qt effects use flat fields and Normalize keeps its checkbox and target together', () => {
	for (const effectType of ['audacity-amplify', 'audacity-click-removal', 'audacity-normalize', 'audacity-paulstretch'] as const) {
		assert.doesNotMatch(portMarkup(effectType), /<h3|audio-editor-audacity-layout__card/u);
	}
	const normalize = portMarkup('audacity-normalize');
	assert.match(normalize, /data-audacity-port-section="target"[\s\S]*data-audacity-parameter="applyGain"[\s\S]*data-audacity-parameter="peakDb"/u);
});

test('every port parameter is rendered once even when the definition adds a setting', () => {
	const definitions = Object.entries(AUDACITY_EFFECT_DEFINITIONS) as Array<[
		string, Readonly<{ params: Readonly<Record<string, unknown>> }>,
	]>;
	for (const [effectType, definition] of definitions) {
		if (effectType === 'audacity-compressor' || effectType === 'audacity-limiter') continue;
		const names: string[] = [];
		renderToStaticMarkup(<AudacityEffectLayout
			effectType={effectType}
			definition={{ params: { ...definition.params, additionalSetting: {} } }}
			renderParameter={(name: string) => { names.push(name); return null; }}
			copy={{}}
		/>);
		assert.deepEqual([...names].sort(), [...Object.keys(definition.params), 'additionalSetting'].sort(), effectType);
	}
});

test('a zero-range gate response remains unattenuated instead of falling back to minus 80 dB', () => {
	const responsePath = (rangeDb: number): string => {
		const markup = renderToStaticMarkup(<AudacityEffectLayout
			effectType="gate"
			definition={{ params: { threshold: {}, rangeDb: {} } }}
			parameters={{ threshold: -20, rangeDb }}
			renderParameter={() => null}
			copy={{}}
		/>);
		const match = /audio-editor-audacity-layout__response-curve" d="([^"]+)/u.exec(markup);
		assert.ok(match);
		return match[1]!;
	};

	const unattenuated = responsePath(0);
	const closed = responsePath(-80);
	assert.match(unattenuated, /L120\.00 36\.00/u);
	assert.match(closed, /L120\.00 62\.00/u);
	assert.notEqual(unattenuated, closed);
});

test('converted Noise Gate uses the pinned Nyquist flat control order', () => {
	const names = ['threshold', 'rangeDb', 'gateFrequency', 'stereoLink', 'attack', 'lookahead', 'hold', 'release'];
	const markup = renderToStaticMarkup(<AudacityEffectLayout
		effectType="noise-gate"
		definition={{ params: Object.fromEntries(names.map(name => [name, {}])) }}
		renderParameter={(name: string) => <span>{name}</span>}
		copy={{}}
	/>);
	assert.match(markup, /data-audacity-nyquist-port="true"/u);
	assert.doesNotMatch(markup, /audio-editor-audacity-layout__card/u);
	assert.match(markup, /data-audacity-parameter="stereoLink"[\s\S]*data-audacity-parameter="threshold"[\s\S]*data-audacity-parameter="gateFrequency"/u);
	assert.match(markup, /data-audacity-port-section="advanced"[\s\S]*data-audacity-parameter="lookahead"/u);
});
