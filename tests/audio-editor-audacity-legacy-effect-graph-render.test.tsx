/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AudacityLegacyEffectGraph from '../src/common/editor/ui/AudacityLegacyEffectGraph.tsx';

test('legacy compressor restores a labelled wx transfer graph with its dB rulers', () => {
	const markup = renderToStaticMarkup(<AudacityLegacyEffectGraph effectType="audacity-legacy-compressor" parameters={{}} />);
	assert.match(markup, /data-audacity-effect-graph="audacity-legacy-compressor"/u);
	assert.match(markup, /role="img" aria-label="Compression curve"/u);
	assert.match(markup, /-60 dB/u);
	assert.match(markup, /0 dB/u);
	assert.doesNotMatch(markup, /__grid/u);
});

test('Auto Duck restores five source control markers with current fade and attenuation values', () => {
	const markup = renderToStaticMarkup(<AudacityLegacyEffectGraph effectType="audacity-auto-duck"
		parameters={{ duckAmountDb: -6, innerFadeDown: 0.25 }} />);
	assert.match(markup, /viewBox="0 0 600 300"/u);
	assert.equal(markup.match(/data-audacity-duck-control=/gu)?.length, 5);
	assert.match(markup, />-6\.0 dB</u);
	assert.match(markup, />0\.25 s</u);
});

test('Classic Filters restores source display-range sliders and uses project Nyquist labels', () => {
	const markup = renderToStaticMarkup(<AudacityLegacyEffectGraph effectType="audacity-classic-filters" parameters={{}} sampleRate={96_000} />);
	assert.match(markup, /aria-label="Actual filter response"/u);
	assert.match(markup, /aria-label="Maximum dB"[^>]*value="20"/u);
	assert.match(markup, /aria-label="Minimum dB"[^>]*value="-30"/u);
	assert.match(markup, />48k Hz</u);
});

test('effects without an upstream response diagram do not acquire a graph', () => {
	assert.equal(renderToStaticMarkup(<AudacityLegacyEffectGraph effectType="audacity-reverb" parameters={{}} />), '');
});
