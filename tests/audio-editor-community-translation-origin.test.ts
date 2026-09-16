/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { publishedTranslationOrigin } from '../src/common/i18n/community-translations.ts';

test('origin describes the displayed translation and does not credit retired catalog entries', () => {
	const baseline = { key: 'ready', source: 'Ready', baselineText: 'Bereit', baselineEntry: null };
	assert.equal(publishedTranslationOrigin(baseline, 'Bereit'), 'bundled');
	assert.equal(publishedTranslationOrigin({ ...baseline, baselineText: 'Ready' }, 'Bereit'), 'missing');
	assert.equal(publishedTranslationOrigin({ ...baseline, baselineEntry: ['human', 'Old source', 'Bereit'] }), 'missing');
	assert.equal(publishedTranslationOrigin({ ...baseline, baselineEntry: ['machine', 'Ready', 'Bereit'] }), 'machine');
	assert.equal(publishedTranslationOrigin({ ...baseline, baselineEntry: ['audacity', 'Ready', 'Bereit'] }), 'audacity');
	assert.equal(publishedTranslationOrigin({ ...baseline, baselineEntry: ['human', 'Ready', 'Bereit'] }), 'human');
});

test('a reviewed translation equal to English still retains its human origin', () => {
	assert.equal(publishedTranslationOrigin({ key: 'ready', source: 'Ready', baselineText: 'Ready',
		baselineEntry: ['human', 'Ready', 'Ready'] }), 'human');
	assert.equal(publishedTranslationOrigin(undefined), 'missing');
});
