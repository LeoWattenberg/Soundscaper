/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AudacityEffectLayout } from '../src/common/editor/ui/AudacityEffectLayout.jsx';
import { canonicalCopyValue } from '../src/common/i18n/canonical-extras.js';

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

test('noise gate groups preview with its envelope and explains how it protects onsets', () => {
	const names = ['threshold', 'rangeDb', 'gateFrequency', 'stereoLink', 'attack', 'lookahead', 'hold', 'release'];
	const markup = renderToStaticMarkup(<AudacityEffectLayout
		effectType="noise-gate"
		definition={{ params: Object.fromEntries(names.map(name => [name, {}])) }}
		renderParameter={(name: string) => <span>{name}</span>}
		copy={{}}
	/>);
	assert.match(markup, /data-editor-help="noise-gate-lookahead"/u);
	const envelope = markup.split('<section').find(section => section.includes('data-audacity-parameter="attack"'));
	assert.ok(envelope);
	assert.match(envelope, /data-audacity-parameter="lookahead"/u);
	assert.match(canonicalCopyValue('effectNoiseGateLookaheadHint', 'en'), /attack.*fully open/u);
	assert.match(canonicalCopyValue('effectNoiseGateLookaheadHint', 'de'), /Ansprechzeit/u);
});
