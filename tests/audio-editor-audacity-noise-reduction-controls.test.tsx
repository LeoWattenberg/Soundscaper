/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AudacityNoiseReductionControls from '../src/common/editor/ui/AudacityNoiseReductionControls.tsx';

test('noise reduction presents the pinned second-step instructions and renders each processing slider once', () => {
	const rendered: string[] = [];
	const markup = renderToStaticMarkup(<AudacityNoiseReductionControls
		parameters={{ output: 'residue' }} onChangeOutput={() => {}}
		renderParameter={name => { rendered.push(name); return <span>{name}</span>; }}
	/>);
	assert.deepEqual(rendered, ['reductionDb', 'sensitivity', 'frequencySmoothingBands']);
	assert.match(markup, /<h3[^>]*>Step 2<\/h3>/u);
	assert.match(markup, /Select all of the audio you want filtered/u);
	assert.match(markup, /role="radiogroup" aria-label="Output"/u);
	assert.match(markup, /<input[^>]*value="reduce"[^>]*\/>[^<]*Audio with noise removed/u);
	assert.match(markup, /<input(?=[^>]*value="residue")(?=[^>]*checked="")[^>]*\/>[^<]*Noise only/u);
});

test('noise reduction announces the active reduce mode and disables its output choices with the effect', () => {
	const markup = renderToStaticMarkup(<AudacityNoiseReductionControls
		parameters={{ output: 'reduce' }} disabled onChangeOutput={() => {}}
		renderParameter={() => null}
	/>);
	assert.match(markup, /<input(?=[^>]*value="reduce")(?=[^>]*disabled="")(?=[^>]*checked="")[^>]*>/u);
	assert.match(markup, /<input(?=[^>]*value="residue")(?=[^>]*disabled="")[^>]*>/u);
});
